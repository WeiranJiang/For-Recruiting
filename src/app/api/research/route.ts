import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { handle, requireUser } from "@/lib/session";
import { researchPeople } from "@/lib/ai";
import { draftMany, saveResearched } from "@/lib/contacts";

export const maxDuration = 300;

const Body = z.object({
  query: z.string().default(""),
  count: z.number().int().min(1).max(15).default(5),
  provider: z.enum(["ai", "hunter", "apollo"]).default("ai"),
  draft: z.boolean().default(true),
});

/** AI web search for people matching the user's targeting text (+ this query). Creates contacts and drafts. */
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const b = Body.parse(await req.json());
  if (!b.query.trim() && !u.profile.targeting.trim())
    throw new Error("Describe who you want to reach (Setup → Targeting) or type a search.");
  const db = await getDb();
  const existing = await db.select({ name: schema.contacts.name, bank: schema.contacts.bank }).from(schema.contacts).where(eq(schema.contacts.userId, u.id));
  const people = await researchPeople({
    profile: u.profile,
    query: b.query,
    count: b.count,
    excludeNames: existing.map((e) => `${e.name} (${e.bank})`),
  });
  const { created, skipped } = await saveResearched(u, people, b.provider);
  const withEmail = created.filter((c) => c.email);
  const drafted = b.draft ? await draftMany(u, withEmail) : { drafts: [], errors: [] };
  return Response.json({
    found: people.length,
    created: created.length,
    skipped,
    drafted: drafted.drafts.length,
    errors: drafted.errors,
    noEmail: created.filter((c) => !c.email).map((c) => c.name),
  });
});

