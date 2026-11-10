import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { currentUser, handle, requireUser } from "@/lib/session";
import { RulesSchema, withDefaults } from "@/lib/rules";
import { publicUser } from "@/lib/views";
import { withAvailabilityDefaults } from "@/lib/availability";
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
      phone: z.string(),
      targeting: z.string(),
      resumeText: z.string(),
    })
    .partial()
    .optional(),
  rules: RulesSchema.partial().optional(),
  availability: z
    .object({
      timezone: z.string(),
      days: z.array(z.number().int().min(1).max(7)),
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      meetingMinutes: z.number().int().min(10).max(120),
      bufferMinutes: z.number().int().min(0).max(120),
      minNoticeHours: z.number().min(0).max(168),
      daysAhead: z.number().int().min(1).max(30),
      blocked: z.array(z.string()).max(500),
      extra: z.array(z.object({ start: z.string(), end: z.string() })).max(100),
    })
    .partial()
    .optional(),
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
  if (body.availability) {
    const merged = withAvailabilityDefaults({ ...withAvailabilityDefaults(u.availability), ...body.availability });
    // keep the manual blocks list from growing forever
    merged.blocked = merged.blocked.filter((b) => Date.parse(b) > Date.now() - 86_400_000);
    set.availability = merged;
  }
  if (body.hunterKey !== undefined) set.hunterKeyEnc = body.hunterKey ? encrypt(body.hunterKey.trim()) : null;
  if (body.apolloKey !== undefined) set.apolloKeyEnc = body.apolloKey ? encrypt(body.apolloKey.trim()) : null;
  const [nu] = await db.update(schema.users).set(set).where(eq(schema.users.id, u.id)).returning();
  return Response.json({ user: publicUser(nu) });
});
