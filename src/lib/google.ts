import "server-only";
import { google } from "googleapis";
import { decrypt } from "./crypto";
import type { User } from "./db/schema";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

/** Public base URL. On Vercel, falls back to the production domain automatically. */
export function appUrl() {
  const explicit = process.env.APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

export function oauthClient() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const sec = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !sec) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  return new google.auth.OAuth2(id, sec, `${appUrl()}/api/auth/callback`);
}

export function gmailFor(user: User) {
  const refresh = decrypt(user.refreshTokenEnc);
  if (!refresh) throw new Error("Gmail is not connected — sign out and sign in with Google again.");
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: refresh });
  return google.gmail({ version: "v1", auth });
}
