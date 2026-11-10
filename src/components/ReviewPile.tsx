"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type EmailCard, type Me } from "./api";
import { ComposeWindow } from "./ComposeWindow";
import { Badge, Card, cx, toast } from "./ui";

export function ReviewPile({ me, onChange, goSetup }: { me: Me; onChange: () => void; goSetup?: () => void }) {
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
      <Card className="mx-auto max-w-md text-center">
        <p className="font-display text-3xl">Nothing to fix</p>
      </Card>
    );
  const current = list.find((e) => e.id === sel) ?? list[0];
  const done = () => {
    void load();
    onChange();
  };

  return (
    <div className="grid gap-4 md:grid-cols-[240px_1fr]">
      <div className="space-y-1">
        {list.map((e) => (
          <button
            key={e.id}
            onClick={() => setSel(e.id)}
            className={cx(
              "w-full rounded-xl px-3.5 py-2.5 text-left text-sm transition",
              e.id === current.id ? "bg-surface shadow-soft" : "hover:bg-surface-2",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{e.contact.name}</span>
              {e.status === "failed" ? <Badge tone="bad">not sent</Badge> : e.kind === "follow_up" ? <Badge>follow-up</Badge> : null}
            </div>
            <div className="truncate text-xs text-muted">{e.subject || e.contact.bank}</div>
          </button>
        ))}
      </div>
      <ComposeWindow
        key={current.id}
        e={current}
        me={me}
        goSetup={goSetup}
        onSent={done}
        onDeleted={done}
        laterLabel="Back to swipe deck"
        onLater={async () => {
          await api(`/api/emails/${current.id}`, { method: "PATCH", json: { status: "pending" } });
          toast("Back in the deck", "neutral");
          done();
        }}
      />
    </div>
  );
}
