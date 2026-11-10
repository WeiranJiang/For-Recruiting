import { clearSession, currentUser, handle, revokeSessions } from "@/lib/session";

/** Signs out everywhere: revokes all issued session tokens for this user, then clears the cookie. */
export const POST = handle(async () => {
  const u = await currentUser();
  if (u) await revokeSessions(u.id);
  await clearSession();
  return Response.json({ ok: true });
});
