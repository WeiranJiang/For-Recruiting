#!/usr/bin/env node
/**
 * Security smoke test (non-destructive; DEV/STAGING ONLY — needs the dev-only demo login).
 *
 * Start a dev server first with test settings, e.g.:
 *   DEV_LOGIN=1 AI_DAILY_LIMIT=3 CRON_SECRET=test-cron-secret-0123456789abcdef DATABASE_URL=pglite:./.data/smoke npx next dev -p 3100
 * Then:
 *   BASE=http://localhost:3100 CRON_SECRET=test-cron-secret-0123456789abcdef node scripts/security-smoke.mjs
 *
 * Exits non-zero if any check fails (used as a CI security gate).
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? `  -> ${detail}` : ""}`);
  if (!cond) failures++;
};

async function login(as, seed = false) {
  const r = await fetch(`${BASE}/api/auth/dev-login?as=${as}${seed ? "&seed=1" : ""}`, { redirect: "manual" });
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error(`dev-login failed for ${as} (status ${r.status}). Is DEV_LOGIN=1 set?`);
  return cookie;
}
const call = (cookie, path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: { ...(init.json ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
    body: init.json ? JSON.stringify(init.json) : init.body,
  });

(async () => {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`${BASE}/api/me`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }

  // ---- 1. unauthenticated access is refused
  const protectedRoutes = [
    ["GET", "/api/contacts"], ["GET", "/api/emails"], ["GET", "/api/export"], ["GET", "/api/availability"], ["GET", "/api/resume"],
    ["POST", "/api/research"], ["POST", "/api/import"], ["POST", "/api/drafts"], ["POST", "/api/grammar"], ["POST", "/api/rules"],
    ["POST", "/api/style"], ["POST", "/api/tick"], ["PATCH", "/api/me"], ["DELETE", "/api/me"],
  ];
  for (const [method, path] of protectedRoutes) {
    const r = await call("", path, { method, json: method === "GET" ? undefined : {} });
    ok(`unauthenticated ${method} ${path} -> 401`, r.status === 401, `got ${r.status}`);
  }
  const me0 = await (await call("", "/api/me")).json();
  ok("GET /api/me without session returns no user", me0.user === null);

  // ---- 2. cron requires the secret
  ok("cron without secret -> 401", (await call("", "/api/cron")).status === 401);
  ok("cron with wrong secret -> 401", (await call("", "/api/cron?key=wrong")).status === 401);
  if (CRON_SECRET) ok("cron with Bearer secret -> 200", (await call("", "/api/cron", { headers: { authorization: `Bearer ${CRON_SECRET}` } })).status === 200);

  // ---- 3. object-level authorization (IDOR) between two users
  const alice = await login("alice", true);
  const bob = await login("bob");
  const aEmails = (await (await call(alice, "/api/emails?status=pending")).json()).emails;
  const aContacts = (await (await call(alice, "/api/contacts")).json()).rows;
  ok("alice has seeded data", aEmails.length > 0 && aContacts.length > 0);
  const eid = aEmails[0].id;
  const cid = aContacts[0].id;
  const bobEmails = (await (await call(bob, "/api/emails?status=pending,review,scheduled,sent,failed")).json()).emails;
  ok("bob cannot list alice's emails", !bobEmails.some((e) => e.id === eid));
  const bobRows = (await (await call(bob, "/api/contacts")).json()).rows;
  ok("bob cannot list alice's contacts", !bobRows.some((c) => c.id === cid));
  for (const [method, path, json] of [
    ["PATCH", `/api/emails/${eid}`, { subject: "pwned" }],
    ["DELETE", `/api/emails/${eid}`, undefined],
    ["POST", `/api/emails/${eid}/approve`, {}],
    ["POST", `/api/emails/${eid}/grammar`, {}],
    ["POST", `/api/emails/${eid}/regenerate`, {}],
    ["PATCH", `/api/contacts/${cid}`, { email: "attacker@evil.com" }],
    ["DELETE", `/api/contacts/${cid}`, undefined],
  ]) {
    const r = await call(bob, path, { method, json });
    ok(`bob ${method} ${path.replace(/[0-9a-f-]{36}/, ":id")} -> 404`, r.status === 404, `got ${r.status}`);
  }
  const draftsR = await (await call(bob, "/api/drafts", { method: "POST", json: { contactIds: [cid], kind: "initial" } })).json();
  ok("bob cannot draft for alice's contact", (draftsR.drafted ?? 0) === 0);
  const still = (await (await call(alice, "/api/emails?status=pending")).json()).emails.find((e) => e.id === eid);
  ok("alice's email unchanged after bob's attempts", still && still.subject !== "pwned");

  // ---- 4. CSRF: cross-site mutations blocked
  let r = await call(alice, "/api/me", { method: "PATCH", json: { profile: { fullName: "csrf" } }, headers: { origin: "https://evil.example" } });
  ok("cross-origin PATCH (Origin) -> 403", r.status === 403, `got ${r.status}`);
  r = await call(alice, "/api/rules", { method: "POST", json: { reset: true }, headers: { "sec-fetch-site": "cross-site" } });
  ok("cross-site POST (Sec-Fetch-Site) -> 403", r.status === 403, `got ${r.status}`);
  r = await call(alice, "/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } });
  ok("cross-origin logout -> 403", r.status === 403, `got ${r.status}`);

  // ---- 5. input validation / stored-XSS guards
  r = await call(alice, `/api/contacts/${cid}`, { method: "PATCH", json: { linkedinUrl: "javascript:alert(document.cookie)" } });
  const saved = await r.json();
  ok("javascript: URL is not stored", r.ok && saved.contact.linkedinUrl === "", JSON.stringify(saved.contact?.linkedinUrl));
  r = await call(alice, `/api/contacts/${cid}`, { method: "PATCH", json: { email: "x@y.com\r\nBcc: v@evil.com" } });
  ok("header-injection email rejected -> 400", r.status === 400, `got ${r.status}`);
  r = await call(alice, `/api/emails/${eid}`, { method: "PATCH", json: { body: "x".repeat(25_000) } });
  ok("oversized body rejected -> 400", r.status === 400, `got ${r.status}`);
  r = await call(alice, `/api/emails/${eid}`, { method: "PATCH", json: { status: "sent" } });
  ok("mass assignment of status=sent rejected -> 400", r.status === 400, `got ${r.status}`);
  r = await call(alice, "/api/me", { method: "PATCH", body: "{not json", headers: { "content-type": "application/json" } });
  ok("malformed JSON -> 400", r.status === 400, `got ${r.status}`);

  // ---- 6. uploads
  const fd = new FormData();
  fd.set("file", new Blob(["<html><script>alert(1)</script>"], { type: "application/pdf" }), 'evil".pdf');
  r = await call(alice, "/api/resume", { method: "POST", body: fd });
  ok("non-PDF upload disguised as PDF -> 400", r.status === 400, `got ${r.status}`);
  const pdf = new FormData();
  pdf.set("file", new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" }), 'a"b\r\n.pdf');
  pdf.set("text", "Resume text");
  r = await call(alice, "/api/resume", { method: "POST", body: pdf });
  ok("valid PDF upload accepted", r.ok, `got ${r.status}`);
  r = await call(alice, "/api/resume");
  const cd = r.headers.get("content-disposition") ?? "";
  ok("download filename is header-safe", !/["\r\n].*["\r\n].*"/.test(cd.replace(/^inline; filename="|"$/g, "")) && !cd.includes('a"b'), cd);
  ok("resume served sandboxed", (r.headers.get("content-security-policy") ?? "").includes("sandbox"));
  ok("resume nosniff", r.headers.get("x-content-type-options") === "nosniff");

  // ---- 7. error disclosure + AI quota (server started with AI_DAILY_LIMIT=3 and no ANTHROPIC_API_KEY)
  const codes = [];
  let leaked = false;
  for (let i = 0; i < 5; i++) {
    const g = await call(alice, "/api/grammar", { method: "POST", json: { subject: "s", body: `hello ${i}` } });
    const txt = await g.text();
    codes.push(g.status);
    if (/ANTHROPIC_API_KEY|at \w+ \(|\.ts:\d+|stack/i.test(txt)) leaked = true;
  }
  ok("internal errors are not disclosed", !leaked);
  ok("AI quota enforced (429 after limit)", codes.includes(429), `codes ${codes.join(",")}`);

  // ---- 8. security headers
  const home = await fetch(`${BASE}/`);
  const h = (k) => home.headers.get(k) ?? "";
  ok("CSP present with frame-ancestors 'none'", h("content-security-policy").includes("frame-ancestors 'none'"));
  ok("CSP object-src 'none'", h("content-security-policy").includes("object-src 'none'"));
  ok("X-Frame-Options DENY", h("x-frame-options") === "DENY");
  ok("X-Content-Type-Options nosniff", h("x-content-type-options") === "nosniff");
  ok("Referrer-Policy set", h("referrer-policy") === "strict-origin-when-cross-origin");
  ok("Permissions-Policy set", h("permissions-policy").includes("camera=()"));
  ok("COOP same-origin", h("cross-origin-opener-policy") === "same-origin");
  ok("X-Powered-By removed", !home.headers.has("x-powered-by"));
  const api = await call(alice, "/api/contacts");
  ok("API responses not cacheable", (api.headers.get("cache-control") ?? "").includes("no-store"));

  // ---- 9. session cookie flags + revocation on logout
  const raw = (await fetch(`${BASE}/api/auth/dev-login?as=carol`, { redirect: "manual" })).headers.getSetCookie?.()[0] ?? "";
  ok("session cookie HttpOnly", /HttpOnly/i.test(raw));
  ok("session cookie SameSite=Lax", /SameSite=lax/i.test(raw));
  const carol = raw.split(";")[0];
  ok("carol session works", (await call(carol, "/api/contacts")).status === 200);
  await call(carol, "/api/auth/logout", { method: "POST" });
  ok("old token rejected after logout (server-side revocation)", (await call(carol, "/api/contacts")).status === 401);

  // ---- 10. account deletion requires explicit confirmation
  const dave = await login("dave");
  r = await call(dave, "/api/me", { method: "DELETE", json: { confirm: "someone-else@example.com" } });
  ok("delete account without matching confirmation -> 400", r.status === 400, `got ${r.status}`);
  r = await call(dave, "/api/me", { method: "DELETE", json: { confirm: "dave@example.com" } });
  ok("delete account with confirmation -> 200", r.ok, `got ${r.status}`);
  ok("deleted user's session no longer works", (await call(dave, "/api/contacts")).status === 401);

  console.log(`\n${failures === 0 ? "ALL SECURITY CHECKS PASSED" : `${failures} SECURITY CHECK(S) FAILED`}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
