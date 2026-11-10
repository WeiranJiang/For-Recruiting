# Security remediation plan

Open items from [SECURITY_AUDIT.md](SECURITY_AUDIT.md), in recommended order.

## Before production launch (blocking)

1. **Set `ALLOWED_EMAILS`** in Vercel (Production scope). Without it, nobody can sign in. That's the secure default and works as intended, but you need to set it to use the app.
2. **O-10 — Vercel configuration.** Scope env vars per environment so Preview deployments don't use the production database or secrets. Enable *Deployment Protection* for previews. Enable *Deployment Checks* so production only deploys when the `security` workflow passes. Add branch protection on `main` that requires the `security` and `codeql` checks.
3. **O-14 — `.env.example`.** Add `ALLOWED_EMAILS=`, `# OPEN_SIGNUPS=1`, `# AI_DAILY_LIMIT=600`, and note that `CRON_SECRET` is sent as `Authorization: Bearer …` (the agent's permissions block editing `.env*` files).
4. **O-06 — Cron secret in the URL.** Configure the pinger with the `Authorization: Bearer` header, then delete the `?key=` branch in `src/app/api/cron/route.ts`.
5. **Production verification (TLS/HSTS/DNS).** After the first deploy, check:
   - HTTPS redirect, a valid certificate, TLS ≥ 1.2, and the HSTS header (e.g. `curl -sI`, SSL Labs).
   - That the security headers match the local results.
   - SPF/DKIM/DMARC: only relevant if you add a custom domain. Mail is sent through each user's own Gmail, so Google signs it.

## Next sprint

6. **O-01 — Nonce-based CSP.** Add `src/proxy.ts` that generates a per-request nonce and sets `script-src 'self' 'nonce-…' 'strict-dynamic'`. Remove `'unsafe-inline'` for scripts. Requires dynamic rendering of the page shell; test that hydration still works and that there are no CSP violations.
7. **O-03 — Prompt injection hardening.**
   - Wrap researched web text in clearly delimited "untrusted data" blocks in the drafting prompt, and instruct the model never to follow instructions found there.
   - Warn on the compose card when a draft contains any URL or email address that isn't the recipient's or the user's own.
   - Today's mitigations: nothing is sent without a human swipe, and the model has no side-effect tools (only server-side web search).
8. **O-04 — Separate encryption key.** Add an `ENCRYPTION_KEY` env var plus a key-version prefix on ciphertexts (`v1.`), with dual-read during rotation. Rotating `SESSION_SECRET` must not wipe stored Google tokens.
9. **O-07 — Burst rate limiting.** Add a Vercel Firewall rate-limit rule on `/api/*` (e.g. 120 req/min per IP) and a stricter rule on `/api/auth/*`.
10. **O-08 — Monitoring.** Add a log drain (e.g. Axiom/Datadog) with alerts on 5xx spikes, 401/403/429 spikes, and cron failures.

## Compliance / owner decisions

11. **O-02 — Google restricted scope.** `gmail.readonly` (used for reply and bounce detection) is restricted. An unverified app works for up to 100 users, who see a warning screen. Public launch requires Google OAuth verification plus a CASA security assessment. Alternative: drop `gmail.readonly` and detect replies only via `gmail.metadata` (also restricted), or build a manual "mark replied" flow.
12. **O-13 — Privacy.** Publish a short privacy notice covering:
    - What is stored: profile, contacts, drafts, reply snippets, encrypted Google refresh token.
    - Who processes it: Anthropic, Google, and optionally Hunter/Apollo.
    - Retention, and how to delete your account (implemented).
    - This is not legal advice. GDPR/CCPA applicability depends on your users.
13. **O-09 — Backups.** Confirm Neon point-in-time recovery on your plan, and test a restore once.

## Accepted risks (documented exceptions)

| ID | Risk | Why accepted | Revisit |
|---|---|---|---|
| O-05 | 12 moderate advisories in dev-only packages (esbuild dev server via drizzle-kit; minimatch via typescript-eslint) | Not part of the production bundle or runtime. Dev server binds locally. | When Dependabot offers non-breaking upgrades |
| O-11 | Actions pinned to major tags | Official actions only; Dependabot watches them | Pin to SHAs before a team grows |
| O-12 | 14-day absolute sessions, no idle timeout | Single-user productivity app; tokens are revocable on logout | If the app handles more sensitive data |
