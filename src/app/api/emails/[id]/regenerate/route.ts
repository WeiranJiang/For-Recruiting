import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { handle, HttpError, requireUser } from "@/lib/session";
import { AI_COST, chargeAi } from "@/lib/quota";
import { draftEmail } from "@/lib/ai";
import { withDefaults } from "@/lib/rules";
import { rationaleOf, userGuide } from "@/lib/contacts";

export const maxDuration = 60;

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/emails/[id]/regenerate">) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const db = await getDb();
  const [row] = await db
    .select({ e: schema.emails, c: schema.contacts })
    .from(schema.emails)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.emails.contactId))
    .where(and(eq(schema.emails.id, id), eq(schema.emails.userId, u.id)));
  if (!row) throw new HttpError(404, "Email not found");
  const parent = row.e.parentEmailId
    ? (await db.select().from(schema.emails).where(eq(schema.emails.id, row.e.parentEmailId)))[0]
    : null;
  await chargeAi(u.id, AI_COST.draft);
  const d = await draftEmail({
    profile: u.profile,
    rules: withDefaults(u.rules),
    contact: row.c,
    kind: row.e.kind,
    previous: parent,
    attachResume: row.e.attachResume,
    writingGuide: userGuide(u),
    guidelines: u.styleGuidelines,
    senderEmail: u.email,
  });
  const [ne] = await db
    .update(schema.emails)
    .set({
      subject: row.e.kind === "follow_up" ? row.e.subject : d.subject,
      body: d.body,
      aiSubject: row.e.kind === "follow_up" ? row.e.subject : d.subject,
      aiBody: d.body,
      rationale: rationaleOf(d),
      grammar: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.emails.id, id))
    .returning();
  return Response.json({ email: ne });
});
