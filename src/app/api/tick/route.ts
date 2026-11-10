import { handle, requireUser } from "@/lib/session";
import { processDue } from "@/lib/send";
import { syncUser } from "@/lib/sync";

export const maxDuration = 120;

/** Called by the open app every minute: sends this user's due emails and checks Gmail for replies/bounces. */
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const force = new URL(req.url).searchParams.get("sync") === "1";
  const sent = await processDue(u.id);
  let sync = null;
  if (force || !u.lastSyncAt || Date.now() - u.lastSyncAt.getTime() > 5 * 60_000) {
    try {
      sync = await syncUser(u);
    } catch (e) {
      sync = { error: (e as Error).message };
    }
  }
  return Response.json({ sent, sync });
});
