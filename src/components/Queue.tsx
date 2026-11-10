"use client";
import { useEffect, useState } from "react";
import { api, fmtTime, type EmailCard } from "./api";
import { Badge, Button, Card, toast } from "./ui";

export function Queue({ onChange }: { onChange: () => void }) {
  const [scheduled, setScheduled] = useState<EmailCard[] | null>(null);
  const [sent, setSent] = useState<EmailCard[]>([]);

  const load = async () => {
    const [a, b] = await Promise.all([
      api<{ emails: EmailCard[] }>("/api/emails?status=scheduled,sending"),
      api<{ emails: EmailCard[] }>("/api/emails?status=sent"),
    ]);
    setScheduled(a.emails.sort((x, y) => +new Date(x.scheduledAt ?? 0) - +new Date(y.scheduledAt ?? 0)));
    setSent(b.emails.sort((x, y) => +new Date(y.sentAt ?? 0) - +new Date(x.sentAt ?? 0)).slice(0, 30));
  };
  useEffect(() => {
    void load();
  }, []);

  if (scheduled === null) return <p className="text-center text-muted">Loading…</p>;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <h2 className="mb-1 font-display text-[26px] leading-tight">Scheduled ({scheduled.length})</h2>
        <p className="mb-3 text-xs text-muted">
          Sent automatically at these times by the background job. If the app is open, it also sends due emails every minute.
        </p>
        {scheduled.length === 0 && <p className="text-sm text-muted">Nothing scheduled.</p>}
        <ul className="divide-y divide-line">
          {scheduled.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {e.contact.name} <span className="font-normal text-muted">· {e.contact.bank}</span>
                </div>
                <div className="truncate text-xs text-muted">{e.subject}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums">{fmtTime(e.scheduledAt)}</span>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await api(`/api/emails/${e.id}`, { method: "PATCH", json: { status: "review" } });
                    toast("Unscheduled → review pile", "neutral");
                    void load();
                    onChange();
                  }}
                >
                  Unschedule
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="mb-3 font-display text-[26px] leading-tight">Recently sent</h2>
        {sent.length === 0 && <p className="text-sm text-muted">Nothing sent yet.</p>}
        <ul className="divide-y divide-line">
          {sent.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{e.contact.name}</div>
                <div className="truncate text-xs text-muted">{e.subject}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {e.repliedAt && <Badge tone="good">replied</Badge>}
                {e.deliveryStatus === "all_bounced" && <Badge tone="bad">bounced</Badge>}
                {e.deliveryStatus === "partial_bounce" && <Badge tone="warn">1+ bounced</Badge>}
                <span className="text-xs tabular-nums text-muted">{fmtTime(e.sentAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
