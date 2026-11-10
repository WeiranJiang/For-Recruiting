import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { handle, requireUser } from "@/lib/session";
import { AI_COST, chargeAi } from "@/lib/quota";
import { updateStyleFromChat } from "@/lib/ai";
import { publicUser } from "@/lib/views";

export const maxDuration = 60;

const Body = z.object({
  message: z.string().max(2000).optional(), // writing feedback in plain words
  guidelines: z.array(z.string().max(400)).max(40).optional(), // direct edit of the learned list
  writingGuide: z.string().max(40_000).nullable().optional(), // edit the master prompt; null = restore default
});

export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const b = Body.parse(await req.json());
  const db = await getDb();
  const set: Partial<typeof u> = {};
  let reply: string | null = null;
  if (b.writingGuide !== undefined) set.writingGuide = b.writingGuide;
  if (b.guidelines) set.styleGuidelines = b.guidelines.map((g) => g.trim()).filter(Boolean).slice(0, 25);
  if (b.message?.trim()) {
    await chargeAi(u.id, AI_COST.style);
    const res = await updateStyleFromChat({ guidelines: set.styleGuidelines ?? u.styleGuidelines, history: u.styleChat, message: b.message });
    reply = res.reply;
    set.styleGuidelines = res.guidelines.slice(0, 25);
    set.styleChat = [...u.styleChat, { role: "user" as const, text: b.message }, { role: "assistant" as const, text: res.reply }].slice(-40);
  }
  const [nu] = await db.update(schema.users).set(set).where(eq(schema.users.id, u.id)).returning();
  return Response.json({ user: publicUser(nu), reply });
});
