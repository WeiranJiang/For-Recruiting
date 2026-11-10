"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { api, fmtDate, fmtTime, type Me, type SheetRow } from "./api";
import { Badge, Button, Card, Field, Pct, StatusBadge, cx, inputCls, toast } from "./ui";

type Bank = { bank: string; contacts: number; sent: number; replied: number; bounced: number; scheduled: number };
type View = "all" | "followup" | "flagged" | "replied" | "new";
type SortKey = "name" | "bank" | "status" | "lastSentAt" | "accuracy" | "followUpOverdueDays";

const VIEWS: { id: View; label: string }[] = [
  { id: "all", label: "All" },
  { id: "followup", label: "Follow up now" },
  { id: "flagged", label: "Bounced / not sent" },
  { id: "replied", label: "Replied" },
  { id: "new", label: "Not contacted" },
];

export function Tracker({ me, onChange, goSwipe }: { me: Me; onChange: () => void; goSwipe: () => void }) {
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [bank, setBank] = useState("");
  const [status, setStatus] = useState("");
  const [minAcc, setMinAcc] = useState(0);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "lastSentAt", dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await api<{ rows: SheetRow[]; banks: Bank[] }>("/api/contacts");
    setRows(r.rows);
    setBanks(r.banks);
  };
  useEffect(() => {
    void load();
  }, []);

  const counts = useMemo(() => {
    const r = rows ?? [];
    return {
      all: r.length,
      followup: r.filter((x) => x.followUpDue).length,
      flagged: r.filter((x) => x.flagged).length,
      replied: r.filter((x) => x.status === "Replied").length,
      new: r.filter((x) => x.status === "Not contacted").length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    let r = rows ?? [];
    if (view === "followup") r = r.filter((x) => x.followUpDue);
    if (view === "flagged") r = r.filter((x) => x.flagged);
    if (view === "replied") r = r.filter((x) => x.status === "Replied");
    if (view === "new") r = r.filter((x) => x.status === "Not contacted");
    if (bank) r = r.filter((x) => x.bank === bank);
    if (status) r = r.filter((x) => x.status === status);
    if (minAcc) r = r.filter((x) => x.accuracy >= minAcc);
    if (q.trim()) {
      const t = q.toLowerCase();
      r = r.filter((x) => [x.name, x.email, x.bank, x.group, x.title, x.school].join(" ").toLowerCase().includes(t));
    }
    const k = view === "followup" && sort.k === "lastSentAt" ? "followUpOverdueDays" : sort.k;
    return [...r].sort((a, b) => {
      const av = a[k] ?? "";
      const bv = b[k] ?? "";
      return (av > bv ? 1 : av < bv ? -1 : 0) * (view === "followup" && k === "followUpOverdueDays" ? -1 : sort.dir);
    });
  }, [rows, view, bank, status, minAcc, q, sort]);

  const draft = async (kind: "initial" | "follow_up") => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await api<{ drafted: number; errors: string[] }>("/api/drafts", { method: "POST", json: { contactIds: ids.slice(0, 25), kind } });
      if (r.errors.length) toast(r.errors.join(" · "), "bad");
      if (r.drafted) {
        toast(`${r.drafted} draft${r.drafted > 1 ? "s" : ""} added to the swipe deck`, "good");
        setSelected(new Set());
        onChange();
        goSwipe();
      }
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  if (rows === null) return <p className="text-center text-muted">Loading…</p>;

  const th = (k: SortKey, label: string, cls = "") => (
    <th className={cx("cursor-pointer whitespace-nowrap px-2 py-2 text-left font-semibold", cls)} onClick={() => setSort((s) => ({ k, dir: s.k === k ? (-s.dir as 1 | -1) : 1 }))}>
      {label}
      {sort.k === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface-2 p-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={cx(
              "rounded-full px-4 py-1.5 text-sm font-medium transition",
              view === v.id ? "bg-surface text-fg shadow-soft" : "text-muted hover:text-fg",
              v.id === "flagged" && counts.flagged > 0 && view !== v.id && "text-bad",
              v.id === "followup" && counts.followup > 0 && view !== v.id && "text-accent",
            )}
          >
            {v.label} <span className="opacity-70">{counts[v.id]}</span>
          </button>
        ))}
        </div>
        <a href="/api/export" className="ml-auto rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-medium hover:bg-surface-2">
          Export CSV
        </a>
      </div>

      {view === "followup" && (
        <p className="text-sm text-muted">
          People you emailed at least {me.rules.followUpAfterBusinessDays} business days ago with no reply or bounce, and fewer than {me.rules.maxFollowUps}{" "}
          follow-ups. Most overdue first. Select them and click “Draft follow-ups”.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <input className={inputCls + " max-w-xs"} placeholder="Search name, bank, group, school…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={inputCls + " max-w-48"} value={bank} onChange={(e) => setBank(e.target.value)}>
          <option value="">All banks</option>
          {[...new Set(rows.map((r) => r.bank))].sort().map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select className={inputCls + " max-w-40"} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {["Not contacted", "Draft", "Scheduled", "Sent", "Replied", "Bounced", "Not sent"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select className={inputCls + " max-w-44"} value={minAcc} onChange={(e) => setMinAcc(+e.target.value)}>
          <option value={0}>Any accuracy</option>
          <option value={50}>Accuracy ≥ 50%</option>
          <option value={75}>Accuracy ≥ 75%</option>
          <option value={90}>Accuracy ≥ 90%</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-lilac p-2.5 pl-4 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button variant="primary" loading={busy} onClick={() => draft("follow_up")}>
            Draft follow-ups
          </Button>
          <Button loading={busy} onClick={() => draft("initial")}>
            Draft first emails
          </Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-3xl border border-line/70 bg-surface shadow-soft">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              <th className="w-8 px-2">
                <input
                  type="checkbox"
                  checked={shown.length > 0 && shown.every((r) => selected.has(r.id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())}
                />
              </th>
              {th("name", "Name")}
              <th className="px-2 py-2 text-left font-semibold">Email</th>
              {th("bank", "Bank")}
              {th("status", "Status")}
              <th className="whitespace-nowrap px-2 py-2 text-left font-semibold">First sent</th>
              {th("lastSentAt", "Last sent")}
              <th className="px-2 py-2 text-left font-semibold">Replied</th>
              <th className="px-2 py-2 text-left font-semibold">F/U</th>
              {th("accuracy", "Accuracy")}
              <th className="px-2 py-2 text-left font-semibold">Flag</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={11} className="p-6 text-center text-muted">
                  Nothing here.
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <Fragment key={r.id}>
                <tr
                  className={cx("cursor-pointer border-b border-line hover:bg-surface-2", r.flagged && "bg-peach/50", open === r.id && "bg-surface-2")}
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                >
                  <td className="px-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={(e) => {
                        const s = new Set(selected);
                        if (e.target.checked) s.add(r.id);
                        else s.delete(r.id);
                        setSelected(s);
                      }}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted">{[r.title, r.group].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="max-w-52 truncate px-2 py-2">{r.email || <span className="text-warn">missing</span>}</td>
                  <td className="px-2 py-2">{r.bank}</td>
                  <td className="px-2 py-2">
                    <StatusBadge status={r.status} />
                    {r.followUpDue && (
                      <div className="mt-0.5">
                        <Badge tone="accent">follow up{r.followUpOverdueDays ? ` +${r.followUpOverdueDays}d` : ""}</Badge>
                      </div>
                    )}
                    {r.status === "Scheduled" && <div className="text-xs text-muted">{fmtTime(r.scheduledAt)}</div>}
                    {r.autoReplyAt && r.status !== "Replied" && (
                      <div className="mt-0.5" title={r.autoReplySnippet ?? ""}>
                        <Badge>out of office</Badge>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{fmtDate(r.firstSentAt)}</td>
                  <td className="px-2 py-2 tabular-nums">{fmtDate(r.lastSentAt)}</td>
                  <td className="px-2 py-2 tabular-nums">{r.repliedAt ? fmtDate(r.repliedAt) : "—"}</td>
                  <td className="px-2 py-2 tabular-nums">{r.followUpsSent}</td>
                  <td className="px-2 py-2">
                    <Pct value={r.accuracy} />
                  </td>
                  <td className="max-w-48 px-2 py-2 text-xs text-bad">{r.flagReason ?? ""}</td>
                </tr>
                {open === r.id && (
                  <tr className="border-b border-line bg-surface-2/50">
                    <td colSpan={11} className="p-4">
                      <ContactDetail row={r} onSaved={() => { void load(); onChange(); }} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {banks.length > 0 && (
        <Card>
          <h3 className="mb-3 font-display text-2xl">By bank</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 text-left">Bank</th>
                  <th className="text-right">People</th>
                  <th className="text-right">Emailed</th>
                  <th className="text-right">Scheduled</th>
                  <th className="text-right">Replied</th>
                  <th className="text-right">Reply rate</th>
                  <th className="text-right">Flagged</th>
                </tr>
              </thead>
              <tbody>
                {banks.map((b) => (
                  <tr key={b.bank} className="border-t border-line">
                    <td className="py-1.5">
                      <button className="hover:underline" onClick={() => setBank(b.bank)}>
                        {b.bank}
                      </button>
                    </td>
                    <td className="text-right tabular-nums">{b.contacts}</td>
                    <td className="text-right tabular-nums">{b.sent}</td>
                    <td className="text-right tabular-nums">{b.scheduled}</td>
                    <td className="text-right tabular-nums">{b.replied}</td>
                    <td className="text-right tabular-nums">{b.sent ? Math.round((b.replied / b.sent) * 100) + "%" : "—"}</td>
                    <td className="text-right tabular-nums">{b.bounced}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ContactDetail({ row, onSaved }: { row: SheetRow; onSaved: () => void }) {
  const [email, setEmail] = useState(row.email);
  const [myNotes, setMyNotes] = useState(row.myNotes);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/contacts/${row.id}`, { method: "PATCH", json: { email, myNotes } });
      toast("Saved", "good");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <Pct value={row.emailConfidence} label="Email" />
          <Pct value={row.infoConfidence} label="Info" />
          <Badge>{row.emailSource}</Badge>
        </div>
        {row.autoReplySnippet && row.status !== "Replied" && (
          <div className="rounded-2xl bg-surface-2 p-3">
            <div className="text-xs font-semibold text-muted">Auto-reply (not counted as a reply)</div>
            {row.autoReplySnippet}
          </div>
        )}
        {row.replySnippet && (
          <div className="rounded-2xl bg-sage p-3">
            <div className="text-xs font-semibold text-good">Their reply</div>
            {row.replySnippet}
          </div>
        )}
        {row.matchReasons.length > 0 && (
          <div>
            <div className="text-[13px] font-medium text-muted">Why they match</div>
            <ul className="ml-4 list-disc">{row.matchReasons.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        )}
        {row.notes && <p className="whitespace-pre-wrap text-muted">{row.notes}</p>}
        <div className="flex flex-wrap gap-x-3 text-xs">
          {row.linkedinUrl && (
            <a className="text-accent underline" href={row.linkedinUrl} target="_blank" rel="noreferrer">
              LinkedIn
            </a>
          )}
          {row.sources.slice(0, 5).map((s, i) => (
            <a key={i} className="max-w-48 truncate text-accent underline" href={s.url} target="_blank" rel="noreferrer">
              {s.title || s.url}
            </a>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Field label="Email address" hint="Editing it sets the source to “you entered” and updates any unsent drafts.">
          <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="My notes (where we met, what we discussed)">
          <textarea className={inputCls + " min-h-20"} value={myNotes} onChange={(e) => setMyNotes(e.target.value)} />
        </Field>
        <div className="flex justify-between">
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm(`Remove ${row.name}? Unsent drafts are deleted; send history is kept so they're never emailed twice.`)) return;
              await api(`/api/contacts/${row.id}`, { method: "DELETE" });
              onSaved();
            }}
          >
            Remove
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
