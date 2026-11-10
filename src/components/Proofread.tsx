"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Grammar, type GrammarIssue } from "./api";
import { Pct, cx } from "./ui";

/** Grammarly-style live proofreading: red = spelling/grammar, blue = clunky phrasing. */

const keyOf = (i: GrammarIssue) => `${i.field}|${i.type}|${i.original}`;

export function issueColor(t: GrammarIssue["type"]) {
  return t === "clarity" ? "gm-clarity" : "gm-error";
}

type Range = { start: number; end: number; issue: GrammarIssue };

/** Finds each issue's text in the field; drops issues that no longer appear and overlapping ones. */
export function locate(text: string, issues: GrammarIssue[]): Range[] {
  const out: Range[] = [];
  for (const issue of issues) {
    if (!issue.original) continue;
    let from = 0;
    let idx = text.indexOf(issue.original, from);
    while (idx >= 0 && out.some((r) => idx < r.end && idx + issue.original.length > r.start)) {
      from = idx + 1;
      idx = text.indexOf(issue.original, from);
    }
    if (idx >= 0) out.push({ start: idx, end: idx + issue.original.length, issue });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function applyIssue(text: string, issue: GrammarIssue) {
  const idx = text.indexOf(issue.original);
  if (idx < 0) return text;
  return text.slice(0, idx) + issue.suggestion + text.slice(idx + issue.original.length);
}

/**
 * Debounced automatic check. Re-runs ~1.4s after subject/body stop changing.
 * `accept` applies a suggestion locally without triggering a fresh round-trip.
 */
export function useLiveGrammar(subject: string, body: string, opts: { initial?: Grammar | null; enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const [grammar, setGrammar] = useState<Grammar | null>(opts.initial ?? null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const checkedFor = useRef<string | null>(opts.initial ? `${subject}\u0000${body}` : null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!enabled || !body.trim()) return;
    const sig = `${subject}\u0000${body}`;
    if (checkedFor.current === sig) return;
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        const r = await api<{ grammar: Grammar | null }>("/api/grammar", { method: "POST", json: { subject, body } });
        if (id !== reqId.current) return;
        checkedFor.current = sig;
        setGrammar(r.grammar);
        setFailed(false);
      } catch {
        if (id === reqId.current) setFailed(true);
      } finally {
        if (id === reqId.current) setChecking(false);
      }
    }, 1400);
    return () => clearTimeout(t);
  }, [subject, body, enabled]);

  const visible: GrammarIssue[] = (grammar?.issues ?? []).filter((i) => !dismissed.has(keyOf(i)));

  /** Mark the text after local fixes as already checked; returns the grammar minus the fixed issues. */
  const markApplied = useCallback(
    (fixed: GrammarIssue[], newSubject: string, newBody: string): Grammar | null => {
      checkedFor.current = `${newSubject}\u0000${newBody}`;
      reqId.current++;
      const next = grammar ? { ...grammar, issues: grammar.issues.filter((i) => !fixed.includes(i)) } : null;
      setGrammar(next);
      return next;
    },
    [grammar],
  );

  const dismiss = useCallback((issue: GrammarIssue) => setDismissed((d) => new Set(d).add(keyOf(issue))), []);

  return { grammar, issues: visible, checking, failed, markApplied, dismiss };
}

function Popover({ issue, onAccept, onDismiss, onClose }: { issue: GrammarIssue; onAccept: () => void; onDismiss: () => void; onClose: () => void }) {
  return (
    <span
      className="absolute left-0 top-full z-30 mt-1.5 block w-72 rounded-2xl border border-line/70 bg-surface p-4 shadow-lift text-left text-sm font-normal not-italic text-fg"
      onClick={(e) => e.stopPropagation()}
    >
      <span className={cx("mb-1 block text-xs font-semibold uppercase", issue.type === "clarity" ? "text-[var(--clarity)]" : "text-bad")}>
        {issue.type === "clarity" ? "Clarity" : issue.type === "spelling" ? "Spelling" : "Grammar"}
      </span>
      <span className="block">
        {issue.suggestion ? (
          <>
            <span className="text-muted line-through">{issue.original}</span> → <span className="font-semibold">{issue.suggestion}</span>
          </>
        ) : (
          <>
            Remove <span className="font-semibold">“{issue.original}”</span>
          </>
        )}
      </span>
      <span className="mt-1 block text-xs text-muted">{issue.reason}</span>
      <span className="mt-2 flex gap-2">
        <button className="rounded-full bg-fg px-3 py-1 text-xs font-semibold text-bg" onClick={onAccept}>
          Accept
        </button>
        <button className="rounded-full border border-line px-3 py-1 text-xs" onClick={onDismiss}>
          Dismiss
        </button>
        <button className="ml-auto text-xs text-muted" onClick={onClose}>
          ✕
        </button>
      </span>
    </span>
  );
}

/** Read-only text with clickable underlines (used on the swipe card). */
export function HighlightedText({
  text,
  issues,
  onAccept,
  onDismiss,
  className,
}: {
  text: string;
  issues: GrammarIssue[];
  onAccept: (i: GrammarIssue) => void;
  onDismiss: (i: GrammarIssue) => void;
  className?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const ranges = locate(text, issues);
  const parts: ReactNode[] = [];
  let pos = 0;
  ranges.forEach((r, k) => {
    if (r.start > pos) parts.push(text.slice(pos, r.start));
    parts.push(
      <span key={k} className="relative">
        <span
          className={cx(issueColor(r.issue.type), "cursor-pointer")}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(open === k ? null : k);
          }}
        >
          {text.slice(r.start, r.end)}
        </span>
        {open === k && (
          <Popover
            issue={r.issue}
            onAccept={() => {
              setOpen(null);
              onAccept(r.issue);
            }}
            onDismiss={() => {
              setOpen(null);
              onDismiss(r.issue);
            }}
            onClose={() => setOpen(null)}
          />
        )}
      </span>,
    );
    pos = r.end;
  });
  parts.push(text.slice(pos));
  return <span className={cx("whitespace-pre-wrap", className)}>{parts}</span>;
}

/**
 * Editable textarea with underlines drawn on a mirrored backdrop.
 * The textarea auto-grows so the backdrop never needs to scroll.
 */
export function HighlightTextarea({
  value,
  onChange,
  issues,
  className,
  singleLine,
}: {
  value: string;
  onChange: (v: string) => void;
  issues: GrammarIssue[];
  className?: string;
  singleLine?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const ranges = locate(value, issues);
  const parts: ReactNode[] = [];
  let pos = 0;
  ranges.forEach((r, k) => {
    if (r.start > pos) parts.push(value.slice(pos, r.start));
    parts.push(
      <span key={k} className={issueColor(r.issue.type)}>
        {value.slice(r.start, r.end)}
      </span>,
    );
    pos = r.end;
  });
  parts.push(value.slice(pos) + "\n");
  const shared = "w-full whitespace-pre-wrap break-words rounded-xl border px-3 py-2 " + (className ?? "");
  return (
    <div className="relative">
      <div aria-hidden className={cx(shared, "pointer-events-none absolute inset-0 border-transparent text-transparent")}>
        {parts}
      </div>
      <textarea
        ref={ref}
        rows={singleLine ? 1 : 6}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(singleLine ? e.target.value.replace(/\n/g, " ") : e.target.value)}
        className={cx(
          shared,
          "relative resize-none overflow-hidden border-line bg-transparent text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20",
        )}
      />
    </div>
  );
}

/** Compact summary + list of suggestions with one-click accept (like Grammarly's sidebar). */
export function ProofreadBar({
  grammar,
  issues,
  checking,
  failed,
  onAccept,
  onDismiss,
  onAcceptAll,
  showList = true,
}: {
  grammar: Grammar | null;
  issues: GrammarIssue[];
  checking: boolean;
  failed?: boolean;
  onAccept: (i: GrammarIssue) => void;
  onDismiss: (i: GrammarIssue) => void;
  onAcceptAll?: () => void;
  showList?: boolean;
}) {
  const errors = issues.filter((i) => i.type !== "clarity").length;
  const clarity = issues.length - errors;
  return (
    <div className="rounded-2xl bg-surface-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {checking ? (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> Checking…
          </span>
        ) : failed && !grammar ? (
          <span className="text-warn">Proofreading unavailable right now; it will retry when you edit.</span>
        ) : grammar ? (
          <>
            <span className="text-muted">Smoothness</span> <Pct value={grammar.smoothness} />
          </>
        ) : (
          <span className="text-muted">Proofreading starts automatically</span>
        )}
        <span className="inline-flex items-center gap-1 text-xs">
          <span className="gm-dot-error" /> {errors} correctness
        </span>
        <span className="inline-flex items-center gap-1 text-xs">
          <span className="gm-dot-clarity" /> {clarity} clarity
        </span>
        {onAcceptAll && issues.length > 1 && (
          <button className="ml-auto rounded-full bg-fg px-3 py-1 text-xs font-semibold text-bg" onClick={onAcceptAll}>
            Accept all
          </button>
        )}
      </div>
      {grammar?.summary && !checking && <p className="mt-1 text-xs text-muted">{grammar.summary}</p>}
      {showList && issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {issues.map((i, k) => (
            <li key={k} className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-xs">
              <span className={i.type === "clarity" ? "gm-dot-clarity" : "gm-dot-error"} />
              <span className="min-w-0 flex-1">
                <span className="text-muted line-through">{i.original}</span>
                {i.suggestion && <> → <span className="font-semibold">{i.suggestion}</span></>}
                <span className="text-muted"> · {i.reason}</span>
              </span>
              <button className="font-semibold text-accent" onClick={() => onAccept(i)}>
                Accept
              </button>
              <button className="text-muted" onClick={() => onDismiss(i)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
