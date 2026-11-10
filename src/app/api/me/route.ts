import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { oauthClient } from "@/lib/google";
import { logError } from "@/lib/errors";
import { clearSession, currentUser, handle, requireUser } from "@/lib/session";
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
      fullName: z.string().max(120),
      school: z.string().max(200),
      gradYear: z.string().max(10),
      major: z.string().max(200),
      hometown: z.string().max(200),
      pastExperience: z.string().max(4000),
      interests: z.string().max(2000),
      signature: z.string().max(1000),
      phone: z.string().max(40),
      targeting: z.string().max(4000),
      resumeText: z.string().max(20000),
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
  hunterKey: z.string().max(200).optional(),
  apolloKey: z.string().max(200).optional(),
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

/**
 * Delete account: revokes the app's Google access and permanently deletes the user and all
 * their data (contacts, emails, resume, settings) via ON DELETE CASCADE. Emails already
 * delivered stay in Gmail (that's the user's mailbox, not ours).
 */
export const DELETE = handle(async (req: Request) => {
  const u = await requireUser();
  const { confirm } = z.object({ confirm: z.literal(u.email) }).parse(await req.json());
  void confirm;
  const refresh = decrypt(u.refreshTokenEnc);
  if (refresh) {
    try {
      await oauthClient().revokeToken(refresh);
    } catch (e) {
      logError("revoke", e);
    }
  }
  const db = await getDb();
  await db.delete(schema.users).where(eq(schema.users.id, u.id));
  await clearSession();
  return Response.json({ ok: true });
});
