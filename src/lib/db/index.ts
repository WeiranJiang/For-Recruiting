import "server-only";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import postgres from "postgres";
import * as schema from "./schema";
import { SCHEMA_SQL } from "./schema-sql";

type DB = ReturnType<typeof drizzlePg<typeof schema>>;

const g = globalThis as unknown as { __db?: DB; __dbReady?: Promise<void> };

function create(): { db: DB; exec: (sql: string) => Promise<unknown> } {
  const url = process.env.DATABASE_URL ?? "";
  if (!url && process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. In Vercel, open Storage → add a Neon Postgres database to this project, then redeploy.");
  }
  if (!url || url.startsWith("pglite:")) {
    // Local/dev fallback: embedded Postgres stored on disk. Not for serverless production.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
    const dir = url.replace(/^pglite:/, "") || "./.data/pglite";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("node:fs") as typeof import("node:fs")).mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    const db = drizzleLite(client, { schema }) as unknown as DB;
    return { db, exec: (s) => client.exec(s) };
  }
  const client = postgres(url, { prepare: false, max: 5 });
  const db = drizzlePg(client, { schema });
  return { db, exec: (s) => client.unsafe(s) };
}

function init() {
  if (!g.__db) {
    const { db, exec } = create();
    g.__db = db;
    g.__dbReady = exec(SCHEMA_SQL).then(
      () => undefined,
      (e) => {
        // Let the next request retry instead of caching the failure forever.
        g.__db = undefined;
        throw e;
      },
    );
  }
  return g.__db;
}

/** Returns the database after making sure the tables exist (idempotent). */
export async function getDb(): Promise<DB> {
  const db = init();
  await g.__dbReady;
  return db;
}

export { schema };
