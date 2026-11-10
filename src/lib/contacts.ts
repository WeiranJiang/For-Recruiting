import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { Contact, Email, User } from "./db/schema";
import { draftEmail, type DraftResult, type ResearchedPerson } from "./ai";
import { DEFAULT_WRITING_GUIDE } from "./master-prompt";
import { apolloFind, hunterFind } from "./providers";
import { decrypt } from "./crypto";
import { cleanList } from "./mime";
import { normalizeBank, withDefaults } from "./rules";

export type EmailProvider = "ai" | "hunter" | "apollo";

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

function key(name: string, bank: string) {
  return name.toLowerCase().replace(/[^a-z]/g, "") + "|" + normalizeBank(bank);
}

export function providerKeys(user: User) {
  return {
    hunter: decrypt(user.hunterKeyEnc) || process.env.HUNTER_API_KEY || "",
    apollo: decrypt(user.apolloKeyEnc) || process.env.APOLLO_API_KEY || "",
  };
}

/** Improves the AI's email guess with Hunter or Apollo when the user picked one. */
async function improveEmail(user: User, p: ResearchedPerson, provider: EmailProvider) {
  if (provider === "ai") return { email: p.email, conf: clamp(p.emailConfidence), source: "ai", note: p.emailBasis };
  const keys = providerKeys(user);
  try {
    const hit =
      provider === "hunter"
        ? keys.hunter && (await hunterFind(keys.hunter, p.name, p.bank, p.bankDomain))
        : keys.apollo && (await apolloFind(keys.apollo, p.name, p.bank, p.bankDomain));
    if (hit) {
      // If the provider agrees with the AI's guess, confidence goes up a bit.
      const agree = p.email && hit.email.toLowerCase() === p.email.toLowerCase();
      return { email: hit.email, conf: clamp(agree ? hit.confidence + 5 : hit.confidence), source: hit.source, note: hit.detail };
    }
    return { email: p.email, conf: clamp(p.emailConfidence), source: "ai", note: `${provider}: no match. ${p.emailBasis}` };
  } catch (e) {
    return { email: p.email, conf: clamp(p.emailConfidence), source: "ai", note: `${provider} failed (${(e as Error).message}). ${p.emailBasis}` };
  }
}

export async function saveResearched(user: User, people: ResearchedPerson[], provider: EmailProvider) {
  const db = await getDb();
  const existing = await db.select().from(schema.contacts).where(eq(schema.contacts.userId, user.id));
  const byEmail = new Set(existing.map((c) => c.email.toLowerCase()).filter(Boolean));
  const byName = new Set(existing.map((c) => key(c.name, c.bank)));
  const created: Contact[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const p of people) {
    if (!p.name.trim()) continue;
    if (byName.has(key(p.name, p.bank))) {
      skipped.push({ name: p.name, reason: "already in your sheet" });
      continue;
    }
    const em = await improveEmail(user, p, provider);
    const email = (em.email || "").trim().toLowerCase();
    if (email && byEmail.has(email)) {
      skipped.push({ name: p.name, reason: `${email} already in your sheet` });
      continue;
    }
    const [c] = await db
      .insert(schema.contacts)
      .values({
        userId: user.id,
        name: p.name.trim(),
        email,
        bank: p.bank,
        bankDomain: p.bankDomain,
        title: p.title,
        group: p.group,
        location: p.location,
        school: p.school,
        linkedinUrl: p.linkedinUrl,
        matchReasons: p.matchReasons,
        notes: [p.notes, em.note ? `Email: ${em.note}` : ""].filter(Boolean).join("\n"),
        sources: p.sources,
        emailConfidence: email ? em.conf : 0,
        infoConfidence: clamp(p.infoConfidence),
        emailSource: em.source,
        origin: "ai",
      })
      .returning();
    created.push(c);
    byName.add(key(p.name, p.bank));
    if (email) byEmail.add(email);
  }
  return { created, skipped };
}

export async function createDraft(user: User, contact: Contact, kind: "initial" | "follow_up", parent?: Email | null) {
  const db = await getDb();
  const rules = withDefaults(user.rules);
  const attachResume = rules.attachResumeByDefault && !!(user.resumePdfB64 || user.profile.resumeText);
  const d = await draftEmail({
    profile: user.profile,
    rules,
    contact,
    kind,
    previous: parent ?? null,
    attachResume,
    writingGuide: userGuide(user),
    guidelines: user.styleGuidelines,
    senderEmail: user.email,
  });
  const subject =
    kind === "follow_up" && parent ? (/^re:/i.test(parent.subject) ? parent.subject : `Re: ${parent.subject}`) : d.subject;
  const [e] = await db
    .insert(schema.emails)
    .values({
      userId: user.id,
      contactId: contact.id,
      kind,
      parentEmailId: parent?.id ?? null,
      to: contact.email ? [contact.email.toLowerCase()] : [],
      cc: cleanList(rules.defaultCc),
      bcc: cleanList(rules.defaultBcc),
      subject,
      body: d.body,
      aiSubject: subject,
      aiBody: d.body,
      rationale: rationaleOf(d),
      attachResume,
      status: "pending",
    })
    .returning();
  return e;
}

/** Draft many at once, with limited concurrency. */
export async function draftMany(user: User, contactList: Contact[]) {
  const out: Email[] = [];
  const errors: string[] = [];
  const queue = [...contactList];
  async function worker() {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        out.push(await createDraft(user, c, "initial"));
      } catch (e) {
        errors.push(`${c.name}: ${(e as Error).message}`);
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return { drafts: out, errors };
}

export async function getContact(user: User, id: string) {
  const db = await getDb();
  const [c] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.userId, user.id)));
  return c ?? null;
}

export function userGuide(user: User) {
  return user.writingGuide?.trim() ? user.writingGuide : DEFAULT_WRITING_GUIDE;
}

export function rationaleOf(d: DraftResult) {
  return {
    roleAndGroup: d.roleAndGroup,
    verifiedFacts: d.verifiedFacts,
    fromMyNotes: d.fromMyNotes,
    whyContact: d.whyContact,
    personalizationAngle: d.personalizationAngle,
    followUpQuestions: d.followUpQuestions,
    missingInfo: d.missingInfo,
    qualityCheck: d.qualityCheck,
  };
}
