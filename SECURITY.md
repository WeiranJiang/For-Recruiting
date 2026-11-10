# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Report privately via GitHub's
"Report a vulnerability" (Security → Advisories) on this repository. Include:

- What you found and where (route, file, or page)
- Steps to reproduce, and the impact you expect
- Your contact details, if you'd like credit or follow-up

We aim to acknowledge reports within 3 business days. Please test only against your own local or dev
instance. Do not test against other people's accounts or a production deployment, and do not run
denial-of-service or destructive tests.

## Supported versions

Only the latest `main` branch is supported.

## Security practices

- Status dashboard: [SECURITY_AUDIT.md](SECURITY_AUDIT.md) · open items: [SECURITY_REMEDIATION.md](SECURITY_REMEDIATION.md) · developer checklist: [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md)
- CI security gate (`.github/workflows/security.yml`): lint, typecheck, unit tests, build, production-dependency audit (blocks on high/critical), gitleaks secret scan, and authorization/CSRF/header smoke tests. CodeQL runs separately; Dependabot handles updates.
- Sign-in is Google OAuth only; access is restricted by `ALLOWED_EMAILS`. Google refresh tokens and third-party API keys are encrypted at rest (AES-256-GCM).
- Users can delete their account and data at any time (Setup → Delete account). This also revokes the app's Google access.
