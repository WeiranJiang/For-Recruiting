# Outreach Desk — investment banking cold email optimizer

Find bankers, get drafts that sound like you, swipe right to send on a smart schedule through **your own Gmail**, and track every
send, reply, bounce and follow-up in one sheet.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FWeiranJiang%2FFor-Recruiting&env=ANTHROPIC_API_KEY,GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,SESSION_SECRET,CRON_SECRET&envDescription=See%20.env.example%20in%20the%20repo&project-name=outreach-desk)

## What it does

| | |
|---|---|
| **Setup** | Describe who you want to reach in plain words (schools, shared past internships, groups, banks, affinity networks). Paste/upload your resume. Tell a chat box your sending rules ("Tue–Thu 7–8:30am ET, same bank 48h apart"). |
| **Find people** | Claude searches the web for matching bankers and works out emails from public sources and bank email formats, or verifies them with Hunter.io / Apollo.io. You can also paste a list. Each person gets an **email accuracy %**, an **info accuracy %**, an overall score, sources, and the reasons they match. |
| **Drafts** | Written from the networking *master prompt* (editable per user) plus your resume and your notes on each person. Each draft also shows verified facts vs. your notes, the angle it used, missing info, and questions for a 15-minute call. |
| **Learns your style** | When you edit a draft before swiping right, the app turns your edits into personal guidelines. You can also type feedback ("too formal", "never mention GPA"). |
| **Live proofreading** | Grammarly-style: red underline = spelling/grammar, blue = clunky phrasing. Click an underline to accept the fix. Runs automatically. |
| **Swipe** | Card shows To/CC/BCC, subject, body, resume attachment (removable per email), send time and accuracy. **Right** = schedule in the next slot your rules allow (or send now). **Left** = review pile to edit, then swipe right or delete. Arrow keys work too. |
| **Never double-email** | Each new first email is checked against everything you've sent or scheduled (To/CC/BCC; your default CC/BCC addresses are ignored). |
| **Tracker sheet** | Name, email, bank, status, first/last sent, replied, follow-ups, accuracy, flags. Filter by bank, status or accuracy. "Follow up now" view; select people to bulk-draft follow-ups (sent as replies in the same Gmail thread). Per-bank reply rates. CSV export. |
| **Offer times** | Connect Google Calendar (read-only) and set your weekly hours in Setup → Availability. On any email, **🗓 Offer times** shows open slots (busy time from all your calendars removed), pre-picks 2–3 options on different days, and inserts a neatly formatted, correctly dated list. Click any slot in Setup to switch it off. |
| **Out-of-office** | Auto-replies are detected (headers + subject) and shown separately, so they don't count as a real reply or cancel follow-ups. |
| **Bounces** | An email is flagged in the sheet only when **every** recipient (To + CC + BCC) bounced, or Gmail refused to send it. If even one address got it, it's not flagged. Note: if you BCC yourself, that copy always goes through, so the email will never count as fully bounced. |

## Deploy to Vercel (about 15 minutes)

1. **Click "Deploy with Vercel" above** (or in Vercel: *Add New → Project → Import* `WeiranJiang/For-Recruiting`).
   Fill in the env vars (you can leave Google ones as `x` for now and update them in step 4):
   - `ANTHROPIC_API_KEY`: from https://console.anthropic.com
   - `SESSION_SECRET`, `CRON_SECRET`: any long random strings (e.g. `openssl rand -hex 32`)
   - `ALLOWED_EMAILS`: **required**: your email (and friends'), comma-separated, or `@yourschool.edu`. Without it nobody can sign in
     (secure default; set `OPEN_SIGNUPS=1` only if you really want anyone with Google to use your AI credits).
   - `ENCRYPTION_KEY`: another long random string. Encrypts stored Google sign-ins and API keys. Keep it forever, or rotate it via `ENCRYPTION_KEY_PREVIOUS`.
   - Optional: `AI_DAILY_LIMIT` (per-user daily AI budget in cost units, default 600).
2. **Add a database**: in the Vercel project → *Storage* → *Create Database* → **Neon (Postgres)** → connect it to the project.
   This sets `DATABASE_URL` automatically. Tables are created on first request.
3. **Note your URL**, e.g. `https://outreach-desk.vercel.app`.
4. **Google setup** (one time, free):
   1. https://console.cloud.google.com → create a project.
   2. *APIs & Services → Library* → enable **Gmail API** and **Google Calendar API**.
   3. *OAuth consent screen* → External → fill in the app name/emails → add scopes `gmail.send`, `gmail.readonly` and `calendar.readonly` → add yourself under **Test users**.
   4. *Credentials → Create credentials → OAuth client ID → Web application*. Authorized redirect URI:
      `https://YOUR-APP.vercel.app/api/auth/callback`
   5. Copy the client ID/secret into Vercel env vars `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` → *Redeploy*.
   > While the Google app is in **Testing** mode, Google expires sign-ins after 7 days (just sign in again). Click
   > **Publish app** on the consent screen to avoid that; you'll see an "unverified app" warning you can click through for personal use.
5. **Scheduled sending**: emails send automatically while the app is open in any tab (it checks every minute).
   For sending while it's closed, Vercel's free plan only runs `vercel.json`'s cron once a day, so add a free
   external pinger: https://cron-job.org → new job → URL `https://YOUR-APP.vercel.app/api/cron`, every 5 minutes,
   with a request header `Authorization: Bearer YOUR_CRON_SECRET` (keeps the secret out of URL logs).
   (On Vercel Pro you can change `vercel.json` to `*/5 * * * *` instead.)

## Run locally

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `.env.local` (`DATABASE_URL` can stay empty: an embedded Postgres in `./.data` is used), then:

```bash
npm run dev
```

Open http://localhost:3000. Google redirect URI for local: `http://localhost:3000/api/auth/callback`.
To click around without Google, set `DEV_LOGIN=1` and visit http://localhost:3000/api/auth/dev-login?seed=1.

## Security

See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) (status dashboard), [SECURITY_REMEDIATION.md](SECURITY_REMEDIATION.md) (open items),
[SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) (developer checklist) and [SECURITY.md](SECURITY.md) (reporting).

```bash
npm test
```

```bash
npm run security:audit
```

## Tech

Next.js 16 (App Router) · Postgres + Drizzle · Gmail API (googleapis) · Claude API (`@anthropic-ai/sdk`, model `claude-opus-5-5`
with server-side refusal fallbacks, web search for research, structured outputs) · Tailwind.

Key files: `src/lib/master-prompt.ts` (default writing guide), `src/lib/ai.ts` (all Claude calls), `src/lib/rules.ts` (scheduler),
`src/lib/send.ts` (dedupe + Gmail send + resume attachment), `src/lib/sync.ts` (reply/bounce detection), `src/lib/status.ts` (sheet logic).

Schema changes: edit `src/lib/db/schema.ts`, then `npx drizzle-kit generate && node scripts/gen-schema-sql.mjs`.
