import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import type { Rules } from "../rules";

export type Profile = {
  fullName: string;
  school: string;
  gradYear: string;
  major: string;
  hometown: string;
  pastExperience: string; // past internships / clubs, free text
  interests: string; // groups / products of interest
  signature: string;
  phone?: string;
  /** Free-text description of who to reach out to (schools, past internships, groups, affinity orgs ...). */
  targeting: string;
  resumeText: string;
};

export const EMPTY_PROFILE: Profile = {
  fullName: "",
  school: "",
  gradYear: "",
  major: "",
  hometown: "",
  pastExperience: "",
  interests: "",
  signature: "",
  phone: "",
  targeting: "",
  resumeText: "",
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  refreshTokenEnc: text("refresh_token_enc"),
  profile: jsonb("profile").$type<Profile>().notNull().default(EMPTY_PROFILE),
  rules: jsonb("rules").$type<Rules | null>(),
  /** The master writing prompt (editable). Null = use DEFAULT_WRITING_GUIDE. */
  writingGuide: text("writing_guide"),
  /** Guidelines learned from this user's edits and feedback, layered on top of the writing guide. */
  styleGuidelines: jsonb("style_guidelines").$type<string[]>().notNull().default([]),
  styleChat: jsonb("style_chat").$type<{ role: "user" | "assistant"; text: string }[]>().notNull().default([]),
  rulesChat: jsonb("rules_chat").$type<{ role: "user" | "assistant"; text: string }[]>().notNull().default([]),
  resumePdfB64: text("resume_pdf_b64"),
  resumeFilename: text("resume_filename"),
  hunterKeyEnc: text("hunter_key_enc"),
  apolloKeyEnc: text("apollo_key_enc"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Source = { url: string; title?: string };

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull().default(""),
    bank: text("bank").notNull().default(""),
    bankDomain: text("bank_domain").notNull().default(""),
    title: text("title").notNull().default(""),
    group: text("group_name").notNull().default(""),
    location: text("location").notNull().default(""),
    school: text("school").notNull().default(""),
    linkedinUrl: text("linkedin_url").notNull().default(""),
    matchReasons: jsonb("match_reasons").$type<string[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    /** The user's own notes (where we met, what we talked about). Treated as "from my notes", not verified fact. */
    myNotes: text("my_notes").notNull().default(""),
    sources: jsonb("sources").$type<Source[]>().notNull().default([]),
    /** 0-100: how sure we are the email address is right */
    emailConfidence: integer("email_confidence").notNull().default(0),
    /** 0-100: how sure we are the person/role/bank info is right */
    infoConfidence: integer("info_confidence").notNull().default(0),
    emailSource: text("email_source").notNull().default("ai"), // ai | hunter | apollo | import
    origin: text("origin").notNull().default("ai"), // ai | import
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contacts_user_idx").on(t.userId), index("contacts_email_idx").on(t.userId, t.email)],
);

export type EmailStatus =
  | "pending" // in the swipe deck
  | "review" // swiped left
  | "scheduled"
  | "sending"
  | "sent"
  | "failed" // Gmail refused to send
  | "deleted";

export type DeliveryStatus = "unknown" | "delivered" | "partial_bounce" | "all_bounced";

export type DraftRationale = {
  roleAndGroup: string;
  verifiedFacts: string[];
  fromMyNotes: string[];
  whyContact: string;
  personalizationAngle: string;
  followUpQuestions: string[];
  missingInfo: string[];
  qualityCheck: string;
};

export type GrammarReport = {
  smoothness: number;
  summary: string;
  issues: { field: "subject" | "body"; type: "spelling" | "grammar" | "clarity"; original: string; suggestion: string; reason: string }[];
  correctedSubject: string;
  correctedBody: string;
  checkedAt: string;
};

export const emails = pgTable(
  "emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"initial" | "follow_up">().notNull().default("initial"),
    parentEmailId: uuid("parent_email_id"),
    to: jsonb("to_addrs").$type<string[]>().notNull().default([]),
    cc: jsonb("cc_addrs").$type<string[]>().notNull().default([]),
    bcc: jsonb("bcc_addrs").$type<string[]>().notNull().default([]),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    /** What the AI originally wrote, so we can learn from the user's edits. */
    aiSubject: text("ai_subject"),
    aiBody: text("ai_body"),
    rationale: jsonb("rationale").$type<DraftRationale | null>(),
    learnedFromEdit: boolean("learned_from_edit").notNull().default(false),
    attachResume: boolean("attach_resume").notNull().default(true),
    status: text("status").$type<EmailStatus>().notNull().default("pending"),
    /** user-forced send time (overrides the rules engine) */
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    gmailMessageId: text("gmail_message_id"),
    gmailThreadId: text("gmail_thread_id"),
    rfcMessageId: text("rfc_message_id"),
    error: text("error"),
    bouncedRecipients: jsonb("bounced_recipients").$type<string[]>().notNull().default([]),
    deliveryStatus: text("delivery_status").$type<DeliveryStatus>().notNull().default("unknown"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    replySnippet: text("reply_snippet"),
    grammar: jsonb("grammar").$type<GrammarReport | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("emails_user_status_idx").on(t.userId, t.status),
    index("emails_contact_idx").on(t.contactId),
    index("emails_due_idx").on(t.status, t.scheduledAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Email = typeof emails.$inferSelect;
