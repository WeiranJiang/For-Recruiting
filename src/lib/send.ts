import "server-only";
import { and, eq, inArray, lte, ne, isNotNull } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { Email, User } from "./db/schema";
import { gmailFor } from "./google";
import { buildMime, cleanList, isValidEmail } from "./mime";
import { nextSlot, withDefaults, type Booked } from "./rules";
import { findPlaceholders, resumeFilename } from "./text-rules";

const ACTIVE: Email["status"][] = ["scheduled", "sending", "sent"];

function normBody(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Recipients that count for duplicate checks: everyone except the sender and the user's default CC/BCC (e.g. a tracker). */
function personalRecipients(user: User, e: Pick<Email, "to" | "cc" | "bcc">) {
  const rules = withDefaults(user.rules);
  const ignore = new Set([user.email.toLowerCase(), ...cleanList(rules.defaultBcc), ...cleanList(rules.defaultCc)]);
  return cleanList([...e.to, ...e.cc, ...e.bcc]).filter((a) => !ignore.has(a));
}

export type DuplicateHit = { address: string; emailId: string; when: Date | null; subject: string; status: string };

/**
 * "Never send the same email to the same person twice":
 *  - initial emails: blocked if any recipient was already emailed (scheduled/sent) before.
 *  - follow-ups: blocked if the exact same body was already sent to a recipient.
 */
export async function findDuplicates(user: User, e: Email): Promise<DuplicateHit[]> {
  const db = await getDb();
  const mine = personalRecipients(user, e);
  if (!mine.length) return [];
  const others = await db
    .select()
    .from(schema.emails)
    .where(and(eq(schema.emails.userId, user.id), inArray(schema.emails.status, ACTIVE), ne(schema.emails.id, e.id)));
  const hits: DuplicateHit[] = [];
  for (const o of others) {
    const theirs = new Set(personalRecipients(user, o));
    for (const a of mine) {
      if (!theirs.has(a)) continue;
      const sameText = normBody(o.body) === normBody(e.body);
      if (e.kind === "initial" ? o.kind === "initial" || sameText : sameText) {
        hits.push({ address: a, emailId: o.id, when: o.sentAt ?? o.scheduledAt, subject: o.subject, status: o.status });
      }
    }
  }
  return hits;
}

export async function bookedSlots(userId: string, excludeId?: string): Promise<Booked[]> {
  const db = await getDb();
  const rows = await db
    .select({ e: schema.emails, bank: schema.contacts.bank })
    .from(schema.emails)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.emails.contactId))
    .where(and(eq(schema.emails.userId, userId), inArray(schema.emails.status, ACTIVE)));
  return rows
    .filter((r) => r.e.id !== excludeId)
    .map((r) => ({ at: (r.e.sentAt ?? r.e.scheduledAt)!, bank: r.bank }))
    .filter((b) => b.at);
}

export async function previewSlot(user: User, email: Email, bank: string): Promise<Date | null> {
  if (email.requestedAt) return email.requestedAt;
  return nextSlot({ rules: withDefaults(user.rules), bank, booked: await bookedSlots(user.id, email.id), seed: email.id });
}

export function validateEmail(e: Pick<Email, "to" | "cc" | "bcc" | "subject" | "body">): string | null {
  if (!e.to.length) return "Add at least one recipient in To.";
  const bad = [...e.to, ...e.cc, ...e.bcc].filter((a) => !isValidEmail(a));
  if (bad.length) return `Invalid address: ${bad.join(", ")}`;
  if (!e.subject.trim()) return "Subject is empty.";
  if (!e.body.trim()) return "Body is empty.";
  const ph = findPlaceholders(`${e.subject}\n${e.body}`);
  if (ph.length) return `Fill in ${ph.join(", ")} before sending.`;
  return null;
}

/** Swipe right: validate, dedupe, then schedule at the next slot allowed by the rules (or send now if the slot is now). */
export async function approveEmail(user: User, emailId: string, opts: { force?: boolean } = {}) {
  const db = await getDb();
  const [row] = await db
    .select({ e: schema.emails, c: schema.contacts })
    .from(schema.emails)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.emails.contactId))
    .where(and(eq(schema.emails.id, emailId), eq(schema.emails.userId, user.id)));
  if (!row) throw new Error("Email not found");
  const { e, c } = row;
  if (!["pending", "review", "failed"].includes(e.status)) throw new Error(`Email is already ${e.status}`);
  const invalid = validateEmail(e);
  if (invalid) return { ok: false as const, reason: invalid };
  const dups = await findDuplicates(user, e);
  if (dups.length && !opts.force)
    return { ok: false as const, reason: "duplicate", duplicates: dups };
  if (e.attachResume && !user.resumePdfB64)
    return { ok: false as const, reason: "Resume attachment is on but no resume PDF is uploaded. Upload one in Setup or turn the attachment off." };

  const slot = await previewSlot(user, e, c.bank);
  if (!slot) return { ok: false as const, reason: "No send slot fits your rules in the next 90 days. Loosen the rules." };
  await db
    .update(schema.emails)
    .set({ status: "scheduled", scheduledAt: slot, error: null, updatedAt: new Date() })
    .where(eq(schema.emails.id, e.id));
  if (slot.getTime() <= Date.now() + 90_000) {
    await sendOne(user, e.id);
  }
  return { ok: true as const, scheduledAt: slot };
}

/** Atomically claims and sends one scheduled email through Gmail. */
export async function sendOne(user: User, emailId: string) {
  const db = await getDb();
  const claimed = await db
    .update(schema.emails)
    .set({ status: "sending", updatedAt: new Date() })
    .where(and(eq(schema.emails.id, emailId), eq(schema.emails.status, "scheduled")))
    .returning();
  const e = claimed[0];
  if (!e) return;
  try {
    // Re-check duplicates at the moment of sending (another tab/device may have sent in between).
    const dups = await findDuplicates(user, e);
    if (dups.length && e.kind === "initial") {
      throw new Error(`Blocked: ${dups[0].address} was already emailed (${dups[0].subject}).`);
    }
    let inReplyTo: string | null = null;
    let threadId: string | undefined;
    if (e.kind === "follow_up" && e.parentEmailId) {
      const [parent] = await db.select().from(schema.emails).where(eq(schema.emails.id, e.parentEmailId));
      inReplyTo = parent?.rfcMessageId ?? null;
      threadId = parent?.gmailThreadId ?? undefined;
    }
    const raw = buildMime({
      from: user.name ? `${user.name.replace(/[<>"]/g, "")} <${user.email}>` : user.email,
      to: e.to,
      cc: e.cc,
      bcc: e.bcc,
      subject: e.subject,
      body: e.body,
      inReplyTo,
      attachment:
        e.attachResume && user.resumePdfB64
          ? { filename: resumeFilename(user.profile.fullName || user.name, user.resumeFilename || "Resume.pdf"), contentB64: user.resumePdfB64, mimeType: "application/pdf" }
          : null,
    });
    const gmail = gmailFor(user);
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: threadId ? { threadId } : {},
      media: { mimeType: "message/rfc822", body: raw },
    });
    const id = res.data.id!;
    let rfc: string | null = null;
    try {
      const meta = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["Message-ID"] });
      rfc = meta.data.payload?.headers?.find((h) => h.name?.toLowerCase() === "message-id")?.value ?? null;
    } catch {
      /* non-fatal */
    }
    await db
      .update(schema.emails)
      .set({
        status: "sent",
        sentAt: new Date(),
        gmailMessageId: id,
        gmailThreadId: res.data.threadId ?? null,
        rfcMessageId: rfc,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.emails.id, e.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.emails)
      .set({ status: "failed", error: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(schema.emails.id, e.id));
  }
}

/** Sends every scheduled email that is due. Pass a userId to limit to one user. */
export async function processDue(userId?: string) {
  const db = await getDb();
  const due = await db
    .select({ id: schema.emails.id, userId: schema.emails.userId })
    .from(schema.emails)
    .where(
      and(
        eq(schema.emails.status, "scheduled"),
        isNotNull(schema.emails.scheduledAt),
        lte(schema.emails.scheduledAt, new Date()),
        ...(userId ? [eq(schema.emails.userId, userId)] : []),
      ),
    )
    .limit(50);
  const userCache = new Map<string, User>();
  let sent = 0;
  for (const d of due) {
    let u = userCache.get(d.userId);
    if (!u) {
      [u] = await db.select().from(schema.users).where(eq(schema.users.id, d.userId));
      if (!u) continue;
      userCache.set(d.userId, u);
    }
    await sendOne(u, d.id);
    sent++;
  }
  return sent;
}
