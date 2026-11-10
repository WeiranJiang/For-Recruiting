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
    <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 pb-4 pt-6">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="font-display text-2xl leading-none">Outreach Desk</h1>
            <p className="mt-1 text-xs text-muted">
              {me.email}
              {me.lastSyncAt && <> · Gmail checked {new Date(me.lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</>}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={syncNow} loading={syncing}>
            Check replies
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
        <div className="mb-4 rounded-2xl bg-peach px-4 py-3 text-sm">
          Gmail isn&apos;t connected. <a className="font-semibold underline underline-offset-2" href="/api/auth/login">Sign in with Google again</a> and allow the Gmail permissions.
        </div>
      )}
      <nav className="sticky top-0 z-20 -mx-4 mb-6 bg-bg/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-surface-2 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition",
                tab === t.id ? "bg-surface text-fg shadow-soft" : "text-muted hover:text-fg",
              )}
            >
              {t.label}
              {t.id === "swipe" && counts.pending > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 py-px text-[11px] font-semibold text-white">{counts.pending}</span>}
              {t.id === "review" && counts.review > 0 && <span className="ml-1.5 rounded-full bg-butter px-1.5 py-px text-[11px] font-semibold text-warn">{counts.review}</span>}
            </button>
          ))}
        </div>
      </nav>
      <main className="animate-rise" key={tab}>
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

function Logo() {
  return (
    <span className="relative inline-flex h-10 w-10 items-center justify-center">
      <span className="absolute inset-0 rotate-[-8deg] rounded-xl bg-lilac" />
      <span className="absolute inset-0 rotate-[6deg] rounded-xl bg-butter" />
      <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-fg font-display text-lg italic text-bg">O</span>
    </span>
  );
}

function Landing() {
  const features: [string, string, string][] = [
    ["bg-sky", "Find the right people", "Describe who you want to reach: schools, shared internships, groups. Every email comes with an accuracy %."],
    ["bg-lilac", "Drafts in your voice", "Built from a networking master prompt plus your resume and notes. It learns from every edit you make."],
    ["bg-butter", "Swipe to send", "Right sends on your schedule rules, resume attached. Left goes to the edit pile. Live proofreading as you type."],
    ["bg-sage", "Never double-email", "Every send goes through your Gmail and is tracked. Duplicates are blocked; replies and bounces are flagged."],
  ];
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="font-display text-2xl">Outreach Desk</span>
        </div>
        <a href="/api/auth/login" className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2">
          Sign in
        </a>
      </header>

      <section className="grid items-center gap-12 py-12 md:grid-cols-[1.1fr_1fr] md:py-20">
        <div className="animate-rise">
          <p className="mb-5 inline-flex rounded-full bg-peach px-3 py-1 text-xs font-medium text-bad">For investment banking recruiting</p>
          <h1 className="font-display text-5xl leading-[1.02] sm:text-6xl md:text-7xl">
            Cold emails that sound <em className="text-accent">like you</em>, sent at the right time.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Find bankers worth meeting, get drafts that read like a thoughtful student wrote them, swipe right to send through your own Gmail,
            and watch every reply land in one calm sheet.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="/api/auth/login" className="inline-flex items-center gap-2 rounded-full bg-fg px-6 py-3 font-medium text-bg shadow-soft transition hover:opacity-85">
              <GoogleG /> Continue with Google
            </a>
            <span className="text-sm text-muted">Nothing is sent without your swipe.</span>
          </div>
        </div>
        <HeroStack />
      </section>

      <section className="grid gap-4 pb-16 sm:grid-cols-2 lg:grid-cols-4">
        {features.map(([tint, h, p]) => (
          <div key={h} className={cx("rounded-3xl p-6", tint)}>
            <div className="font-display text-2xl leading-tight">{h}</div>
            <div className="mt-2 text-sm leading-relaxed text-fg/70">{p}</div>
          </div>
        ))}
      </section>
      <p className="pb-10 text-center text-xs text-muted">
        You&apos;ll be asked to let the app send email and read your inbox (only to detect replies and bounces).
      </p>
      <Toaster />
    </div>
  );
}

function HeroStack() {
  return (
    <div className="relative mx-auto h-[360px] w-full max-w-md select-none" aria-hidden>
      <div className="absolute inset-x-8 top-12 h-[320px] rotate-[7deg] rounded-3xl bg-sage" />
      <div className="absolute inset-x-6 top-8 h-[320px] -rotate-[5deg] rounded-3xl bg-lilac" />
      <div className="absolute inset-x-2 top-2 rounded-3xl border border-line/70 bg-surface p-6 shadow-lift">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">Jordan Lee</div>
            <div className="text-xs text-muted">Analyst · Strategic Advisory</div>
          </div>
          <span className="rounded-full bg-sage px-2.5 py-0.5 text-xs font-semibold text-good">92%</span>
        </div>
        <div className="mt-4 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-muted">
          Subject <span className="font-medium text-fg">Great Meeting You at PJT</span>
        </div>
        <p className="mt-4 text-sm leading-relaxed">
          Hi Jordan,
          <br />
          <br />
          It was great meeting you at the PJT session. Your point about the analyst class being small, so you get{" "}
          <span className="gm-clarity">real responsibility really early on</span>, stuck with me…
        </p>
        <div className="mt-5 flex items-center justify-between">
          <span className="rounded-full bg-surface-2 px-3 py-1 text-xs">📎 Resume.pdf</span>
          <span className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white">Send →</span>
        </div>
      </div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
