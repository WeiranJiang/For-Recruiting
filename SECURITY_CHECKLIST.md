# Developer security checklist

Run through this for every change. CI enforces the items marked ⛔.

## Every route handler (`src/app/api/**/route.ts`)
- [ ] Wrapped in `handle()`. This gives the CSRF origin check, safe error responses and redacted logging.
- [ ] Calls `requireUser()` unless deliberately public (only `auth/*`, `me` GET, `cron`).
- [ ] Every query on user data filters by `userId` (or loads via `getContact(user, id)` / an ownership join). Never trust an id from the client.
- [ ] Body parsed with zod: explicit fields only (no spreading the request into a DB update), `.max()` on every string and array.
- [ ] User-facing errors use `userError()` / `HttpError`. Never return `e.message` from unknown errors.
- [ ] AI calls are preceded by `chargeAi(user.id, AI_COST.…)`.
- [ ] Add a cross-user case to `scripts/security-smoke.mjs` for any new `:id` route. ⛔

## Data & secrets
- [ ] No secrets in code, tests, fixtures or logs. Use `logError()`, never `console.error(err)` on SDK errors. ⛔ gitleaks
- [ ] Never prefix a secret with `NEXT_PUBLIC_`.
- [ ] Third-party credentials stored per user are encrypted with `encrypt()`.
- [ ] Schema changes: `npx drizzle-kit generate && node scripts/gen-schema-sql.mjs`. New columns must be additive with defaults, so the bootstrap SQL stays idempotent.

## Frontend
- [ ] Every page calls `await connection()` (or is otherwise dynamic). The CSP nonce from `src/proxy.ts` only reaches dynamically rendered pages; a static page's scripts would be blocked.
- [ ] No `dangerouslySetInnerHTML`, `eval`, `new Function`.
- [ ] Any URL from data goes through `safeHref()` before it reaches an `href`.
- [ ] No tokens or personal data in `localStorage`.
- [ ] No third-party scripts. If one is ever needed, update the CSP in `src/proxy.ts` deliberately.

## Email / AI specifics
- [ ] Anything that ends up in a MIME header goes through `encodeHeader()` and validation. Addresses go through `isValidEmail()`.
- [ ] Treat web-search results and model output as untrusted data. They must never trigger actions without a user click.

## Dependencies
- [ ] Prefer no new dependency. If needed, check maintenance, downloads and advisories, and commit the lockfile.
- [ ] `npm run security:audit` passes (no high/critical in production deps). ⛔

## Before merging
- [ ] `npm run lint && npm run typecheck && npm test` ⛔
- [ ] Security smoke test passes ⛔
- [ ] Update `SECURITY_AUDIT.md` if a security-relevant behaviour changed.
