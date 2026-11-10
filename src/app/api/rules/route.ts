import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { handle, requireUser } from "@/lib/session";
import { AI_COST, chargeAi } from "@/lib/quota";
import { userError } from "@/lib/errors";
import { updateRulesFromChat } from "@/lib/ai";
import { DEFAULT_RULES, withDefaults } from "@/lib/rules";
import { publicUser } from "@/lib/views";

export const maxDuration = 60;

/** Chat box: the user describes scheduling/format rules in plain English; Claude updates the JSON settings. */
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const { message, reset } = z.object({ message: z.string().max(2000).default(""), reset: z.boolean().optional() }).parse(await req.json());
  const db = await getDb();
  if (reset) {
    const [nu] = await db.update(schema.users).set({ rules: DEFAULT_RULES, rulesChat: [] }).where(eq(schema.users.id, u.id)).returning();
    return Response.json({ user: publicUser(nu) });
  }
  if (!message.trim()) throw userError("Type a rule first");
  await chargeAi(u.id, AI_COST.rules);
  const res = await updateRulesFromChat({ current: withDefaults(u.rules), history: u.rulesChat, message });
  const chat = [...u.rulesChat, { role: "user" as const, text: message }, { role: "assistant" as const, text: res.reply }].slice(-30);
  const [nu] = await db
    .update(schema.users)
    .set({ rules: withDefaults(res.rules), rulesChat: chat })
    .where(eq(schema.users.id, u.id))
    .returning();
  return Response.json({ user: publicUser(nu), reply: res.reply });
});
