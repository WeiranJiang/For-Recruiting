import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { learnFromEdit } from "./ai";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** If the user changed the AI's draft before approving, distil reusable style guidelines from the edit. */
export async function learnFromApprovedEdit(userId: string, emailId: string) {
  const db = await getDb();
  const [e] = await db.select().from(schema.emails).where(eq(schema.emails.id, emailId));
  if (!e || e.learnedFromEdit || !e.aiBody) return;
  const changed = norm(e.aiBody) !== norm(e.body) || norm(e.aiSubject ?? "") !== norm(e.subject);
  await db.update(schema.emails).set({ learnedFromEdit: true }).where(eq(schema.emails.id, e.id));
  if (!changed) return;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) return;
  const res = await learnFromEdit({
    guidelines: u.styleGuidelines,
    aiSubject: e.aiSubject ?? "",
    aiBody: e.aiBody,
    finalSubject: e.subject,
    finalBody: e.body,
  });
  const chat = [...u.styleChat, { role: "assistant" as const, text: `Learned from your edit to the email for ${e.to[0] ?? "a contact"}: ${res.reply}` }].slice(-40);
  await db
    .update(schema.users)
    .set({ styleGuidelines: res.guidelines.slice(0, 25), styleChat: chat })
    .where(eq(schema.users.id, userId));
}
