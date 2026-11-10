import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { handle, HttpError, requireUser } from "@/lib/session";
import { getContact } from "@/lib/contacts";
import { isValidEmail, safeUrl } from "@/lib/mime";

const Patch = z
  .object({
    name: z.string().max(200),
    email: z.string().max(320),
    bank: z.string().max(200),
    title: z.string().max(200),
    group: z.string().max(200),
    location: z.string().max(200),
    school: z.string().max(200),
    linkedinUrl: z.string().max(500),
    notes: z.string().max(5000),
    myNotes: z.string().max(5000),
    emailConfidence: z.number().int().min(0).max(100),
    infoConfidence: z.number().int().min(0).max(100),
  })
  .partial();

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/contacts/[id]">) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const c = await getContact(u, id);
  if (!c) throw new HttpError(404, "Contact not found");
  const b = Patch.parse(await req.json());
  const db = await getDb();
  const set: Partial<typeof c> = { ...b };
  if (b.linkedinUrl !== undefined) set.linkedinUrl = safeUrl(b.linkedinUrl);
  if (b.email !== undefined && b.email.trim() && !isValidEmail(b.email.trim())) throw new HttpError(400, "That email address doesn't look valid.");
  if (b.email !== undefined) {
    set.email = b.email.trim().toLowerCase();
    if (set.email !== c.email && b.emailConfidence === undefined) {
      set.emailSource = "manual";
      set.emailConfidence = 80;
    }
    // keep unsent drafts pointed at the new address
    const drafts = await db
      .select()
      .from(schema.emails)
      .where(and(eq(schema.emails.contactId, c.id), inArray(schema.emails.status, ["pending", "review", "failed"])));
    for (const d of drafts) {
      const to = d.to.filter((a) => a !== c.email);
      if (set.email) to.unshift(set.email);
      await db.update(schema.emails).set({ to, updatedAt: new Date() }).where(eq(schema.emails.id, d.id));
    }
  }
  const [nc] = await db.update(schema.contacts).set(set).where(eq(schema.contacts.id, c.id)).returning();
  return Response.json({ contact: nc });
});

export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/contacts/[id]">) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const c = await getContact(u, id);
  if (!c) throw new HttpError(404, "Contact not found");
  const db = await getDb();
  // Archive (not delete) so the "never email the same person twice" history is kept.
  await db.update(schema.contacts).set({ archived: true }).where(eq(schema.contacts.id, c.id));
  await db
    .update(schema.emails)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(schema.emails.contactId, c.id), inArray(schema.emails.status, ["pending", "review", "scheduled", "failed"])));
  return Response.json({ ok: true });
});
