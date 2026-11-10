import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { handle, HttpError, requireUser } from "@/lib/session";
import { AI_COST, chargeAi } from "@/lib/quota";
import { grammarCheck } from "@/lib/ai";
import { userGuide } from "@/lib/contacts";

export const maxDuration = 60;

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/emails/[id]/grammar">) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const db = await getDb();
  const [e] = await db.select().from(schema.emails).where(and(eq(schema.emails.id, id), eq(schema.emails.userId, u.id)));
  if (!e) throw new HttpError(404, "Email not found");
  await chargeAi(u.id, AI_COST.grammar);
  const r = await grammarCheck(e.subject, e.body, userGuide(u), u.styleGuidelines);
  const grammar = { ...r, smoothness: Math.max(0, Math.min(100, r.smoothness)), checkedAt: new Date().toISOString() };
  await db.update(schema.emails).set({ grammar }).where(eq(schema.emails.id, e.id));
  return Response.json({ grammar });
});
