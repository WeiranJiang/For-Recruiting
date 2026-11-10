"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DateTime } from "luxon";
import { api, fmtTime, type EmailCard, type GrammarIssue, type Me } from "./api";
import { Rationale, Warnings, approve } from "./EmailParts";
import { HighlightTextarea, ProofreadBar, applyIssue, useLiveGrammar } from "./Proofread";
import { OfferTimes } from "./OfferTimes";
import { Pct, cx, toast } from "./ui";
import { insertBeforeSignoff } from "@/lib/availability";
import { resumeFilename } from "@/lib/text-rules";
import { cleanList } from "@/lib/mime";

/* ---------- tiny Material-style icons ---------- */
const P: Record<string, string> = {
  attach: "M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z",
  event: "M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11zM7 11h5v5H7z",
  sparkle: "M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5z",
  notes: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  info: "M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z",
  trash: "M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7z",
  down: "M7 10l5 5 5-5z",
  min: "M6 19h12v2H6z",
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  clock: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  pdf: "M20 2H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z",
};
export function Icon({ name, className }: { name: keyof typeof P; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cx("h-5 w-5 fill-current", className)}>
      <path d={P[name]} />
    </svg>
  );
}

function IconBtn({ name, label, onClick, active }: { name: keyof typeof P; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cx("rounded-full p-2 text-gm-icon transition hover:bg-gm-chip", active && "bg-gm-chip")}
    >
      <Icon name={name} />
    </button>
  );
}

function toLocalInput(iso: string) {
  return DateTime.fromISO(iso).toFormat("yyyy-LL-dd'T'HH:mm");
}

/**
 * Gmail-style compose window used for both the swipe deck and the review pile.
 * Everything is editable in place; changes save automatically.
 */
export function ComposeWindow({
  e,
  me,
  dragHandle,
  onSent,
  onDeleted,
  onLater,
  laterLabel = "Later",
  goSetup,
}: {
  e: EmailCard;
  me: Me;
  /** pointer handlers for the title bar (swipe deck drags by the header, like a Gmail window) */
  dragHandle?: React.HTMLAttributes<HTMLDivElement>;
  onSent: () => void;
  onDeleted: () => void;
  onLater?: () => void;
  laterLabel?: string;
  goSetup?: () => void;
}) {
  const [to, setTo] = useState(e.to.join(", "));
  const [cc, setCc] = useState(e.cc.join(", "));
  const [bcc, setBcc] = useState(e.bcc.join(", "));
  const [showCc, setShowCc] = useState(e.cc.length > 0);
  const [showBcc, setShowBcc] = useState(e.bcc.length > 0);
  const [subject, setSubject] = useState(e.subject);
  const [body, setBody] = useState(e.body);
  const [attach, setAttach] = useState(e.attachResume);
  const [requestedAt, setRequestedAt] = useState<string | null>(e.requestedAt);
  const [notes, setNotes] = useState(e.contact.myNotes);
  const [panel, setPanel] = useState<null | "times" | "notes" | "why" | "schedule">(null);
  const [busy, setBusy] = useState<null | "send" | "rewrite" | "delete">(null);
  const [openedAt] = useState(() => Date.now());
  const live = useLiveGrammar(subject, body, { initial: e.grammar });

  // ---- autosave (debounced) ----
  const saved = useRef({ to, cc, bcc, subject, body, attach, requestedAt });
  const dirty = () => {
    const s = saved.current;
    return s.to !== to || s.cc !== cc || s.bcc !== bcc || s.subject !== subject || s.body !== body || s.attach !== attach || s.requestedAt !== requestedAt;
  };
  const flush = async () => {
    if (!dirty()) return;
    const snap = { to, cc, bcc, subject, body, attach, requestedAt };
    await api(`/api/emails/${e.id}`, {
      method: "PATCH",
      json: { to, cc, bcc, subject, body, attachResume: attach, requestedAt, grammar: live.grammar, ...(e.status === "failed" ? { status: "review" } : {}) },
    });
    saved.current = snap;
  };
  useEffect(() => {
    const t = setTimeout(() => void flush().catch(() => {}), 900);
    return () => clearTimeout(t);
  }); // runs after every render; flush() is a no-op when nothing changed

  const accept = (i: GrammarIssue) => {
    const ns = i.field === "subject" ? applyIssue(subject, i) : subject;
    const nb = i.field === "body" ? applyIssue(body, i) : body;
    live.markApplied([i], ns, nb);
    setSubject(ns);
    setBody(nb);
  };
  const acceptAll = () => {
    let ns = subject;
    let nb = body;
    for (const i of live.issues) {
      if (i.field === "subject") ns = applyIssue(ns, i);
      else nb = applyIssue(nb, i);
    }
    live.markApplied(live.issues, ns, nb);
    setSubject(ns);
    setBody(nb);
  };

  const send = async () => {
    setBusy("send");
    try {
      await flush();
      const r = await approve({ ...e, to: cleanList(to), cc: cleanList(cc), bcc: cleanList(bcc), subject, body });
      if (r === "ok") onSent();
    } finally {
      setBusy(null);
    }
  };

  const sendAt = requestedAt ?? e.proposedAt;
  const isLater = !!sendAt && new Date(sendAt).getTime() > openedAt + 120_000;
  const fileName = me.resume.hasPdf ? resumeFilename(me.profile.fullName || me.name, me.resume.filename ?? "Resume.pdf") : null;
  const c = e.contact;

  const row = (label: string, value: string, set: (v: string) => void, extra?: ReactNode) => (
    <div className="flex items-center gap-2 border-b border-gm-rule px-4 py-1.5">
      <span className="w-14 shrink-0 text-[13px] text-muted">{label}</span>
      <input className="min-w-0 flex-1 bg-transparent py-1 outline-none" value={value} onChange={(x) => set(x.target.value)} />
      {extra}
    </div>
  );

  return (
    <div className="gm-compose overflow-hidden rounded-xl bg-gm-window text-fg shadow-lift ring-1 ring-black/5">
      {/* title bar */}
      <div {...dragHandle} className={cx("flex items-center gap-2 bg-gm-header px-4 py-2.5 text-gm-header-fg", dragHandle && "cursor-grab active:cursor-grabbing")}>
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {e.kind === "follow_up" ? "Follow-up" : "New Message"} <span className="font-normal opacity-70">· {c.name}{c.bank ? `, ${c.bank}` : ""}</span>
        </div>
        <Pct value={c.accuracy} />
        {onLater && (
          <button title={laterLabel} aria-label={laterLabel} onClick={onLater} className="rounded p-0.5 opacity-70 hover:opacity-100">
            <Icon name="min" className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* recipients */}
      {row(
        "To",
        to,
        setTo,
        <span className="flex shrink-0 gap-2 text-[13px] text-muted">
          {!showCc && (
            <button className="hover:underline" onClick={() => setShowCc(true)}>
              Cc
            </button>
          )}
          {!showBcc && (
            <button className="hover:underline" onClick={() => setShowBcc(true)}>
              Bcc
            </button>
          )}
        </span>,
      )}
      {showCc && row("Cc", cc, setCc)}
      {showBcc && row("Bcc", bcc, setBcc)}
      <div className="border-b border-gm-rule px-4 py-1.5">
        <HighlightTextarea
          singleLine
          className="rounded-none! border-0! px-0! py-1! ring-0!"
          value={subject}
          onChange={setSubject}
          issues={live.issues.filter((i) => i.field === "subject")}
        />
      </div>

      {/* body */}
      <div className="px-4 pt-3">
        <Warnings e={{ ...e, subject, body }} />
        <HighlightTextarea
          className="gm-body min-h-56 rounded-none! border-0! px-0! ring-0!"
          value={body}
          onChange={setBody}
          issues={live.issues.filter((i) => i.field === "body")}
        />
        {attach && (
          <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-md border border-gm-rule bg-gm-chip/60 px-3 py-2 text-[13px]">
            <Icon name="pdf" className="h-5 w-5 text-[#d93025]" />
            <span className="truncate font-medium">{fileName ?? "No resume uploaded"}</span>
            <button title="Remove attachment" onClick={() => setAttach(false)} className="text-muted hover:text-fg">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* panels */}
      {(live.issues.length > 0 || live.checking || live.failed) && (
        <div className="px-4 pb-2">
          <ProofreadBar grammar={live.grammar} issues={live.issues} checking={live.checking} failed={live.failed} onAccept={accept} onDismiss={live.dismiss} onAcceptAll={acceptAll} />
        </div>
      )}
      {panel === "times" && (
        <div className="px-4 pb-3">
          <OfferTimes
            goSetup={goSetup}
            onClose={() => setPanel(null)}
            onInsert={(text) => {
              setPanel(null);
              setBody(insertBeforeSignoff(body, text));
            }}
          />
        </div>
      )}
      {panel === "notes" && (
        <div className="space-y-2 px-4 pb-3">
          <textarea
            autoFocus
            className="w-full rounded-lg border border-gm-rule bg-transparent p-3 text-sm outline-none focus:border-gm-blue"
            rows={3}
            value={notes}
            onChange={(x) => setNotes(x.target.value)}
            placeholder={`Notes on ${c.name.split(" ")[0]}: where you met, what you talked about`}
          />
          <div className="flex justify-end">
            <button
              disabled={busy === "rewrite"}
              className="gm-send rounded-full px-4 py-1.5 text-sm font-medium disabled:opacity-60"
              onClick={async () => {
                setBusy("rewrite");
                try {
                  await api(`/api/contacts/${c.id}`, { method: "PATCH", json: { myNotes: notes } });
                  await flush();
                  const r = await api<{ email: EmailCard }>(`/api/emails/${e.id}/regenerate`, { method: "POST" });
                  setSubject(r.email.subject);
                  setBody(r.email.body);
                  saved.current = { ...saved.current, subject: r.email.subject, body: r.email.body };
                  setPanel(null);
                } catch (err) {
                  toast((err as Error).message, "bad");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === "rewrite" ? "Rewriting…" : "Rewrite with notes"}
            </button>
          </div>
        </div>
      )}
      {panel === "why" && (
        <div className="mx-4 mb-3 rounded-lg border border-gm-rule p-3">
          <Rationale e={e} />
        </div>
      )}
      {panel === "schedule" && (
        <div className="mx-4 mb-3 space-y-2 rounded-lg border border-gm-rule p-3 text-sm">
          <div className="font-medium">Schedule send</div>
          <button
            className={cx("flex w-full items-center justify-between rounded-md px-2 py-1.5 hover:bg-gm-chip", !requestedAt && "bg-gm-chip")}
            onClick={() => {
              setRequestedAt(null);
              setPanel(null);
            }}
          >
            <span>Best time (your rules)</span>
            <span className="text-muted">{e.proposedAt ? fmtTime(e.proposedAt) : "—"}</span>
          </button>
          <label className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
            <span>Pick date &amp; time</span>
            <input
              type="datetime-local"
              className="rounded-md border border-gm-rule bg-transparent px-2 py-1"
              value={requestedAt ? toLocalInput(requestedAt) : ""}
              onChange={(x) => setRequestedAt(x.target.value ? new Date(x.target.value).toISOString() : null)}
            />
          </label>
        </div>
      )}

      {/* bottom toolbar */}
      <div className="flex items-center gap-1 px-3 pb-3 pt-1">
        <div className="flex overflow-hidden rounded-full">
          <button disabled={!!busy} onClick={send} className="gm-send py-2 pl-5 pr-4 text-sm font-medium disabled:opacity-60">
            {busy === "send" ? "Sending…" : isLater ? "Schedule send" : "Send"}
          </button>
          <button
            title="Schedule send"
            aria-label="Schedule send"
            onClick={() => setPanel(panel === "schedule" ? null : "schedule")}
            className="gm-send border-l border-black/15 px-2"
          >
            <Icon name="down" />
          </button>
        </div>
        {sendAt && (
          <button onClick={() => setPanel(panel === "schedule" ? null : "schedule")} className="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[13px] text-muted hover:bg-gm-chip">
            <Icon name="clock" className="h-4 w-4" />
            {isLater ? fmtTime(sendAt) : "now"}
          </button>
        )}
        <div className="ml-auto flex items-center">
          <IconBtn name="attach" label={attach ? "Remove resume" : "Attach resume"} active={attach} onClick={() => setAttach((a) => !a)} />
          <IconBtn name="event" label="Offer times" active={panel === "times"} onClick={() => setPanel(panel === "times" ? null : "times")} />
          <IconBtn name="notes" label="Notes & rewrite" active={panel === "notes"} onClick={() => setPanel(panel === "notes" ? null : "notes")} />
          <IconBtn name="info" label="Why this person" active={panel === "why"} onClick={() => setPanel(panel === "why" ? null : "why")} />
          <IconBtn
            name="trash"
            label="Discard draft"
            onClick={async () => {
              setBusy("delete");
              try {
                await api(`/api/emails/${e.id}`, { method: "DELETE" });
                onDeleted();
              } finally {
                setBusy(null);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
