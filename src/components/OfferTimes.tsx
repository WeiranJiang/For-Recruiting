"use client";
import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { api } from "./api";
import { Button, cx } from "./ui";
import { formatOffer, type Slot } from "@/lib/availability";
import { typographize } from "@/lib/text-rules";

export type AvailabilityResp = {
  connected: boolean;
  calendarError: string | null;
  timezone: string;
  meetingMinutes: number;
  slots: Slot[];
  suggested: string[];
};

/** Groups slots by local day. */
export function byDay(slots: Slot[], tz: string) {
  const map = new Map<string, Slot[]>();
  for (const s of slots) {
    const k = DateTime.fromISO(s.start).setZone(tz).toISODate()!;
    map.set(k, [...(map.get(k) ?? []), s]);
  }
  return [...map.entries()];
}

export function timeLabel(iso: string, tz: string) {
  return DateTime.fromISO(iso).setZone(tz).toFormat("h:mm a").toLowerCase();
}

/**
 * "Offer times" picker: shows open slots from your calendar + weekly hours,
 * pre-selects a spread of options, and inserts a neat, correctly-dated list.
 */
export function OfferTimes({ onInsert, onClose, goSetup }: { onInsert: (text: string) => void; onClose: () => void; goSetup?: () => void }) {
  const [data, setData] = useState<AvailabilityResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    api<AvailabilityResp>("/api/availability")
      .then((d) => {
        setData(d);
        setPicked(d.suggested);
      })
      .catch((e) => setErr((e as Error).message));
  }, []);

  const open = useMemo(() => (data ? data.slots.filter((s) => !s.blocked) : []), [data]);
  const days = useMemo(() => (data ? byDay(open, data.timezone) : []), [data, open]);

  if (err) return <div className="rounded-2xl bg-peach p-4 text-sm text-bad">{err}</div>;
  if (!data) return <div className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">Loading…</div>;

  const toggle = (iso: string) => setPicked((p) => (p.includes(iso) ? p.filter((x) => x !== iso) : [...p, iso].sort()));
  const chosen = open.filter((s) => picked.includes(s.start));

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">Offer times</div>
          <div className="text-xs text-muted">
            {data.meetingMinutes}-minute slots ·{" "}
            {data.connected ? (data.calendarError ? `calendar error: ${data.calendarError}` : "synced with Google Calendar") : "calendar not connected"}
            {goSetup && (
              <>
                {" · "}
                <button className="underline underline-offset-2" onClick={goSetup}>
                  adjust availability
                </button>
              </>
            )}
          </div>
        </div>
        <button className="text-sm text-muted hover:text-fg" onClick={onClose}>
          ✕
        </button>
      </div>
      {days.length === 0 ? (
        <p className="text-sm text-muted">No open times</p>
      ) : (
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {days.map(([day, slots]) => (
            <div key={day} className="flex gap-3">
              <div className="w-24 shrink-0 pt-1 text-xs font-medium text-muted">{DateTime.fromISO(day).toFormat("ccc, LLL d")}</div>
              <div className="flex flex-wrap gap-1.5">
                {slots.map((s) => (
                  <button
                    key={s.start}
                    onClick={() => toggle(s.start)}
                    className={cx(
                      "rounded-full border px-2.5 py-1 text-xs tabular-nums transition",
                      picked.includes(s.start) ? "border-transparent bg-fg text-bg" : "border-line text-fg hover:bg-surface-2",
                    )}
                  >
                    {timeLabel(s.start, data.timezone)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {chosen.length > 0 && (
        <pre className="whitespace-pre-wrap rounded-xl bg-surface-2 p-3 font-sans text-xs leading-relaxed">{typographize(formatOffer(chosen, data.timezone))}</pre>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{chosen.length} selected</span>
        <Button variant="primary" disabled={!chosen.length} onClick={() => onInsert(typographize(formatOffer(chosen, data.timezone)))}>
          Insert into email
        </Button>
      </div>
    </div>
  );
}
