import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { google } from "googleapis";
import { appUrl, oauthClient } from "@/lib/google";
import { getDb, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { createSession } from "@/lib/session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("ibo_oauth_state")?.value;
  jar.delete("ibo_oauth_state");
  const fail = (m: string) => Response.redirect(`${appUrl()}/?error=${encodeURIComponent(m)}`);
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error")!);
  if (!expected || url.searchParams.get("state") !== expected) return fail("Login expired, please try again.");
  const code = url.searchParams.get("code");
  if (!code) return fail("Missing code");

  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const granted = tokens.scope ?? "";
  if (!granted.includes("gmail.send") || !granted.includes("gmail.readonly"))
    return fail("Please allow both Gmail permissions (send + read) so the app can send and track your emails.");
  const info = (await google.oauth2({ version: "v2", auth: client }).userinfo.get()).data;
  if (!info.email) return fail("Google did not return an email address");

  const db = await getDb();
  const email = info.email.toLowerCase();
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  let id: string;
  if (existing) {
    id = existing.id;
    await db
      .update(schema.users)
      .set({ name: info.name ?? existing.name, ...(tokens.refresh_token ? { refreshTokenEnc: encrypt(tokens.refresh_token) } : {}) })
      .where(eq(schema.users.id, id));
  } else {
    const [u] = await db
      .insert(schema.users)
      .values({ email, name: info.name ?? "", refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token) : null })
      .returning();
    id = u.id;
  }
  await createSession(id);
  return Response.redirect(`${appUrl()}/`);
}
