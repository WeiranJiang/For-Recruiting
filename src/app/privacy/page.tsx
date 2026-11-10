import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

export const metadata: Metadata = { title: "Privacy · Outreach Desk" };

export default async function Privacy() {
  await connection(); // dynamic so the CSP nonce applies
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-[15px] leading-relaxed">
      <Link href="/" className="text-sm text-muted hover:text-fg">
        ← Back
      </Link>
      <h1 className="mt-6 font-display text-5xl">Privacy</h1>
      <p className="mt-2 text-sm text-muted">Last updated November 10, 2026</p>

      <h2 className="mt-10 font-display text-2xl">What we store</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        <li>Your Google name and email, and an encrypted Google sign-in token.</li>
        <li>What you enter: profile, resume, targeting, rules, availability settings.</li>
        <li>Your contacts and drafts, plus send status, bounce status and a short snippet of replies to emails sent through the app.</li>
        <li>Hunter or Apollo API keys if you add them (encrypted).</li>
      </ul>

      <h2 className="mt-8 font-display text-2xl">How Google data is used</h2>
      <p className="mt-3">
        Gmail access is used only to send the emails you approve and to detect replies and bounces to those emails. Calendar access is
        read-only and used only to find your free times. We don&apos;t read other email, sell data, use it for ads, or let people read it.
      </p>
      <p className="mt-3">
        Outreach Desk&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2 className="mt-8 font-display text-2xl">Who processes it</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        <li>Anthropic (Claude) writes drafts, proofreads and researches people.</li>
        <li>Google (Gmail, Calendar, sign-in).</li>
        <li>Hunter.io or Apollo.io, only if you turn them on.</li>
        <li>Vercel and Neon host the app and database.</li>
      </ul>

      <h2 className="mt-8 font-display text-2xl">Deleting your data</h2>
      <p className="mt-3">
        Setup → Delete account removes everything we store and disconnects Google. Emails you already sent stay in your Gmail. You can also
        remove access anytime at{" "}
        <a className="underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
          myaccount.google.com/permissions
        </a>
        .
      </p>
    </main>
  );
}
