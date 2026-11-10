import { z } from "zod";
import { handle, requireUser } from "@/lib/session";
import { grammarCheck } from "@/lib/ai";
import { userGuide } from "@/lib/contacts";

export const maxDuration = 60;

/** Live, stateless check used while the user types (Grammarly-style underlines). */
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const { subject, body } = z.object({ subject: z.string().max(500), body: z.string().max(8000) }).parse(await req.json());
  if (!body.trim()) return Response.json({ grammar: null });
  const r = await grammarCheck(subject, body, userGuide(u), u.styleGuidelines);
  return Response.json({ grammar: { ...r, smoothness: Math.max(0, Math.min(100, r.smoothness)), checkedAt: new Date().toISOString() } });
});
