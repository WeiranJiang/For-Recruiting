"use client";
import { useState } from "react";
import { api, type Me } from "./api";
import { Button, Card, Field, cx, inputCls, toast } from "./ui";

type Result = {
  found: number;
  created: number;
  drafted: number;
  skipped: { name: string; reason: string }[];
  errors: string[];
  noEmail: string[];
};

export function FindPeople({ me, onDone, goSetup }: { me: Me; onDone: () => void; goSetup: () => void }) {
  const [mode, setMode] = useState<"search" | "import">("search");
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(5);
  const [provider, setProvider] = useState<"ai" | "hunter" | "apollo">("ai");
  const [text, setText] = useState("");
  const [enrich, setEnrich] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r =
        mode === "search"
          ? await api<Result>("/api/research", { method: "POST", json: { query, count, provider, draft: true } })
          : await api<Result>("/api/import", { method: "POST", json: { text, enrich, provider, draft: true } });
      setResult(r);
      toast(`Added ${r.created} people · ${r.drafted} drafts ready to swipe`, "good");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const providerPicker = (
    <Field label="Find emails with">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["ai", "AI web search + bank email pattern", true],
            ["hunter", "Hunter.io (verified)", me.providers.hunter],
            ["apollo", "Apollo.io (verified)", me.providers.apollo],
          ] as const
        ).map(([id, label, ok]) => (
          <button
            key={id}
            disabled={!ok}
            onClick={() => setProvider(id)}
            title={ok ? "" : "Add an API key in Setup first"}
            className={cx(
              "rounded-full border px-3.5 py-1.5 text-sm transition disabled:opacity-40",
              provider === id ? "border-transparent bg-fg text-bg" : "border-line text-muted hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </Field>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="text-center">
        <h2 className="font-display text-4xl">Who should you meet?</h2>
        <p className="mt-2 text-sm text-muted">Search the web with your targeting, or paste a list you already have.</p>
      </div>
      <div className="mx-auto flex w-fit gap-1 rounded-full bg-surface-2 p-1">
        {(
          [
            ["search", "Search the web"],
            ["import", "Paste / import a list"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={cx("rounded-full px-4 py-1.5 text-sm font-medium transition", mode === id ? "bg-surface text-fg shadow-soft" : "text-muted hover:text-fg")}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "search" ? (
        <Card className="space-y-4">
          <div className="rounded-2xl bg-sky p-4 text-sm">
            <div className="mb-1 text-[13px] font-medium text-muted">Your standing targeting</div>
            {me.profile.targeting ? (
              <p>{me.profile.targeting}</p>
            ) : (
              <p className="text-muted">
                Not set yet.{" "}
                <button className="text-accent underline" onClick={goSetup}>
                  Describe who you want to reach
                </button>{" "}
                (schools, past internships, groups, affinity networks).
              </p>
            )}
          </div>
          <Field label="This search (optional, narrows the targeting)">
            <input
              className={inputCls}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. PJT Partners analysts in Strategic Advisory who went to Penn"
            />
          </Field>
          <Field label={`How many people: ${count}`}>
            <input type="range" min={1} max={15} value={count} onChange={(e) => setCount(+e.target.value)} className="w-full accent-[var(--accent)]" />
          </Field>
          {providerPicker}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Takes 1–3 minutes. Each person gets an email-accuracy % and an info-accuracy %, with sources.</p>
            <Button variant="primary" onClick={run} loading={busy} disabled={!query.trim() && !me.profile.targeting.trim()}>
              {busy ? "Searching…" : "Find people & draft emails"}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="space-y-4">
          <Field label="Paste people" hint="CSV, spreadsheet rows, LinkedIn copy-paste, or notes. One person per line works best. Add your notes from conversations too.">
            <textarea
              className={inputCls + " min-h-48 font-mono text-xs"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Jane Doe, Analyst, PJT Partners, Strategic Advisory, jane.doe@pjtpartners.com\nJohn Smith — Associate at Evercore TMT (met at the Penn info session, talked about his move from Deloitte)"}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} />
            Look each person up on the web to verify role/bank and fill in missing emails (up to 15 people)
          </label>
          {providerPicker}
          <div className="flex justify-end">
            <Button variant="primary" onClick={run} loading={busy} disabled={!text.trim()}>
              {busy ? "Working…" : "Import & draft emails"}
            </Button>
          </div>
        </Card>
      )}

      {result && (
        <Card className="space-y-2 text-sm">
          <div className="font-semibold">
            Found {result.found} · added {result.created} · {result.drafted} drafts ready
          </div>
          {result.noEmail.length > 0 && (
            <p className="text-warn">No email found for: {result.noEmail.join(", ")}. Add one in the Tracker sheet, then draft.</p>
          )}
          {result.skipped.length > 0 && (
            <p className="text-muted">Skipped (already in your sheet): {result.skipped.map((s) => s.name).join(", ")}</p>
          )}
          {result.errors.length > 0 && <p className="text-bad">{result.errors.join(" · ")}</p>}
          {result.drafted > 0 && (
            <Button variant="primary" onClick={onDone}>
              Start swiping →
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}
