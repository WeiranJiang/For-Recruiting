"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "./api";
import { Button, Toaster, cx, toast } from "./ui";
import { Setup } from "./Setup";
import { FindPeople } from "./FindPeople";
import { SwipeDeck } from "./SwipeDeck";
import { ReviewPile } from "./ReviewPile";
import { Tracker } from "./Tracker";
import { Queue } from "./Queue";

const TABS = [
  { id: "setup", label: "1 · Setup" },
  { id: "find", label: "2 · Find people" },
  { id: "swipe", label: "3 · Swipe" },
  { id: "review", label: "Review pile" },
  { id: "queue", label: "Queue" },
  { id: "tracker", label: "Tracker sheet" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function AppShell() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("swipe");
  const [counts, setCounts] = useState({ pending: 0, review: 0 });
  const [syncing, setSyncing] = useState(false);
  const [version, setVersion] = useState(0); // bump to refresh child lists
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const loadMe = useCallback(async () => {
    const r = await api<{ user: Me | null }>("/api/me");
    setMe(r.user);
    return r.user;
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        api<{ emails: unknown[] }>("/api/emails?status=pending"),
        api<{ emails: unknown[] }>("/api/emails?status=review,failed"),
      ]);
      setCounts({ pending: p.emails.length, review: r.emails.length });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadMe().then((u) => {
      if (u && !u.profile.fullName) setTab("setup");
    });
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) {
      toast(err, "bad");
      window.history.replaceState({}, "", "/");
    }
  }, [loadMe]);

  useEffect(() => {
    if (!me) return;
    void loadCounts();
  }, [me, version, loadCounts]);

  // While the app is open: send due emails + check Gmail every minute.
  useEffect(() => {
    if (!me) return;
    const tick = async () => {
      try {
        const r = await api<{ sent: number; sync: { replies?: number; bounces?: number } | null }>("/api/tick", { method: "POST" });
        if (r.sent) toast(`Sent ${r.sent} scheduled email${r.sent > 1 ? "s" : ""}`, "good");
        if (r.sync?.replies) toast(`${r.sync.replies} new repl${r.sync.replies > 1 ? "ies" : "y"}!`, "good");
        if (r.sync?.bounces) toast(`${r.sync.bounces} email(s) bounced — flagged in the tracker`, "bad");
        if (r.sent || r.sync?.replies || r.sync?.bounces) bump();
      } catch {
        /* ignore */
      }
    };
    void tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [me, bump]);

  if (me === undefined) return <div className="p-10 text-center text-muted">Loading…</div>;
  if (me === null) return <Landing />;

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await api<{ sent: number; sync: { checked?: number; replies?: number; bounces?: number; error?: string } }>("/api/tick?sync=1", {
        method: "POST",
      });
      if (r.sync?.error) toast(r.sync.error, "bad");
      else toast(`Checked ${r.sync?.checked ?? 0} sent emails · ${r.sync?.replies ?? 0} new replies · ${r.sync?.bounces ?? 0} bounces`, "good");
      bump();
      void loadMe();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Outreach Desk</h1>
          <p className="text-xs text-muted">
            {me.email}
            {me.lastSyncAt && <> · checked Gmail {new Date(me.lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={syncNow} loading={syncing}>
            Check replies &amp; bounces
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await api("/api/auth/logout", { method: "POST" });
              setMe(null);
            }}
          >
            Sign out
          </Button>
        </div>
      </header>
      {!me.gmailConnected && (
        <div className="mb-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">
          Gmail isn&apos;t connected. <a className="font-semibold underline" href="/api/auth/login">Sign in with Google again</a> and allow the Gmail permissions.
        </div>
      )}
      <nav className="sticky top-0 z-20 -mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line bg-bg/95 px-4 py-2 backdrop-blur">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium",
              tab === t.id ? "bg-accent text-white" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {t.label}
            {t.id === "swipe" && counts.pending > 0 && <span className="ml-1.5 rounded-full bg-white/25 px-1.5 text-xs">{counts.pending}</span>}
            {t.id === "review" && counts.review > 0 && <span className="ml-1.5 rounded-full bg-warn/30 px-1.5 text-xs">{counts.review}</span>}
          </button>
        ))}
      </nav>
      <main>
        {tab === "setup" && <Setup me={me} onChange={setMe} />}
        {tab === "find" && <FindPeople me={me} onDone={() => { bump(); setTab("swipe"); }} goSetup={() => setTab("setup")} />}
        {tab === "swipe" && <SwipeDeck key={version} me={me} onChange={bump} goFind={() => setTab("find")} />}
        {tab === "review" && <ReviewPile key={version} me={me} onChange={bump} />}
        {tab === "queue" && <Queue key={version} onChange={bump} />}
        {tab === "tracker" && <Tracker key={version} me={me} onChange={bump} goSwipe={() => setTab("swipe")} />}
      </main>
      <Toaster />
    </div>
  );
}

function Landing() {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-4 py-16">
      <h1 className="text-4xl font-bold tracking-tight">Outreach Desk</h1>
      <p className="mt-3 text-lg text-muted">
        Cold-email bankers without the spreadsheet chaos. Find the right people, get a draft that sounds like you, swipe right to send on a smart
        schedule, and see every reply, bounce and follow-up in one sheet.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {[
          ["Find people", "Describe who you want to reach (schools, past internships, groups) and the AI searches the web, with an accuracy % on every email."],
          ["Drafts in your voice", "Built from a networking master prompt plus your resume; it learns from your edits and feedback."],
          ["Swipe to send", "Right = send on your schedule rules (with resume attached). Left = edit pile. Grammar & smoothness check built in."],
          ["Never double-email", "Every send goes through your Gmail and is tracked. Duplicates are blocked; replies and bounces are flagged."],
        ].map(([h, p]) => (
          <div key={h} className="rounded-xl border border-line bg-surface p-4">
            <div className="font-semibold">{h}</div>
            <div className="mt-1 text-sm text-muted">{p}</div>
          </div>
        ))}
      </div>
      <a
        href="/api/auth/login"
        className="mt-8 inline-flex w-fit items-center gap-2 rounded-lg bg-accent px-5 py-3 font-semibold text-white hover:opacity-90"
      >
        Sign in with Google
      </a>
      <p className="mt-3 text-xs text-muted">
        You&apos;ll be asked to let the app send email and read your inbox (to detect replies and bounces). Nothing is sent without your swipe.
      </p>
      <Toaster />
    </div>
  );
}
