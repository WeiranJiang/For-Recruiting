"use client";
import { useState } from "react";
import { ApiError, api, fmtTime, safeHref, wordCount, type EmailCard } from "./api";
import { findDateIssues, findPlaceholders } from "@/lib/text-rules";
import { Badge, Pct, cx, toast } from "./ui";

export function Recipients({ e }: { e: Pick<EmailCard, "to" | "cc" | "bcc"> }) {
  const row = (label: string, list: string[]) =>
    list.length > 0 && (
      <div className="flex gap-2">
        <span className="w-9 shrink-0 text-muted">{label}</span>
        <span className="min-w-0 break-all">{list.join(", ")}</span>
      </div>
    );
  return (
    <div className="space-y-0.5 text-sm">
      {row("To", e.to.length ? e.to : ["(missing!)"])}
      {row("Cc", e.cc)}
      {row("Bcc", e.bcc)}
    </div>
  );
}

export function AccuracyRow({ e }: { e: EmailCard }) {
  const c = e.contact;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pct value={c.accuracy} label="Overall accuracy" />
      <Pct value={c.emailConfidence} label="Email" />
      <Pct value={c.infoConfidence} label="Info" />
      <Badge>{c.emailSource === "ai" ? "AI-found email" : c.emailSource === "manual" ? "you entered" : c.emailSource}</Badge>
    </div>
  );
}

export function Warnings({ e }: { e: EmailCard }) {
  const w: { tone: "bad" | "warn"; text: string }[] = [];
  for (const d of e.duplicates)
    w.push({ tone: "bad", text: `Already emailed ${d.address} (${d.status}${d.when ? `, ${fmtTime(d.when)}` : ""}): “${d.subject}”` });
  if (e.contact.emailConfidence < 50) w.push({ tone: "warn", text: `Email may be wrong (${e.contact.emailConfidence}%)` });
  for (const m of e.rationale?.missingInfo ?? []) w.push({ tone: "warn", text: `Missing: ${m}` });
  const ph = findPlaceholders(`${e.subject}\n${e.body}`);
  if (ph.length) w.push({ tone: "bad", text: `Fill in ${ph.join(", ")} before sending` });
  for (const d of findDateIssues(e.body)) w.push({ tone: "bad", text: `Date check: ${d.message}.` });
  // Prompt-injection / accidental-link guard: drafts rarely need links, so surface any.
  const links = [...new Set(e.body.match(/https?:\/\/[^\s)>\]]+|www\.[^\s)>\]]+/gi) ?? [])];
  if (links.length) w.push({ tone: "warn", text: `Contains a link: ${links.slice(0, 2).join(", ")}. Make sure you meant to include it.` });
  if (e.error) w.push({ tone: "bad", text: e.error });
  if (!w.length) return null;
  return (
    <div className="space-y-1">
      {w.map((x, i) => (
        <div key={i} className={cx("rounded-xl px-3 py-2 text-xs", x.tone === "bad" ? "bg-peach text-bad" : "bg-butter text-warn")}>
          {x.text}
        </div>
      ))}
    </div>
  );
}

export function Rationale({ e }: { e: EmailCard }) {
  const r = e.rationale;
  const c = e.contact;
  return (
    <div className="space-y-2 text-sm">
      {r?.roleAndGroup && (
        <div>
          <span className="text-muted">Role: </span>
          {r.roleAndGroup}
        </div>
      )}
      {r?.whyContact && (
        <div>
          <span className="text-muted">Why them: </span>
          {r.whyContact}
        </div>
      )}
      {r?.personalizationAngle && (
        <div>
          <span className="text-muted">Angle used: </span>
          {r.personalizationAngle}
        </div>
      )}
      {!!r?.verifiedFacts.length && (
        <div>
          <div className="text-[13px] font-medium text-muted">Verified (from sources)</div>
          <ul className="ml-4 list-disc">{r.verifiedFacts.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
      )}
      {!!r?.fromMyNotes.length && (
        <div>
          <div className="text-[13px] font-medium text-muted">From your notes</div>
          <ul className="ml-4 list-disc">{r.fromMyNotes.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
      )}
      {!!c.matchReasons.length && (
        <div>
          <div className="text-[13px] font-medium text-muted">Matched your targeting because</div>
          <ul className="ml-4 list-disc">{c.matchReasons.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
      )}
      {!!r?.followUpQuestions.length && (
        <div>
          <div className="text-[13px] font-medium text-muted">Questions for the 15-min call</div>
          <ul className="ml-4 list-disc">{r.followUpQuestions.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
      )}
      {!!c.sources.length && (
        <div className="flex flex-wrap gap-x-3 text-xs">
          <span className="text-muted">Sources:</span>
          {c.sources.slice(0, 6).map((s, i) => (
            <a key={i} href={safeHref(s.url)} target="_blank" rel="noopener noreferrer" className="max-w-56 truncate text-accent underline">
              {s.title || s.url}
            </a>
          ))}
        </div>
      )}
      {c.linkedinUrl && (
        <a href={safeHref(c.linkedinUrl)} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline">
          LinkedIn
        </a>
      )}
    </div>
  );
}

/**
 * Swipe-right action. Handles the duplicate guard (asks before forcing) and other validation failures.
 * Returns "ok" | "blocked" (caller may move it to review) | "cancel".
 */
export async function approve(e: EmailCard): Promise<"ok" | "blocked" | "cancel"> {
  const go = async (force: boolean) => api<{ ok: boolean; scheduledAt: string }>(`/api/emails/${e.id}/approve`, { method: "POST", json: { force } });
  try {
    const r = await go(false);
    const soon = new Date(r.scheduledAt).getTime() < Date.now() + 120_000;
    toast(soon ? `Sending to ${e.contact.name} now` : `Scheduled for ${fmtTime(r.scheduledAt)}`, "good");
    return "ok";
  } catch (err) {
    if (err instanceof ApiError && (err.data as { reason?: string }).reason === "duplicate") {
      const d = (err.data as { duplicates: { address: string; subject: string }[] }).duplicates[0];
      const yes = window.confirm(
        `You've already emailed ${d.address} (“${d.subject}”).\n\nThe app blocks sending the same person a new first email. Send anyway?`,
      );
      if (!yes) return "cancel";
      try {
        const r = await go(true);
        toast(`Scheduled for ${fmtTime(r.scheduledAt)}`, "good");
        return "ok";
      } catch (e2) {
        toast((e2 as Error).message, "bad");
        return "blocked";
      }
    }
    toast((err as Error).message, "bad");
    return "blocked";
  }
}

export function BodyStats({ body }: { body: string }) {
  const n = wordCount(body);
  return (
    <span className={cx("text-xs tabular-nums", n > 170 ? "text-warn" : "text-muted")}>
      {n} words · ~{Math.max(1, Math.round(n / 200 * 60))}s read
    </span>
  );
}

export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const wrap = async <T,>(key: string, fn: () => Promise<T>) => {
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };
  return { busy, wrap };
}
