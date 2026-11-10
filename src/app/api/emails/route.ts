import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { handle, requireUser } from "@/lib/session";
import { findDuplicates, previewSlot } from "@/lib/send";
import { accuracyOf } from "@/lib/status";
import type { EmailStatus } from "@/lib/db/schema";

const ALL: EmailStatus[] = ["pending", "review", "scheduled", "sending", "sent", "failed"];

/** GET /api/emails?status=pending,review */
export const GET = handle(async (req: Request) => {
  const u = await requireUser();
  const want = (new URL(req.url).searchParams.get("status") ?? "pending").split(",").filter((s): s is EmailStatus => ALL.includes(s as EmailStatus));
  const db = await getDb();
  const rows = await db
    .select({ e: schema.emails, c: schema.contacts })
    .from(schema.emails)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.emails.contactId))
    .where(and(eq(schema.emails.userId, u.id), inArray(schema.emails.status, want.length ? want : ["pending"])))
    .orderBy(asc(schema.emails.createdAt))
    .limit(200);
  const out = [];
  for (const { e, c } of rows) {
    const editable = e.status === "pending" || e.status === "review" || e.status === "failed";
    out.push({
      ...e,
      contact: {
        id: c.id,
        name: c.name,
        email: c.email,
        bank: c.bank,
        title: c.title,
        group: c.group,
        school: c.school,
        linkedinUrl: c.linkedinUrl,
        matchReasons: c.matchReasons,
        sources: c.sources,
        notes: c.notes,
        myNotes: c.myNotes,
        emailConfidence: c.emailConfidence,
        infoConfidence: c.infoConfidence,
        emailSource: c.emailSource,
        accuracy: accuracyOf(c),
      },
      duplicates: editable ? await findDuplicates(u, e) : [],
      proposedAt: editable ? await previewSlot(u, e, c.bank) : null,
    });
  }
  return Response.json({ emails: out, resume: { hasPdf: !!u.resumePdfB64, filename: u.resumeFilename } });
});
