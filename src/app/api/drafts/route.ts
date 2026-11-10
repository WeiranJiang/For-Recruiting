import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { handle, requireUser } from "@/lib/session";
import { createDraft } from "@/lib/contacts";

export const maxDuration = 300;

/** Generate initial drafts or follow-ups for the given contacts. */
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const b = z.object({ contactIds: z.array(z.string().uuid()).min(1).max(25), kind: z.enum(["initial", "follow_up"]) }).parse(await req.json());
  const db = await getDb();
  const cs = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.userId, u.id), inArray(schema.contacts.id, b.contactIds)));
  const errors: string[] = [];
  let made = 0;
  await Promise.all(
    cs.map(async (c) => {
      try {
        if (!c.email) throw new Error("no email address");
        const open = await db
          .select({ id: schema.emails.id })
          .from(schema.emails)
          .where(and(eq(schema.emails.contactId, c.id), inArray(schema.emails.status, ["pending", "review", "scheduled"])));
        if (open.length) throw new Error("already has a draft or scheduled email");
        if (b.kind === "follow_up") {
          const [parent] = await db
            .select()
            .from(schema.emails)
            .where(and(eq(schema.emails.contactId, c.id), eq(schema.emails.status, "sent")))
            .orderBy(desc(schema.emails.sentAt))
            .limit(1);
          if (!parent) throw new Error("nothing sent yet to follow up on");
          if (parent.repliedAt) throw new Error("they already replied");
          await createDraft(u, c, "follow_up", parent);
        } else {
          const sent = await db
            .select({ id: schema.emails.id })
            .from(schema.emails)
            .where(and(eq(schema.emails.contactId, c.id), inArray(schema.emails.status, ["sent", "sending"])));
          if (sent.length) throw new Error("already emailed — use a follow-up instead");
          await createDraft(u, c, "initial");
        }
        made++;
      } catch (e) {
        errors.push(`${c.name}: ${(e as Error).message}`);
      }
    }),
  );
  return Response.json({ drafted: made, errors });
});
