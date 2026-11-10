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
  // Read-only calendar access: used only for free/busy so you can offer open times.
  "https://www.googleapis.com/auth/calendar.readonly",
];

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

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

function authFor(user: User) {
  const refresh = decrypt(user.refreshTokenEnc);
  if (!refresh) throw new Error("Google is not connected — sign out and sign in with Google again.");
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: refresh });
  return auth;
}

export function calendarConnected(user: User) {
  return !!user.refreshTokenEnc && user.googleScopes.includes(CALENDAR_SCOPE);
}

/** Busy intervals across ALL of the user's calendars (not just primary), via the FreeBusy API. */
export async function busyBetween(user: User, start: Date, end: Date) {
  const cal = google.calendar({ version: "v3", auth: authFor(user) });
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const r = await cal.calendarList.list({ minAccessRole: "freeBusyReader", maxResults: 250, pageToken });
    for (const c of r.data.items ?? []) if (c.id && !c.hidden && c.selected !== false) ids.push(c.id);
    pageToken = r.data.nextPageToken ?? undefined;
  } while (pageToken);
  if (!ids.length) ids.push("primary");
  const busy: { start: string; end: string }[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await cal.freebusy.query({
      requestBody: { timeMin: start.toISOString(), timeMax: end.toISOString(), items: ids.slice(i, i + 50).map((id) => ({ id })) },
    });
    for (const v of Object.values(r.data.calendars ?? {})) for (const b of v.busy ?? []) if (b.start && b.end) busy.push({ start: b.start, end: b.end });
  }
  return busy;
}

export function gmailFor(user: User) {
  const refresh = decrypt(user.refreshTokenEnc);
  if (!refresh) throw new Error("Gmail is not connected — sign out and sign in with Google again.");
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: refresh });
  return google.gmail({ version: "v1", auth });
}
