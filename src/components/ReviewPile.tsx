"use client";
import { useCallback, useEffect, useState } from "react";
import { api, fmtTime, type EmailCard, type Me } from "./api";
import { AccuracyRow, BodyStats, Rationale, Warnings, approve, useBusy } from "./EmailParts";
import { resumeFilename } from "@/lib/text-rules";
import { insertBeforeSignoff } from "@/lib/availability";
import { OfferTimes } from "./OfferTimes";
import { HighlightTextarea, ProofreadBar, applyIssue, useLiveGrammar } from "./Proofread";
import type { GrammarIssue } from "./api";
import { Badge, Button, Card, Field, cx, inputCls, toast } from "./ui";

export function ReviewPile({ me, onChange }: { me: Me; onChange: () => void }) {
  const [list, setList] = useState<EmailCard[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ emails: EmailCard[] }>("/api/emails?status=review,failed");
    setList(r.emails);
    setSel((s) => (s && r.emails.some((e) => e.id === s) ? s : (r.emails[0]?.id ?? null)));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (list === null) return <p className="text-center text-muted">Loading…</p>;
  if (!list.length)
    return (
      <Card className="mx-auto max-w-xl text-center">
        <p className="font-display text-3xl">Nothing to fix</p>
        <p className="mt-1 text-sm text-muted">Emails you swipe left (or that couldn&apos;t be sent) land here for editing.</p>
      </Card>
    );
  const current = list.find((e) => e.id === sel) ?? list[0];

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <div className="space-y-1.5">
        {list.map((e) => (
          <button
            key={e.id}
            onClick={() => setSel(e.id)}
            className={cx(
              "w-full rounded-2xl border px-3.5 py-3 text-left text-sm transition",
              e.id === current.id ? "border-transparent bg-surface shadow-soft" : "border-transparent bg-transparent hover:bg-surface-2",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{e.contact.name}</span>
              {e.status === "failed" ? <Badge tone="bad">not sent</Badge> : e.kind === "follow_up" ? <Badge tone="accent">follow-up</Badge> : null}
            </div>
            <div className="truncate text-xs text-muted">{e.contact.bank}</div>
          </button>
        ))}
      </div>
      <Editor
        key={current.id}
        e={current}
        me={me}
        onDone={() => {
          void load();
          onChange();
        }}
      />
    </div>
  );
}

function Editor({ e, me, onDone }: { e: EmailCard; me: Me; onDone: () => void }) {
  const [to, setTo] = useState(e.to.join(", "));
  const [cc, setCc] = useState(e.cc.join(", "));
  const [bcc, setBcc] = useState(e.bcc.join(", "));
  const [subject, setSubject] = useState(e.subject);
  const [body, setBody] = useState(e.body);
  const [attach, setAttach] = useState(e.attachResume);
  const [when, setWhen] = useState(e.requestedAt ? toLocalInput(e.requestedAt) : "");
  const [notes, setNotes] = useState(e.contact.myNotes);
  const { busy, wrap } = useBusy();
  const [offering, setOffering] = useState(false);
  const live = useLiveGrammar(subject, body, { initial: e.grammar });
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

  const dirty =
    to !== e.to.join(", ") ||
    cc !== e.cc.join(", ") ||
    bcc !== e.bcc.join(", ") ||
    subject !== e.subject ||
    body !== e.body ||
    attach !== e.attachResume ||
    when !== (e.requestedAt ? toLocalInput(e.requestedAt) : "");

  const save = async () => {
    await api(`/api/emails/${e.id}`, {
      method: "PATCH",
      json: {
        to,
        cc,
        bcc,
        subject,
        body,
        attachResume: attach,
        requestedAt: when ? new Date(when).toISOString() : null,
        grammar: live.grammar,
      },
    });
  };
  const saveNotes = async () => {
    if (notes !== e.contact.myNotes) await api(`/api/contacts/${e.contact.id}`, { method: "PATCH", json: { myNotes: notes } });
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-display text-3xl leading-tight">{e.contact.name}</div>
          <div className="text-sm text-muted">{[e.contact.title, e.contact.group, e.contact.bank].filter(Boolean).join(" · ")}</div>
        </div>
        <AccuracyRow e={e} />
      </div>
      <Warnings e={e} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="To">
          <input className={inputCls} value={to} onChange={(x) => setTo(x.target.value)} />
        </Field>
        <Field label="Cc">
          <input className={inputCls} value={cc} onChange={(x) => setCc(x.target.value)} />
        </Field>
        <Field label="Bcc">
          <input className={inputCls} value={bcc} onChange={(x) => setBcc(x.target.value)} />
        </Field>
      </div>
      <Field label="Subject">
        <HighlightTextarea singleLine className="text-sm" value={subject} onChange={setSubject} issues={live.issues.filter((i) => i.field === "subject")} />
      </Field>
      <Field label="Email">
        <HighlightTextarea className="min-h-72 text-[15px] leading-relaxed" value={body} onChange={setBody} issues={live.issues.filter((i) => i.field === "body")} />
      </Field>
      <ProofreadBar grammar={live.grammar} issues={live.issues} checking={live.checking} failed={live.failed} onAccept={accept} onDismiss={live.dismiss} onAcceptAll={acceptAll} />
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={attach} onChange={(x) => setAttach(x.target.checked)} />
          Attach resume {me.resume.hasPdf ? `(${resumeFilename(me.profile.fullName || me.name, me.resume.filename ?? "Resume.pdf")})` : "(no PDF uploaded yet)"}
        </label>
        <BodyStats body={body} />
      </div>
      <Field label="Send time" hint={`Leave empty to use the next slot allowed by your rules${e.proposedAt ? ` (currently ${fmtTime(e.proposedAt)})` : ""}.`}>
        <input type="datetime-local" className={inputCls + " max-w-xs"} value={when} onChange={(x) => setWhen(x.target.value)} />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          loading={busy === "regen"}
          onClick={() =>
            wrap("regen", async () => {
              await saveNotes();
              const r = await api<{ email: EmailCard }>(`/api/emails/${e.id}/regenerate`, { method: "POST" });
              setSubject(r.email.subject);
              setBody(r.email.body);
              toast("Rewritten with your notes", "good");
            })
          }
        >
          Rewrite with my notes
        </Button>
        <Button onClick={() => setOffering((o) => !o)}>🗓 Offer times</Button>
      </div>

      {offering && (
        <OfferTimes
          onClose={() => setOffering(false)}
          onInsert={(text) => {
            setOffering(false);
            setBody(insertBeforeSignoff(body, text));
          }}
        />
      )}

      <Field label={`Your notes about ${e.contact.name.split(" ")[0]}`} hint="Where you met, what you talked about. The rewrite uses these as “from my notes”, never as verified fact.">
        <textarea
          className={inputCls + " min-h-20"}
          value={notes}
          onChange={(x) => setNotes(x.target.value)}
          onBlur={() => void saveNotes()}
          placeholder="e.g. Met at the PJT info session; she moved from Park Hill to Strategic Advisory and said the analyst class is small so you get real responsibility early."
        />
      </Field>

      <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer text-sm font-medium">Why this email? (sources, verified facts, call questions)</summary>
        <div className="mt-2">
          <Rationale e={e} />
        </div>
      </details>

      <div className="grid grid-cols-3 gap-2 border-t border-line pt-4">
        <Button
          variant="danger"
          onClick={() =>
            wrap("delete", async () => {
              await api(`/api/emails/${e.id}`, { method: "DELETE" });
              toast("Deleted", "neutral");
              onDone();
            })
          }
        >
          Delete
        </Button>
        <Button
          onClick={() =>
            wrap("deck", async () => {
              await save();
              await api(`/api/emails/${e.id}`, { method: "PATCH", json: { status: "pending" } });
              toast("Back in the swipe deck", "neutral");
              onDone();
            })
          }
        >
          Back to deck
        </Button>
        <Button
          variant="good"
          loading={busy === "send"}
          onClick={() =>
            wrap("send", async () => {
              if (dirty) await save();
              await saveNotes();
              const r = await approve({ ...e, to: to.split(/[,;\s]+/).filter(Boolean) });
              if (r === "ok") onDone();
            })
          }
        >
          Send →
        </Button>
      </div>
    </Card>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
