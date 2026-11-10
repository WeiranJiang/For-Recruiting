import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { HttpError } from "./errors";

/** Cost units per AI action (rough proxy for Anthropic spend). */
export const AI_COST = {
  research: (count: number) => 10 + 2 * count,
  importEnrich: 10,
  importParse: 2,
  draft: 2,
  grammar: 1,
  rules: 1,
  style: 1,
  resume: 3,
} as const;

function dailyLimit() {
  const n = Number(process.env.AI_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 600;
}

/**
 * Atomically charges `units` against the user's daily AI budget (UTC day).
 * A single conditional UPDATE, so concurrent requests can't overspend.
 */
export async function chargeAi(userId: string, units: number) {
  const db = await getDb();
  const day = new Date().toISOString().slice(0, 10);
  const limit = dailyLimit();
  const rows = await db.execute(sql`
    UPDATE users SET ai_usage = CASE
        WHEN ai_usage->>'day' = ${day}
          THEN jsonb_build_object('day', ${day}::text, 'count', (ai_usage->>'count')::int + ${units}::int)
        ELSE jsonb_build_object('day', ${day}::text, 'count', ${units}::int)
      END
    WHERE id = ${userId}
      AND (ai_usage IS NULL OR ai_usage->>'day' IS DISTINCT FROM ${day}
           OR (ai_usage->>'count')::int + ${units}::int <= ${limit}::int)
    RETURNING id`);
  const count = Array.isArray(rows) ? rows.length : ((rows as { rows?: unknown[] }).rows?.length ?? 0);
  if (count === 0) throw new HttpError(429, "Daily AI limit reached. It resets at midnight UTC.");
}
