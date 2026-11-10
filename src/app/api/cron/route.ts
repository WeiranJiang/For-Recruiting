import { isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { processDue } from "@/lib/send";
import { syncUser } from "@/lib/sync";

export const maxDuration = 300;

/**
 * Background worker. Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`.
 * External schedulers (cron-job.org, GitHub Actions) can call /api/cron?key=$CRON_SECRET every 5 minutes.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const auth = req.headers.get("authorization");
  if (!secret || (auth !== `Bearer ${secret}` && url.searchParams.get("key") !== secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const sent = await processDue();
  const db = await getDb();
  const users = await db.select().from(schema.users).where(isNotNull(schema.users.refreshTokenEnc));
  const synced: Record<string, unknown> = {};
  for (const u of users) {
    if (u.lastSyncAt && Date.now() - u.lastSyncAt.getTime() < 10 * 60_000) continue;
    try {
      synced[u.id] = await syncUser(u);
    } catch (e) {
      synced[u.id] = { error: (e as Error).message };
    }
  }
  return Response.json({ sent, synced: Object.keys(synced).length });
}
