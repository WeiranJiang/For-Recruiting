import crypto from "node:crypto";
import { cookies } from "next/headers";
import { GOOGLE_SCOPES, oauthClient } from "@/lib/google";

export async function GET() {
  const state = crypto.randomBytes(16).toString("hex");
  (await cookies()).set("ibo_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: process.env.NODE_ENV === "production" });
  const url = oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  });
  return Response.redirect(url);
}
