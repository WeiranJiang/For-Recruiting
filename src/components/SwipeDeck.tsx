"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtTime, type EmailCard, type Me } from "./api";
import { AccuracyRow, BodyStats, Rationale, Recipients, Warnings, approve, useBusy } from "./EmailParts";
import { resumeFilename } from "@/lib/text-rules";
import { HighlightedText, ProofreadBar, applyIssue, useLiveGrammar } from "./Proofread";
import type { GrammarIssue } from "./api";
import { Badge, Button, Card, cx, toast } from "./ui";

const THRESHOLD = 110;

export function SwipeDeck({ me, onChange, goFind }: { me: Me; onChange: () => void; goFind: () => void }) {
  const [cards, setCards] = useState<EmailCard[] | null>(null);
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<"left" | "right" | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const start = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const { busy, wrap } = useBusy();

  const load = useCallback(async () => {
    const r = await api<{ emails: EmailCard[] }>("/api/emails?status=pending");
    setCards(r.emails);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const top = cards?.[0];

  const finish = useCallback(
    (dir: "left" | "right") => {
      setLeaving(dir);
      setTimeout(() => {
        setCards((c) => (c ? c.slice(1) : c));
        setLeaving(null);
        setDx(0);
        setShowWhy(false);
        onChange();
      }, 220);
    },
    [onChange],
  );

  const swipeLeft = useCallback(async () => {
    if (!top || busy) return;
    await wrap("left", async () => {
      await api(`/api/emails/${top.id}`, { method: "PATCH", json: { status: "review" } });
      finish("left");
    });
  }, [top, busy, wrap, finish]);

  const swipeRight = useCallback(async () => {
    if (!top || busy) return;
    await wrap("right", async () => {
      const r = await approve(top);
      if (r === "ok") finish("right");
      else if (r === "blocked") {
        // Couldn't send as-is (e.g. invalid address) → move it to the review pile to fix.
        await api(`/api/emails/${top.id}`, { method: "PATCH", json: { status: "review" } });
        toast("Moved to the review pile so you can fix it", "neutral");
        finish("left");
      } else setDx(0);
    });
  }, [top, busy, wrap, finish]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") void swipeRight();
      if (e.key === "ArrowLeft") void swipeLeft();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swipeLeft, swipeRight]);

  if (cards === null) return <p className="text-center text-muted">Loading drafts…</p>;
  if (!top)
    return (
      <Card className="mx-auto max-w-xl text-center">
        <p className="font-display text-3xl">All caught up</p>
        <p className="mt-1 text-sm text-muted">Find people to get new drafts, or draft follow-ups from the Tracker sheet.</p>
        <Button variant="primary" className="mt-4" onClick={goFind}>
          Find people
        </Button>
      </Card>
    );

  const patch = async (json: Record<string, unknown>) => {
    await api(`/api/emails/${top.id}`, { method: "PATCH", json });
    setCards((c) => (c ? [{ ...c[0], ...json } as EmailCard, ...c.slice(1)] : c));
  };

  const offset = leaving === "right" ? 700 : leaving === "left" ? -700 : dx;
  const hint = dx > 40 ? "send" : dx < -40 ? "review" : null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 flex items-center justify-between text-sm text-muted">
        <span>
          {cards.length} draft{cards.length > 1 ? "s" : ""} to go
        </span>
        <span className="hidden sm:inline">← / → arrow keys work too</span>
      </div>
      <div className="relative">
        {cards[1] && <div className="absolute inset-x-4 -bottom-1 top-3 rotate-[1.5deg] rounded-[28px] border border-line bg-surface-2" />}
        {cards[2] && <div className="absolute inset-x-6 -bottom-2 top-5 -rotate-[1.5deg] rounded-[28px] border border-line bg-surface" />}
        <div
          className={cx(
            "relative touch-pan-y select-none rounded-[28px] border bg-surface p-6 shadow-lift sm:p-7",
            hint === "send" ? "border-accent" : hint === "review" ? "border-warn" : "border-line/70",
          )}
          style={{
            transform: `translateX(${offset}px) rotate(${offset / 30}deg)`,
            transition: dragging ? "none" : "transform 0.22s ease-out",
            opacity: leaving ? 0 : 1,
          }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button,a,input,textarea,details,.gm-error,.gm-clarity")) return;
            start.current = e.clientX;
            setDragging(true);
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => start.current !== null && setDx(e.clientX - start.current)}
          onPointerUp={() => {
            if (start.current === null) return;
            start.current = null;
            setDragging(false);
            if (dx > THRESHOLD) void swipeRight();
            else if (dx < -THRESHOLD) void swipeLeft();
            else setDx(0);
          }}
        >
          {hint && (
            <div
              className={cx(
                "absolute top-5 rounded-full px-3 py-1 text-sm font-semibold",
                hint === "send" ? "right-5 bg-accent text-white" : "left-5 bg-butter text-warn",
              )}
            >
              {hint === "send" ? "Send ✓" : "Edit later"}
            </div>
          )}
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-display text-3xl leading-tight">{top.contact.name}</div>
              <div className="text-sm text-muted">
                {[top.contact.title, top.contact.group, top.contact.bank].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {top.kind === "follow_up" && <Badge tone="accent">Follow-up</Badge>}
              <AccuracyRow e={top} />
            </div>
          </div>

          <div className="space-y-3">
            <Warnings e={top} />
            <ProofedContent
              key={top.id}
              e={top}
              resumeName={me.resume.hasPdf ? resumeFilename(me.profile.fullName || me.name, me.resume.filename ?? "Resume.pdf") : null}
              patch={patch}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setShowWhy((s) => !s)}>
                {showWhy ? "Hide" : "Why this email?"}
              </Button>
            </div>
            {showWhy && (
              <div className="rounded-xl border border-line p-3">
                <Rationale e={top} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-3">
        <Button className="py-3" onClick={swipeLeft} loading={busy === "left"}>
          ← Edit later
        </Button>
        <Button
          variant="danger"
          className="py-3"
          onClick={() =>
            wrap("delete", async () => {
              await api(`/api/emails/${top.id}`, { method: "DELETE" });
              finish("left");
            })
          }
        >
          Delete
        </Button>
        <Button variant="good" className="py-3" onClick={swipeRight} loading={busy === "right"}>
          Send →
        </Button>
      </div>
    </div>
  );
}

function ProofedContent({
  e,
  resumeName,
  patch,
}: {
  e: EmailCard;
  resumeName: string | null;
  patch: (json: Record<string, unknown>) => Promise<void>;
}) {
  const { grammar, issues, checking, failed, markApplied, dismiss } = useLiveGrammar(e.subject, e.body, { initial: e.grammar });
  const accept = async (i: GrammarIssue) => {
    const subject = i.field === "subject" ? applyIssue(e.subject, i) : e.subject;
    const body = i.field === "body" ? applyIssue(e.body, i) : e.body;
    const rest = markApplied([i], subject, body);
    await patch({ ...(i.field === "subject" ? { subject } : { body }), grammar: rest });
  };
  const acceptAll = async () => {
    let subject = e.subject;
    let body = e.body;
    for (const i of issues) {
      if (i.field === "subject") subject = applyIssue(subject, i);
      else body = applyIssue(body, i);
    }
    const rest = markApplied(issues, subject, body);
    await patch({ subject, body, grammar: rest });
  };
  const subjectIssues = issues.filter((i) => i.field === "subject");
  const bodyIssues = issues.filter((i) => i.field === "body");
  return (
    <>
      <div className="rounded-2xl bg-surface-2 p-4">
        <Recipients e={e} />
        <div className="mt-2 border-t border-line pt-2 text-sm">
          <span className="text-muted">Subject </span>
          <HighlightedText className="font-semibold" text={e.subject} issues={subjectIssues} onAccept={accept} onDismiss={dismiss} />
        </div>
      </div>
      <div className="text-[15px] leading-relaxed">
        <HighlightedText text={e.body} issues={bodyIssues} onAccept={accept} onDismiss={dismiss} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {e.attachResume ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1">
              {resumeName ? <>📎 {resumeName}</> : <span className="text-warn">📎 Resume (upload it in Setup first)</span>}
              <button className="ml-1 text-muted hover:text-bad" title="Don't attach the resume to this email" onClick={() => patch({ attachResume: false })}>
                ✕
              </button>
            </span>
          ) : (
            <button className="rounded-full border border-dashed border-line px-3 py-1 text-muted hover:text-fg" onClick={() => patch({ attachResume: true })}>
              + attach resume
            </button>
          )}
          <BodyStats body={e.body} />
        </div>
        <span>
          <span className="text-muted">Sends </span>
          <span className="font-medium">{e.requestedAt ? fmtTime(e.requestedAt) : e.proposedAt ? fmtTime(e.proposedAt) : "—"}</span>
          {!e.requestedAt && <span className="text-xs text-muted"> (next slot per your rules)</span>}
        </span>
      </div>
      <ProofreadBar grammar={grammar} issues={issues} checking={checking} failed={failed} onAccept={accept} onDismiss={dismiss} onAcceptAll={acceptAll} showList={false} />
    </>
  );
}
