import crypto from "node:crypto";
import { logError } from "@/lib/errors";
import { isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { processDue } from "@/lib/send";
import { syncUser } from "@/lib/sync";

export const maxDuration = 300;

function timingSafeEqualStr(a: string, b: string) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Background worker. Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`.
 * External schedulers (cron-job.org, GitHub Actions) can call /api/cron?key=$CRON_SECRET every 5 minutes.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const presented = bearer || url.searchParams.get("key") || "";
  if (!secret || secret.length < 24 || !timingSafeEqualStr(presented, secret)) {
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
      logError("cron-sync", e);
      synced[u.id] = { error: true };
    }
  }
  return Response.json({ sent, synced: Object.keys(synced).length });
}
