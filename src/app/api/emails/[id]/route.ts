import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { handle, HttpError, requireUser } from "@/lib/session";
import { cleanList } from "@/lib/mime";

const Patch = z
  .object({
    to: z.union([z.array(z.string().max(320)).max(20), z.string().max(4000)]),
    cc: z.union([z.array(z.string().max(320)).max(20), z.string().max(4000)]),
    bcc: z.union([z.array(z.string().max(320)).max(20), z.string().max(4000)]),
    subject: z.string().max(300),
    body: z.string().max(20_000),
    attachResume: z.boolean(),
    requestedAt: z.string().datetime({ offset: true }).nullable(), // ISO time to force a send time; null = follow rules
    status: z.enum(["pending", "review"]), // swipe left = "review"; unschedule = "review"
    // Remaining proofreading suggestions after the user accepted one (so they survive the edit).
    grammar: z
      .object({
        smoothness: z.number(),
        summary: z.string().max(1000),
        issues: z.array(
          z.object({
            field: z.enum(["subject", "body"]),
            type: z.enum(["spelling", "grammar", "clarity"]),
            original: z.string().max(2000),
            suggestion: z.string().max(2000),
            reason: z.string().max(300),
          }),
        ).max(50),
        correctedSubject: z.string().max(300),
        correctedBody: z.string().max(20_000),
        checkedAt: z.string().max(40),
      })
      .nullable(),
  })
  .partial();

async function load(userId: string, id: string) {
  const db = await getDb();
  const [e] = await db.select().from(schema.emails).where(and(eq(schema.emails.id, id), eq(schema.emails.userId, userId)));
  if (!e) throw new HttpError(404, "Email not found");
  return e;
}

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/emails/[id]">) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const e = await load(u.id, id);
  const b = Patch.parse(await req.json());
  if (["sent", "sending", "deleted"].includes(e.status)) throw new HttpError(409, `Email is already ${e.status}`);
  const set: Partial<typeof e> = { updatedAt: new Date() };
  if (b.to !== undefined) set.to = cleanList(b.to);
  if (b.cc !== undefined) set.cc = cleanList(b.cc);
  if (b.bcc !== undefined) set.bcc = cleanList(b.bcc);
  if (b.subject !== undefined) set.subject = b.subject;
  if (b.body !== undefined) set.body = b.body;
  if (b.attachResume !== undefined) set.attachResume = b.attachResume;
  if (b.requestedAt !== undefined) set.requestedAt = b.requestedAt ? new Date(b.requestedAt) : null;
  if (b.grammar !== undefined) set.grammar = b.grammar;
  else if (b.subject !== undefined || b.body !== undefined) set.grammar = null;
  if (b.status) {
    set.status = b.status;
    set.scheduledAt = null;
  } else if (e.status === "scheduled") {
    // Editing a scheduled email pulls it back for review so nothing goes out unseen.
    set.status = "review";
    set.scheduledAt = null;
  }
  const db = await getDb();
  const [ne] = await db.update(schema.emails).set(set).where(eq(schema.emails.id, e.id)).returning();
  return Response.json({ email: ne });
});

export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/emails/[id]">) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const e = await load(u.id, id);
  if (e.status === "sent" || e.status === "sending") throw new HttpError(409, "Already sent");
  const db = await getDb();
  await db.update(schema.emails).set({ status: "deleted", scheduledAt: null, updatedAt: new Date() }).where(eq(schema.emails.id, e.id));
  return Response.json({ ok: true });
});
