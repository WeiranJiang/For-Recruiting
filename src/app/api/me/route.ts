import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { currentUser, handle, requireUser } from "@/lib/session";
import { RulesSchema, withDefaults } from "@/lib/rules";
import { publicUser } from "@/lib/views";
import type { User } from "@/lib/db/schema";


export const GET = handle(async () => {
  const u = await currentUser();
  return Response.json({ user: u ? publicUser(u) : null });
});

const Patch = z.object({
  profile: z
    .object({
      fullName: z.string(),
      school: z.string(),
      gradYear: z.string(),
      major: z.string(),
      hometown: z.string(),
      pastExperience: z.string(),
      interests: z.string(),
      signature: z.string(),
      targeting: z.string(),
      resumeText: z.string(),
    })
    .partial()
    .optional(),
  rules: RulesSchema.partial().optional(),
  hunterKey: z.string().optional(),
  apolloKey: z.string().optional(),
});

export const PATCH = handle(async (req: Request) => {
  const u = await requireUser();
  const body = Patch.parse(await req.json());
  const db = await getDb();
  const set: Partial<User> = {};
  if (body.profile) set.profile = { ...u.profile, ...body.profile };
  if (body.rules) set.rules = withDefaults({ ...withDefaults(u.rules), ...body.rules });
  if (body.hunterKey !== undefined) set.hunterKeyEnc = body.hunterKey ? encrypt(body.hunterKey.trim()) : null;
  if (body.apolloKey !== undefined) set.apolloKeyEnc = body.apolloKey ? encrypt(body.apolloKey.trim()) : null;
  const [nu] = await db.update(schema.users).set(set).where(eq(schema.users.id, u.id)).returning();
  return Response.json({ user: publicUser(nu) });
});
