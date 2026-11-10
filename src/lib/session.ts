import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { getDb, schema } from "./db";
import { HttpError, logError, safeMessage } from "./errors";
import { isAllowedEmail } from "./access";

export { isAllowedEmail };

export { HttpError } from "./errors";

const PROD = process.env.NODE_ENV === "production";
// __Host- prefix: browser enforces Secure, Path=/ and no Domain (no subdomain can set/overwrite it).
const COOKIE = PROD ? "__Host-ibo_session" : "ibo_session";
const SESSION_DAYS = 14;
const ISSUER = "outreach-desk";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export async function createSession(userId: string, sessionVersion: number) {
  const token = await new SignJWT({ uid: userId, sv: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: PROD,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
}

/** Signs out everywhere: bumps the user's session version so every issued token stops working. */
export async function revokeSessions(userId: string) {
  const db = await getDb();
  await db
    .update(schema.users)
    .set({ sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, userId));
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, algorithms: ["HS256"] });
    if (typeof payload.uid !== "string") return null;
    const db = await getDb();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, payload.uid));
    if (!u) return null;
    if ((payload.sv ?? 0) !== u.sessionVersion) return null; // revoked (signed out)
    if (!isAllowedEmail(u.email)) return null; // removed from the allowlist
    return u;
  } catch {
    return null;
  }
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Not signed in");
  return u;
}

/**
 * CSRF defence in depth (the session cookie is already SameSite=Lax):
 * state-changing requests must come from this site.
 */
function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Cross-site request blocked");
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      /* invalid */
    }
    if (!host || originHost !== host) throw new HttpError(403, "Cross-site request blocked");
  }
}

/** Wraps a route handler: CSRF origin check + safe error responses (no internal details leak). */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      if (args[0] instanceof Request) assertSameOrigin(args[0]);
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError) return Response.json({ error: "Invalid request." }, { status: 400 });
      if (e instanceof SyntaxError) return Response.json({ error: "Invalid JSON." }, { status: 400 });
      logError("route", e);
      return Response.json({ error: safeMessage(e) }, { status: 500 });
    }
  };
}
