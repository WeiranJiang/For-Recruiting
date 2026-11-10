"use client";

import type { Availability } from "@/lib/availability";
export type { Availability };

export type Rules = {
  timezone: string;
  sendDays: number[];
  windows: { start: string; end: string }[];
  minMinutesBetweenAnyEmails: number;
  minHoursBetweenSameBank: number;
  maxPerBankPerDay: number;
  maxPerBankPerWeek: number;
  maxPerDay: number;
  jitterMinutes: number;
  followUpAfterBusinessDays: number;
  maxFollowUps: number;
  defaultCc: string[];
  defaultBcc: string[];
  subjectTemplate: string;
  emailFormat: string;
  maxWords: number;
  attachResumeByDefault: boolean;
};

export type Profile = {
  fullName: string;
  school: string;
  gradYear: string;
  major: string;
  hometown: string;
  pastExperience: string;
  interests: string;
  signature: string;
  phone?: string;
  targeting: string;
  resumeText: string;
};

export type ChatMsg = { role: "user" | "assistant"; text: string };

export type Me = {
  email: string;
  name: string;
  profile: Profile;
  rules: Rules;
  rulesSummary: string[];
  rulesChat: ChatMsg[];
  writingGuide: string;
  writingGuideIsDefault: boolean;
  styleGuidelines: string[];
  styleChat: ChatMsg[];
  resume: { filename: string | null; hasPdf: boolean; hasText: boolean };
  providers: { ai: boolean; hunter: boolean; apollo: boolean };
  gmailConnected: boolean;
  calendarConnected: boolean;
  availability: Availability;
  lastSyncAt: string | null;
};

export type Rationale = {
  roleAndGroup: string;
  verifiedFacts: string[];
  fromMyNotes: string[];
  whyContact: string;
  personalizationAngle: string;
  followUpQuestions: string[];
  missingInfo: string[];
  qualityCheck: string;
};

export type GrammarIssue = {
  field: "subject" | "body";
  type: "spelling" | "grammar" | "clarity";
  original: string;
  suggestion: string;
  reason: string;
};

export type Grammar = {
  smoothness: number;
  summary: string;
  issues: GrammarIssue[];
  correctedSubject: string;
  correctedBody: string;
  checkedAt: string;
};

export type Dup = { address: string; emailId: string; when: string | null; subject: string; status: string };

export type EmailCard = {
  id: string;
  kind: "initial" | "follow_up";
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachResume: boolean;
  status: string;
  requestedAt: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  error: string | null;
  grammar: Grammar | null;
  rationale: Rationale | null;
  deliveryStatus: string;
  bouncedRecipients: string[];
  repliedAt: string | null;
  proposedAt: string | null;
  duplicates: Dup[];
  contact: {
    id: string;
    name: string;
    email: string;
    bank: string;
    title: string;
    group: string;
    school: string;
    linkedinUrl: string;
    matchReasons: string[];
    sources: { url: string; title?: string }[];
    notes: string;
    myNotes: string;
    emailConfidence: number;
    infoConfidence: number;
    emailSource: string;
    accuracy: number;
  };
};

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
  status: string;
  firstSentAt: string | null;
  lastSentAt: string | null;
  scheduledAt: string | null;
  repliedAt: string | null;
  replySnippet: string | null;
  autoReplyAt: string | null;
  autoReplySnippet: string | null;
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

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string; reason?: string }).error ?? (data as { reason?: string }).reason ?? res.statusText, res.status, data);
  return data as T;
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function wordCount(s: string) {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/** Render-time guard: only http(s) links are ever put in an href. */
export function safeHref(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
