import { logError } from "@/lib/errors";
import { after } from "next/server";
import { z } from "zod";
import { handle, requireUser } from "@/lib/session";
import { approveEmail } from "@/lib/send";
import { learnFromApprovedEdit } from "@/lib/style";

export const maxDuration = 60;

/** Swipe right. Body: { force?: boolean } to send despite a duplicate warning. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/emails/[id]/approve">) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const { force } = z.object({ force: z.boolean().optional() }).parse(await req.json().catch(() => ({})));
  const res = await approveEmail(u, id, { force });
  // After responding, learn from how the user edited the AI draft (if they did).
  if (res.ok) after(() => learnFromApprovedEdit(u.id, id).catch((e) => logError("learn", e)));
  return Response.json(res, { status: res.ok ? 200 : 422 });
});
