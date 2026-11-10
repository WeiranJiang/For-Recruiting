import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import type { gmail_v1 } from "googleapis";
import { getDb, schema } from "./db";
import type { Email, User, DeliveryStatus } from "./db/schema";
import { gmailFor } from "./google";
import { EMAIL_RE, cleanList } from "./mime";

type Gmail = gmail_v1.Gmail;

function header(m: gmail_v1.Schema$Message, name: string) {
  return m.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Out-of-office and other automatic replies (RFC 3834 headers + common subjects). */
export function isAutoReply(m: gmail_v1.Schema$Message) {
  const auto = header(m, "Auto-Submitted").toLowerCase();
  if (auto && auto !== "no") return true;
  if (header(m, "X-Autoreply") || header(m, "X-Autorespond") || header(m, "X-Auto-Response-Suppress").toLowerCase().includes("all")) return true;
  if (/auto_reply|auto-reply/i.test(header(m, "Precedence"))) return true;
  return /automatic reply|auto(matic)?[- ]?reply|out of (the )?office|ooo\b|away from (the |my )?office|on leave|on vacation/i.test(header(m, "Subject"));
}

function isDaemon(from: string) {
  return /mailer-daemon|postmaster|mail delivery (subsystem|system)/i.test(from);
}

function decodeParts(p: gmail_v1.Schema$MessagePart | undefined, out: string[] = []): string[] {
  if (!p) return out;
  if (p.body?.data) out.push(Buffer.from(p.body.data, "base64url").toString("utf8"));
  for (const c of p.parts ?? []) decodeParts(c, out);
  return out;
}

/** Which of `recipients` does this bounce notification say failed? */
function failedRecipients(m: gmail_v1.Schema$Message, recipients: string[]): string[] {
  const hdr = cleanList(header(m, "X-Failed-Recipients"));
  const text = decodeParts(m.payload).join("\n") + "\n" + (m.snippet ?? "");
  const mentioned = new Set((text.match(EMAIL_RE) ?? []).map((s) => s.toLowerCase()));
  for (const h of hdr) mentioned.add(h);
  return recipients.filter((r) => mentioned.has(r));
}

/**
 * Delivery rule (as requested): an email is flagged as undelivered only when EVERY
 * recipient (To + CC + BCC) bounced. If even one went through it is "delivered" (or "partial_bounce").
 */
export function deliveryFor(e: Pick<Email, "to" | "cc" | "bcc">, bounced: string[]): DeliveryStatus {
  const all = cleanList([...e.to, ...e.cc, ...e.bcc]);
  const b = new Set(cleanList(bounced));
  const n = all.filter((a) => b.has(a)).length;
  if (n === 0) return "delivered";
  return n >= all.length ? "all_bounced" : "partial_bounce";
}

async function getFull(gmail: Gmail, id: string) {
  return (await gmail.users.messages.get({ userId: "me", id, format: "full" })).data;
}

/** Checks Gmail for replies and bounces on recently sent emails. */
export async function syncUser(user: User) {
  const db = await getDb();
  const gmail = gmailFor(user);
  const since = new Date(Date.now() - 45 * 86_400_000);
  const sent = await db
    .select()
    .from(schema.emails)
    .where(and(eq(schema.emails.userId, user.id), eq(schema.emails.status, "sent"), gte(schema.emails.sentAt, since)));
  if (!sent.length) {
    await db.update(schema.users).set({ lastSyncAt: new Date() }).where(eq(schema.users.id, user.id));
    return { checked: 0, replies: 0, bounces: 0 };
  }
  const me = user.email.toLowerCase();
  let replies = 0;
  let bounces = 0;

  // Threads may hold several of our emails (follow-ups); fetch each thread once.
  const threadIds = [...new Set(sent.map((e) => e.gmailThreadId).filter(Boolean) as string[])];
  const threads = new Map<string, gmail_v1.Schema$Message[]>();
  for (const t of threadIds) {
    try {
      const th = await gmail.users.threads.get({ userId: "me", id: t, format: "full" });
      threads.set(t, th.data.messages ?? []);
    } catch {
      /* thread deleted */
    }
  }

  // Bounce notices sometimes arrive outside the thread.
  const daemonMsgs: gmail_v1.Schema$Message[] = [];
  try {
    const after = Math.floor(Math.min(...sent.map((e) => e.sentAt!.getTime())) / 1000);
    const list = await gmail.users.messages.list({
      userId: "me",
      q: `from:(mailer-daemon OR postmaster) after:${after}`,
      maxResults: 50,
    });
    for (const m of list.data.messages ?? []) daemonMsgs.push(await getFull(gmail, m.id!));
  } catch {
    /* ignore */
  }

  for (const e of sent) {
    const recipients = cleanList([...e.to, ...e.cc, ...e.bcc]);
    const msgs = (e.gmailThreadId && threads.get(e.gmailThreadId)) || [];
    const sentMs = e.sentAt!.getTime();
    let repliedAt = e.repliedAt;
    let replySnippet = e.replySnippet;
    let autoReplyAt = e.autoReplyAt;
    let autoReplySnippet = e.autoReplySnippet;
    const bounced = new Set(e.bouncedRecipients);

    for (const m of msgs) {
      if (m.id === e.gmailMessageId) continue;
      const ts = Number(m.internalDate ?? 0);
      if (ts < sentMs) continue;
      const from = header(m, "From").toLowerCase();
      if (isDaemon(from)) {
        failedRecipients(m, recipients).forEach((r) => bounced.add(r));
      } else if (!from.includes(me) && isAutoReply(m)) {
        if (!autoReplyAt) {
          autoReplyAt = new Date(ts);
          autoReplySnippet = (m.snippet ?? "").slice(0, 300);
        }
      } else if (!from.includes(me) && !repliedAt) {
        repliedAt = new Date(ts);
        replySnippet = (m.snippet ?? "").slice(0, 300);
      }
    }
    for (const m of daemonMsgs) {
      const ts = Number(m.internalDate ?? 0);
      if (ts < sentMs) continue;
      const refs = header(m, "References") + " " + header(m, "In-Reply-To");
      const text = decodeParts(m.payload).join("\n");
      const aboutThis =
        (e.rfcMessageId && (refs.includes(e.rfcMessageId) || text.includes(e.rfcMessageId))) ||
        (e.subject && text.includes(e.subject));
      if (aboutThis) failedRecipients(m, recipients).forEach((r) => bounced.add(r));
    }

    // Replies that started a brand-new thread from one of the recipients.
    if (!repliedAt) {
      const ext = recipients.filter((r) => r !== me);
      if (ext.length) {
        try {
          const q = `from:(${ext.join(" OR ")}) after:${Math.floor(sentMs / 1000)}`;
          const list = await gmail.users.messages.list({ userId: "me", q, maxResults: 5 });
          for (const hit of list.data.messages ?? []) {
            const m = (
              await gmail.users.messages.get({
                userId: "me",
                id: hit.id!,
                format: "metadata",
                metadataHeaders: ["Subject", "Auto-Submitted", "X-Autoreply", "X-Autorespond", "X-Auto-Response-Suppress", "Precedence"],
              })
            ).data;
            if (isAutoReply(m)) {
              if (!autoReplyAt) {
                autoReplyAt = new Date(Number(m.internalDate ?? Date.now()));
                autoReplySnippet = (m.snippet ?? "").slice(0, 300);
              }
              continue;
            }
            repliedAt = new Date(Number(m.internalDate ?? Date.now()));
            replySnippet = (m.snippet ?? "").slice(0, 300);
            break;
          }
        } catch {
          /* ignore */
        }
      }
    }

    const bouncedArr = [...bounced];
    const delivery = deliveryFor(e, bouncedArr);
    const changed =
      String(repliedAt) !== String(e.repliedAt) || String(autoReplyAt) !== String(e.autoReplyAt) || delivery !== e.deliveryStatus || bouncedArr.length !== e.bouncedRecipients.length;
    if (changed) {
      if (repliedAt && !e.repliedAt) replies++;
      if (delivery === "all_bounced" && e.deliveryStatus !== "all_bounced") bounces++;
      await db
        .update(schema.emails)
        .set({ repliedAt, replySnippet, autoReplyAt, autoReplySnippet, bouncedRecipients: bouncedArr, deliveryStatus: delivery, updatedAt: new Date() })
        .where(eq(schema.emails.id, e.id));
    }
  }

  // A reply anywhere in a contact's thread means pending follow-ups for that contact should be paused.
  const repliedContacts = (
    await db
      .select({ c: schema.emails.contactId, r: schema.emails.repliedAt })
      .from(schema.emails)
      .where(eq(schema.emails.userId, user.id))
  )
    .filter((x) => x.r)
    .map((x) => x.c);
  if (repliedContacts.length) {
    await db
      .update(schema.emails)
      .set({ status: "review", scheduledAt: null, error: "Paused: this person already replied.", updatedAt: new Date() })
      .where(
        and(
          eq(schema.emails.userId, user.id),
          eq(schema.emails.kind, "follow_up"),
          eq(schema.emails.status, "scheduled"),
          inArray(schema.emails.contactId, [...new Set(repliedContacts)]),
        ),
      );
  }

  await db.update(schema.users).set({ lastSyncAt: new Date() }).where(eq(schema.users.id, user.id));
  return { checked: sent.length, replies, bounces };
}
