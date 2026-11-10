import type { Contact, Email } from "./db/schema";
import { businessDaysBetween, type Rules } from "./rules";

export type ContactStatus =
  | "Not contacted"
  | "Draft"
  | "Scheduled"
  | "Sent"
  | "Replied"
  | "Bounced"
  | "Not sent";

export type SheetRow = {
  id: string;
  name: string;
  email: string;
  bank: string;
  group: string;
  title: string;
  location: string;
  school: string;
  linkedinUrl: string;
  matchReasons: string[];
  emailConfidence: number;
  infoConfidence: number;
  accuracy: number;
  emailSource: string;
  sources: { url: string; title?: string }[];
  status: ContactStatus;
  firstSentAt: string | null;
  lastSentAt: string | null;
  scheduledAt: string | null;
  repliedAt: string | null;
  replySnippet: string | null;
  emailsSent: number;
  followUpsSent: number;
  flagged: boolean;
  flagReason: string | null;
  followUpDue: boolean;
  followUpOverdueDays: number;
  lastEmailId: string | null;
  notes: string;
  myNotes: string;
};

/** Combined "how likely is this right" score shown everywhere. */
export function accuracyOf(c: Pick<Contact, "emailConfidence" | "infoConfidence">) {
  return Math.round(0.6 * c.emailConfidence + 0.4 * c.infoConfidence);
}

export function sheetRow(c: Contact, emails: Email[], rules: Rules, now = new Date()): SheetRow {
  const live = emails.filter((e) => e.status !== "deleted");
  const sent = live.filter((e) => e.status === "sent").sort((a, b) => +a.sentAt! - +b.sentAt!);
  const scheduled = live.filter((e) => e.status === "scheduled" || e.status === "sending");
  const drafts = live.filter((e) => e.status === "pending" || e.status === "review");
  const failed = live.filter((e) => e.status === "failed");
  const replied = live.find((e) => e.repliedAt);
  const last = sent[sent.length - 1];

  // Flag: every recipient bounced (all_bounced) or Gmail refused to send. One delivered recipient = fine.
  const lastAttempt = [...sent, ...failed].sort(
    (a, b) => +(a.sentAt ?? a.updatedAt) - +(b.sentAt ?? b.updatedAt),
  ).at(-1);
  let flagReason: string | null = null;
  if (lastAttempt?.status === "failed") flagReason = `Not sent: ${lastAttempt.error ?? "Gmail error"}`;
  else if (lastAttempt?.deliveryStatus === "all_bounced")
    flagReason = `Bounced: ${lastAttempt.bouncedRecipients.join(", ")}`;

  let status: ContactStatus = "Not contacted";
  if (replied) status = "Replied";
  else if (flagReason?.startsWith("Bounced")) status = "Bounced";
  else if (flagReason?.startsWith("Not sent")) status = "Not sent";
  else if (scheduled.length) status = sent.length ? "Sent" : "Scheduled";
  else if (sent.length) status = "Sent";
  else if (drafts.length) status = "Draft";

  const followUpsSent = sent.filter((e) => e.kind === "follow_up").length;
  let followUpDue = false;
  let overdue = 0;
  if (status === "Sent" && last && !scheduled.length && followUpsSent < rules.maxFollowUps) {
    const bd = businessDaysBetween(last.sentAt!, now);
    overdue = bd - rules.followUpAfterBusinessDays;
    followUpDue = overdue >= 0;
  }

  return {
    id: c.id,
    name: c.name,
    email: c.email,
    bank: c.bank,
    group: c.group,
    title: c.title,
    location: c.location,
    school: c.school,
    linkedinUrl: c.linkedinUrl,
    matchReasons: c.matchReasons,
    emailConfidence: c.emailConfidence,
    infoConfidence: c.infoConfidence,
    accuracy: accuracyOf(c),
    emailSource: c.emailSource,
    sources: c.sources,
    status,
    firstSentAt: sent[0]?.sentAt?.toISOString() ?? null,
    lastSentAt: last?.sentAt?.toISOString() ?? null,
    scheduledAt: scheduled[0]?.scheduledAt?.toISOString() ?? null,
    repliedAt: replied?.repliedAt?.toISOString() ?? null,
    replySnippet: replied?.replySnippet ?? null,
    emailsSent: sent.length,
    followUpsSent,
    flagged: !!flagReason,
    flagReason,
    followUpDue,
    followUpOverdueDays: Math.max(0, overdue),
    lastEmailId: last?.id ?? null,
    notes: c.notes,
    myNotes: c.myNotes,
  };
}
