# Project instructions

## Security review is part of every change
This project keeps a security baseline. For every feature or fix:
1. Follow [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md). New routes use `handle()` + `requireUser()`, zod with `.max()`, ownership filters, and `chargeAi()` before AI calls.
2. Run before finishing:

```bash
npm run lint && npm run typecheck && npm test
```

```bash
npm run security:audit
```

3. If a route or `:id` endpoint was added or changed, extend `scripts/security-smoke.mjs` and run it against a dev server (instructions at the top of that file).
4. Update [SECURITY_AUDIT.md](SECURITY_AUDIT.md) and [SECURITY_REMEDIATION.md](SECURITY_REMEDIATION.md) when a security-relevant behaviour changes. Never mark something verified without running the check.
5. Report any vulnerability found to the user immediately, even if it's outside the current task.

## Conventions
- Commit messages: `burp`.
- Schema changes: edit `src/lib/db/schema.ts`, then `npx drizzle-kit generate && node scripts/gen-schema-sql.mjs` (additive columns with defaults only).
