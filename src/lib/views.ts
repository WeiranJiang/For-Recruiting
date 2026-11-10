import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { Email, User } from "./db/schema";
import { describeRules, normalizeBank, withDefaults } from "./rules";
import { providerKeys } from "./contacts";
import { sheetRow } from "./status";
import { DEFAULT_WRITING_GUIDE } from "./master-prompt";
import { calendarConnected } from "./google";
import { withAvailabilityDefaults } from "./availability";

export function publicUser(u: User) {
  const rules = withDefaults(u.rules);
  const keys = providerKeys(u);
  return {
    email: u.email,
    name: u.name,
    profile: u.profile,
    rules,
    rulesSummary: describeRules(rules),
    rulesChat: u.rulesChat,
    writingGuide: u.writingGuide?.trim() ? u.writingGuide : DEFAULT_WRITING_GUIDE,
    writingGuideIsDefault: !u.writingGuide?.trim(),
    styleGuidelines: u.styleGuidelines,
    styleChat: u.styleChat,
    resume: { filename: u.resumeFilename, hasPdf: !!u.resumePdfB64, hasText: !!u.profile.resumeText },
    providers: { ai: true, hunter: !!keys.hunter, apollo: !!keys.apollo },
    gmailConnected: !!u.refreshTokenEnc,
    calendarConnected: calendarConnected(u),
    availability: withAvailabilityDefaults(u.availability),
    lastSyncAt: u.lastSyncAt,
  };
}

export async function loadSheet(userId: string, rulesRaw: Parameters<typeof withDefaults>[0]) {
  const db = await getDb();
  const rules = withDefaults(rulesRaw);
  const [cs, es] = await Promise.all([
    db.select().from(schema.contacts).where(eq(schema.contacts.userId, userId)),
    db.select().from(schema.emails).where(eq(schema.emails.userId, userId)),
  ]);
  const byContact = new Map<string, Email[]>();
  for (const e of es) byContact.set(e.contactId, [...(byContact.get(e.contactId) ?? []), e]);
  const rows = cs.filter((c) => !c.archived).map((c) => sheetRow(c, byContact.get(c.id) ?? [], rules));
  // Per-bank stats to help "optimise" who to hit next.
  const banks = new Map<string, { bank: string; contacts: number; sent: number; replied: number; bounced: number; scheduled: number }>();
  for (const r of rows) {
    const k = normalizeBank(r.bank) || "(unknown)";
    const s = banks.get(k) ?? { bank: r.bank || "(unknown)", contacts: 0, sent: 0, replied: 0, bounced: 0, scheduled: 0 };
    s.contacts++;
    if (r.emailsSent) s.sent++;
    if (r.status === "Replied") s.replied++;
    if (r.flagged) s.bounced++;
    if (r.scheduledAt) s.scheduled++;
    banks.set(k, s);
  }
  return { rows, banks: [...banks.values()].sort((a, b) => b.contacts - a.contacts) };
}
