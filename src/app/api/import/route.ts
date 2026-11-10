import { z } from "zod";
import { handle, requireUser } from "@/lib/session";
import { AI_COST, chargeAi } from "@/lib/quota";
import { userError } from "@/lib/errors";
import { lookupSpecificPeople, parseImport, type ResearchedPerson } from "@/lib/ai";
import { draftMany, saveResearched } from "@/lib/contacts";

export const maxDuration = 300;

const Body = z.object({
  text: z.string().min(1).max(100_000),
  enrich: z.boolean().default(false), // look each person up on the web to fill gaps + score accuracy
  provider: z.enum(["ai", "hunter", "apollo"]).default("ai"),
  draft: z.boolean().default(true),
});

/** Paste a list (CSV, spreadsheet rows, notes). Optionally enrich via web search and email providers. */
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const b = Body.parse(await req.json());
  await chargeAi(u.id, AI_COST.importParse + (b.enrich ? AI_COST.importEnrich : 0));
  const parsed = await parseImport(b.text);
  if (!parsed.length) throw userError("Couldn't find any people in that text.");
  let people: ResearchedPerson[] = parsed.map((p) => ({
    ...p,
    bankDomain: p.email.includes("@") ? p.email.split("@")[1] : "",
    emailBasis: p.email ? "provided by you" : "",
    // An address the user typed in is taken as given; we can't verify it without a provider.
    emailConfidence: p.email ? 80 : 0,
    matchReasons: [],
    sources: [],
  }));
  if (b.enrich) {
    const found = await lookupSpecificPeople({
      profile: u.profile,
      people: parsed.slice(0, 15).map((p) => ({ name: p.name, bank: p.bank, hint: [p.title, p.group, p.school].filter(Boolean).join(", ") })),
    });
    const byName = new Map(found.map((f) => [f.name.toLowerCase(), f]));
    people = people.map((p) => {
      const f = byName.get(p.name.toLowerCase());
      if (!f) return { ...p, infoConfidence: Math.min(p.infoConfidence, 40) };
      const keepEmail = !!p.email;
      return {
        ...f,
        name: p.name,
        email: keepEmail ? p.email : f.email,
        emailBasis: keepEmail ? (f.email && f.email.toLowerCase() === p.email.toLowerCase() ? "provided by you; matches web pattern" : "provided by you") : f.emailBasis,
        emailConfidence: keepEmail ? (f.email.toLowerCase() === p.email.toLowerCase() ? 90 : 75) : f.emailConfidence,
        notes: [p.notes, f.notes].filter(Boolean).join("\n"),
      };
    });
  }
  const { created, skipped } = await saveResearched(u, people, b.provider);
  const drafted = b.draft ? await draftMany(u, created.filter((c) => c.email)) : { drafts: [], errors: [] };
  return Response.json({
    found: parsed.length,
    created: created.length,
    skipped,
    drafted: drafted.drafts.length,
    errors: drafted.errors,
    noEmail: created.filter((c) => !c.email).map((c) => c.name),
  });
});
