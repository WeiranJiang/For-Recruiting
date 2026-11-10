# PROJECT SECURITY STATUS

**Overall Status:** IN PROGRESS. No open critical or high findings. Production is not deployed yet, so infrastructure and TLS are unverified.

**Website:** Outreach Desk: investment-banking cold-email assistant (Gmail send/track, AI drafting, Google Calendar availability)

**Technology Stack:** Next.js 16.4.6 (App Router, Turbopack) · React 19.3 · TypeScript 5 · Node 22 · Drizzle ORM 0.45 → PostgreSQL (Neon on Vercel; embedded PGlite for local dev) · Google OAuth 2.0 + Gmail API + Calendar API (googleapis 189) · Anthropic Claude API (@anthropic-ai/sdk 1.7) · jose 6 (session JWT) · zod 4 (validation) · Tailwind 4 · Hosting target: Vercel (+ Vercel Cron / external pinger)

**Last Review:** 2026-11-10 (initial assessment + second pass: nonce CSP, encryption key versioning, prompt-injection fencing, header-only cron, SHA-pinned Actions, dependency updates)

---

## SECURITY CATEGORY STATUS

| Category | Status | Findings |
|---|---|---|
| Authentication | AMBER | Google OAuth only (no passwords). Sessions hardened and tested: HttpOnly, SameSite=Lax, `__Host-` + Secure in prod, 14-day expiry, server-side revocation on logout. Not yet verified on a real deployment. |
| Authorization | GREEN | Every user-scoped query filters by `user_id`. Cross-user (IDOR) tests pass for all `:id` routes (F-12 fixed). Single role; no admin endpoints exist. |
| Database | AMBER | Drizzle parameterized queries everywhere; the only raw SQL (quota, schema bootstrap) is parameterized or static. Credentials are server-only. Least-privilege DB role and backups unverified. |
| APIs | AMBER | zod validation with size limits, CSRF origin checks, safe errors, AI quota. Per-IP rate limiting not implemented (O-07). |
| Frontend | GREEN | No `dangerouslySetInnerHTML` or `eval`. Links restricted to http(s). No tokens in browser storage. Per-request nonce CSP with `'strict-dynamic'` (no inline scripts), verified in the browser. |
| Input Validation | GREEN | Server-side zod on all mutating routes. Email-address and header-injection guards are unit-tested. |
| File Uploads | GREEN | Resume only: PDF magic bytes, 4 MB cap, stored in DB (not publicly addressable), owner-only download, sandboxed CSP + nosniff, sanitized filename. No malware scanning (low risk; see notes). |
| Dependencies | AMBER | `npm audit --omit=dev`: 0 vulnerabilities. 12 moderate advisories in dev-only tooling (O-05). |
| Secrets | GREEN | Git history scan clean; gitleaks in CI. No `NEXT_PUBLIC_*` secrets. Tokens and keys are AES-256-GCM encrypted with a dedicated, versioned `ENCRYPTION_KEY` (legacy values still readable). Logs are redacted (F-04). |
| Infrastructure | UNKNOWN | Not deployed. Vercel env scoping, deployment protection and firewall unverified (O-10, O-07). |
| HTTPS / TLS | UNKNOWN | HSTS + `upgrade-insecure-requests` configured. Certificate, TLS version and redirects can only be checked after deployment. |
| Security Headers | GREEN | Nonce CSP on pages (unique per request; all Next scripts carry it), `default-src 'none'` CSP on API, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP, HSTS. Verified on a local production build with no CSP violations. Must be re-checked on the live domain. |
| Privacy | AMBER | Account deletion with Google token revocation implemented and tested. Only reply snippets are stored. A `/privacy` page includes Google's Limited Use disclosure. Not legal advice; owner should review. Retention period not yet defined. |
| Monitoring | AMBER | Redacted error logging only. No alerting or log retention configured (O-08). |

GREEN = verified satisfactory within the assessment scope · AMBER = improvement recommended or incomplete verification · RED = confirmed security problem · UNKNOWN = not inspected or insufficient evidence

---

## ARCHITECTURE (security view)

```
Browser (React client components, same-origin fetch only)
   │  cookie: session JWT (HS256, HttpOnly, SameSite=Lax, __Host- in prod)
   ▼
Next.js route handlers  /api/*   ── handle(): CSRF origin check · safe errors · redacted logs
   │   requireUser() → JWT verify (issuer, alg) → user row → sessionVersion + allowlist check
   │   zod validation · ownership filter (user_id) on every query · AI quota (chargeAi)
   ├── Postgres (Drizzle, parameterized)   users / contacts / emails
   │      refresh_token_enc, hunter/apollo keys: AES-256-GCM (key derived from SESSION_SECRET)
   ├── Google OAuth / Gmail API / Calendar FreeBusy (per-user refresh token, server-side only)
   ├── Anthropic API (server-side key; web_search server tool; structured outputs)
   └── Hunter / Apollo (optional, server-side keys)
/api/cron  ← Vercel Cron or external pinger with Bearer CRON_SECRET (constant-time compare)
```

Trust boundaries: the browser and all user input; web content returned by AI research (untrusted, see O-03); Google/Anthropic/Hunter/Apollo responses.

---

## FINDINGS

Severity uses qualitative CVSS 4.0-style judgement. No formal CVSS vectors were calculated.

### Fixed in this assessment

| ID | Title | Severity | Confidence | Affected files | Evidence | Impact | Correction | Verification |
|---|---|---|---|---|---|---|---|---|
| F-01 | Anyone with a Google account could sign in and use the owner's AI credits | High | High | `api/auth/callback`, `lib/session.ts` | No allowlist existed | Cost abuse (denial of wallet); unwanted users. OWASP API6:2023 / CWE-284 | `ALLOWED_EMAILS` allowlist, re-checked on every request. Production with no allowlist = closed unless `OPEN_SIGNUPS=1` | Unit tests (allow/deny/secure default) ✅ |
| F-02 | No limit on AI-backed endpoints | High | High | `api/research`, `import`, `drafts`, `grammar`, `rules`, `style`, `resume`, `regenerate` | Each call bills Anthropic; live proofreading fires often | Denial of wallet. OWASP API4:2023 / CWE-770 | Atomic per-user daily quota (`lib/quota.ts`, `AI_DAILY_LIMIT`), 429 when exceeded | Smoke test: 429 after limit ✅ |
| F-03 | Internal error messages returned to clients | Medium | High | `lib/session.ts` `handle()` | Returned `e.message` for any error | Information disclosure (config, SQL, upstream bodies). OWASP A05 / CWE-209 | `HttpError` for user-facing messages; generic message otherwise; ZodError/SyntaxError → 400 | Smoke test: no internal strings in responses ✅ |
| F-04 | Raw error objects logged | Medium | Medium | `lib/session.ts`, approve route | `console.error(e)` on googleapis errors prints request config, which can include the OAuth bearer token | Secrets in logs. CWE-532 | `logError()` logs name/status/message only, with bearer/API-key redaction | Code review ✅ (no runtime Google errors available here) |
| F-05 | No HTTP security headers | Medium | High | `next.config.ts` | None configured | Clickjacking, MIME sniffing, weaker XSS defence. OWASP A05 | CSP, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP, HSTS (prod), `poweredByHeader:false`, `no-store` on API | Smoke test + prod build headers ✅; no CSP violations on any tab (dev) or landing (prod) ✅ |
| F-06 | Logout did not invalidate the session token | Medium | High | `lib/session.ts`, `api/auth/logout` | Stateless 30-day JWT; logout only cleared the cookie | A stolen token stayed valid up to 30 days. CWE-613 | `sessionVersion` claim checked on every request, bumped on logout; 14-day lifetime; `__Host-` cookie in prod; issuer/alg pinned | Smoke test: old token → 401 after logout ✅ |
| F-07 | Unvalidated URLs rendered as links | Medium | Medium | `lib/contacts.ts`, `api/contacts/[id]`, `Tracker.tsx`, `EmailParts.tsx` | AI/web-sourced `sources[].url` and editable `linkedinUrl` went straight into `href` | `javascript:` links (React 19 blocks these at render, which lowers exploitability). CWE-79 | `safeUrl` on write (http/https only), `safeHref` on render, `rel="noopener noreferrer"` | Unit + smoke test ✅ |
| F-08 | Resume download used the raw upload filename in a header and served inline on our origin | Medium | High | `api/resume` | `Content-Disposition` contained `file.name` | Header injection/breakage; active content on our origin. CWE-113 / CWE-434 | Filename sanitizer; `CSP: sandbox`; nosniff; `no-store`; stricter `%PDF-` check | Smoke test ✅ |
| F-09 | CSRF defence relied only on SameSite=Lax | Low | High | all mutating routes | No origin verification | Cross-site state changes if SameSite were bypassed. CWE-352 | `Origin` / `Sec-Fetch-Site` same-origin check for non-GET requests in `handle()` | Smoke test (3 cases) ✅ |
| F-10 | Cron secret compared with `!==`, accepted in the query string | Low | High | `api/cron` | Timing-unsafe compare; URL secrets end up in logs | CWE-208 / CWE-598 | Constant-time SHA-256 compare; 24-char minimum; header documented as the preferred method | Smoke test ✅ (query string still accepted → O-06) |
| F-11 | No input size limits | Low | High | `api/emails/[id]`, `contacts/[id]`, `me`, `rules`, `style`, `import`, `research`, `resume` | Unbounded strings/arrays | Storage/compute abuse. CWE-400 | `.max()` on every field; recipient cap of 20 | Smoke test (oversized body → 400) ✅ |
| F-12 | Approve on another user's email returned 500 instead of 404 | Low | High | `lib/send.ts` | Found by the smoke test | No data exposure; leaked existence-check behaviour | `HttpError(404/409)` | Smoke test ✅ |
| F-13 | OAuth callback did not check `verified_email`; token-exchange errors unhandled | Low | High | `api/auth/callback` | — | Account linking on an unverified address; 500 on bad codes | Verified-email check; handled exchange errors; state cookie already validated | Code review ✅ |
| F-14 | Dev-only login guarded by env flag + NODE_ENV only | Low | High | `api/auth/dev-login` | — | Misconfiguration could expose a passwordless login | Also refuses when `VERCEL` is set | Prod build returns 404 even with `DEV_LOGIN=1` ✅ |
| F-15 | No way to delete an account or data | Low (privacy) | High | — | — | Data-minimization / user-rights gap | `DELETE /api/me` (typed confirmation) revokes the Google token and cascade-deletes all data; UI in Setup | Smoke test ✅ |
| F-16 | Send path did not re-validate recipients at send time | Info | High | `lib/send.ts` | — | Defence in depth | `validateEmail()` in `sendOne`; encoded and filtered `From` display name | Unit tests (CRLF subject, address validation) ✅ |

### Open (see SECURITY_REMEDIATION.md)

| ID | Title | Severity | Status |
|---|---|---|---|
| O-01 | CSP allowed `'unsafe-inline'` scripts | Medium | **Fixed** (2nd pass): nonce CSP via `src/proxy.ts` |
| O-02 | `gmail.readonly` is a Google *restricted* scope; public launch needs verification and a security assessment | Medium (compliance) | Owner decision |
| O-03 | Prompt injection via researched web content (stored notes feed drafting) | Medium | **Mitigated** (2nd pass): untrusted data fenced in prompts with explicit rules; any link in a draft triggers a warning; human approval required to send; the model has no side-effect tools. Residual risk accepted. |
| O-04 | Encryption key derived from `SESSION_SECRET` | Low | **Fixed** (2nd pass): `ENCRYPTION_KEY` with `v2.` versioning + `ENCRYPTION_KEY_PREVIOUS` rotation; unit-tested |
| O-05 | 12 moderate advisories in dev-only tooling | Low | Accepted exception |
| O-06 | Cron secret accepted via `?key=` | Low | **Fixed** (2nd pass): header only; regression test added |
| O-07 | No per-IP / burst rate limiting (non-AI routes) | Low | Use Vercel Firewall rate-limit rules |
| O-08 | No monitoring/alerting | Low | Planned |
| O-09 | Backups / restore unverified | Low | Verify Neon PITR on the chosen plan |
| O-10 | Vercel env scoping and preview deployment protection unverified | Low | Pre-launch check |
| O-11 | GitHub Actions pinned to tags | Info | **Fixed** (2nd pass): pinned to commit SHAs and upgraded to Node 24 releases (gitleaks v2 relied on the deprecated Node 20 runtime) |
| O-12 | Absolute 14-day session, no idle timeout | Info | Accepted for now |
| O-13 | No privacy policy | Info (privacy) | **Mostly fixed**: `/privacy` page added; owner should review it and decide a retention period |
| O-14 | `.env.example` lacks the new variables (agent could not edit `.env*` files) | Info | Owner action: add `ALLOWED_EMAILS`, `OPEN_SIGNUPS`, `AI_DAILY_LIMIT` |

---

## TESTS EXECUTED (2026-11-10)

| Test | Result |
|---|---|
| `npm test` (security + encryption unit tests) | 11/11 pass |
| `scripts/security-smoke.mjs` against dev server (67 checks after the 2nd pass: unauth 401s, IDOR ×9, CSRF ×3, validation ×5, upload ×5, error disclosure, quota, headers ×9, cookie flags, revocation, account deletion) | 61/61 pass (after fixing F-12) |
| `npm run lint`, `npm run typecheck`, `next build` | pass |
| CSP violation check (Playwright): dev, logged in, every tab · prod build, landing page | none |
| Prod build: dev-login disabled even with `DEV_LOGIN=1` | 404 ✅ |
| `npm audit --omit=dev` / `npm audit` | 0 / 12 moderate (dev-only) |
| Secret scan: regex over full git history (Anthropic, Google API key, OAuth client secret, private keys, DB URLs) | none found. gitleaks itself not run locally; it runs in CI |

| GitHub Actions on `795f1e1`: lint/typecheck/tests/build · production dependency audit · gitleaks · smoke tests (61 checks on CI runners) · CodeQL | all jobs succeeded |
| First CI run (`9827358`) | gitleaks flagged a throwaway test value in a usage comment (false positive, now replaced and listed in `.gitleaksignore`). Typecheck failed on a fresh checkout because Next route types weren't generated (fixed: `next typegen` before `tsc`). |

**UNKNOWN:** CodeQL *alerts*. The analysis ran successfully, but this session cannot read code-scanning results (HTTP 403). The owner must review the repository's Security → Code scanning tab.
Not executed: DAST (OWASP ZAP), real Google OAuth / Gmail / Calendar flows, production TLS/DNS checks.

---

## REMEDIATION TRACKER

- [x] Critical findings resolved (none found)
- [x] High findings resolved (F-01, F-02)
- [x] Medium findings reviewed (F-03…F-08 fixed; O-01…O-03 open with plans)
- [x] Low findings reviewed
- [x] Dependencies audited (npm audit; Dependabot configured)
- [x] Secrets scanned (history regex scan; gitleaks in CI: pass)
- [x] Authentication tested (session flags, revocation, unauthenticated access)
- [x] Authorization tested (cross-user IDOR suite)
- [x] API security reviewed
- [ ] Production configuration reviewed (not deployed)
- [ ] Final pre-launch audit completed
