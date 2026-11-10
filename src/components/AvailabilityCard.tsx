"use client";
import { useCallback, useEffect, useState } from "react";
import { DateTime } from "luxon";
import { api, type Availability, type Me } from "./api";
import { Badge, Button, Card, Field, cx, inputCls, toast } from "./ui";
import { byDay, timeLabel, type AvailabilityResp } from "./OfferTimes";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ZONES = [
  ["America/New_York", "Eastern (ET)"],
  ["America/Chicago", "Central (CT)"],
  ["America/Denver", "Mountain (MT)"],
  ["America/Los_Angeles", "Pacific (PT)"],
  ["Europe/London", "London"],
  ["Asia/Hong_Kong", "Hong Kong"],
] as const;

export function AvailabilityCard({ me, onChange }: { me: Me; onChange: (m: Me) => void }) {
  const [a, setA] = useState<Availability>(me.availability);
  const [data, setData] = useState<AvailabilityResp | null>(null);
  const [saving, setSaving] = useState(false);
  const [extra, setExtra] = useState({ date: "", start: "18:00", end: "19:00" });

  const load = useCallback(async () => {
    try {
      setData(await api<AvailabilityResp>("/api/availability"));
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<Availability>) => {
    const next = { ...a, ...patch };
    setA(next);
    setSaving(true);
    try {
      const r = await api<{ user: Me }>("/api/me", { method: "PATCH", json: { availability: patch } });
      onChange(r.user);
      await load();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setSaving(false);
    }
  };

  const toggleBlocked = (iso: string) => {
    const blocked = a.blocked.includes(iso) ? a.blocked.filter((b) => b !== iso) : [...a.blocked, iso];
    void save({ blocked });
  };

  return (
    <Card className="lg:col-span-2">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[26px] leading-tight">Availability</h2>
          <p className="mt-1 text-sm text-muted">
            Used by <span className="font-medium text-fg">🗓 Offer times</span> on every email. Busy time from all your Google calendars is removed
            automatically; click any slot below to switch it off or back on.
          </p>
        </div>
        {me.calendarConnected ? (
          <Badge tone="good">Google Calendar connected</Badge>
        ) : (
          <a href="/api/auth/login" className="rounded-full bg-fg px-4 py-2 text-sm font-medium text-bg hover:opacity-85">
            Connect Google Calendar
          </a>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3">
          <Field label="Days">
            <div className="flex flex-wrap gap-1.5">
              {DAY_NAMES.map((d, i) => {
                const n = i + 1;
                const on = a.days.includes(n);
                return (
                  <button
                    key={d}
                    onClick={() => save({ days: on ? a.days.filter((x) => x !== n) : [...a.days, n].sort() })}
                    className={cx("rounded-full border px-3 py-1 text-xs", on ? "border-transparent bg-fg text-bg" : "border-line text-muted hover:text-fg")}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <input type="time" className={inputCls} value={a.start} onChange={(e) => setA({ ...a, start: e.target.value })} onBlur={() => save({ start: a.start })} />
            </Field>
            <Field label="Until">
              <input type="time" className={inputCls} value={a.end} onChange={(e) => setA({ ...a, end: e.target.value })} onBlur={() => save({ end: a.end })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Call length">
              <select className={inputCls} value={a.meetingMinutes} onChange={(e) => save({ meetingMinutes: +e.target.value })}>
                {[15, 20, 30, 45, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Buffer around events">
              <select className={inputCls} value={a.bufferMinutes} onChange={(e) => save({ bufferMinutes: +e.target.value })}>
                {[0, 5, 10, 15, 30].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Earliest offer">
              <select className={inputCls} value={a.minNoticeHours} onChange={(e) => save({ minNoticeHours: +e.target.value })}>
                {[
                  [4, "4 hours out"],
                  [18, "Next day"],
                  [42, "2 days out"],
                  [66, "3 days out"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Time zone">
              <select className={inputCls} value={a.timezone} onChange={(e) => save({ timezone: e.target.value })}>
                {ZONES.map(([z, l]) => (
                  <option key={z} value={z}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Add a one-off window" hint="e.g. an evening you're free that's outside your usual hours">
            <div className="flex flex-wrap gap-2">
              <input type="date" className={inputCls + " w-auto"} value={extra.date} onChange={(e) => setExtra({ ...extra, date: e.target.value })} />
              <input type="time" className={inputCls + " w-auto"} value={extra.start} onChange={(e) => setExtra({ ...extra, start: e.target.value })} />
              <input type="time" className={inputCls + " w-auto"} value={extra.end} onChange={(e) => setExtra({ ...extra, end: e.target.value })} />
              <Button
                disabled={!extra.date}
                onClick={() => save({ extra: [...a.extra, { start: `${extra.date}T${extra.start}`, end: `${extra.date}T${extra.end}` }] })}
              >
                Add
              </Button>
            </div>
            {a.extra.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {a.extra.map((x, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs">
                    {DateTime.fromISO(x.start).toFormat("ccc LLL d, h:mm a")}–{DateTime.fromISO(x.end).toFormat("h:mm a")}
                    <button className="text-muted hover:text-bad" onClick={() => save({ extra: a.extra.filter((_, j) => j !== i) })}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </Field>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-muted">
            <span>Your open slots</span>
            {saving && <span>Saving…</span>}
          </div>
          {!data ? (
            <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">Loading…</p>
          ) : data.slots.length === 0 ? (
            <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">No open slots. Try wider hours or more days.</p>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto rounded-2xl bg-surface-2 p-3">
              {byDay(data.slots, data.timezone).map(([day, slots]) => (
                <div key={day} className="flex gap-3">
                  <div className="w-24 shrink-0 pt-1 text-xs font-medium text-muted">{DateTime.fromISO(day).toFormat("ccc, LLL d")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {slots.map((s) => (
                      <button
                        key={s.start}
                        onClick={() => toggleBlocked(s.start)}
                        title={s.blocked ? "Switched off — click to offer again" : "Click to stop offering this time"}
                        className={cx(
                          "rounded-full border px-2.5 py-1 text-xs tabular-nums transition",
                          s.blocked ? "border-dashed border-line text-muted line-through" : "border-line bg-surface hover:border-fg/30",
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
        </div>
      </div>
    </Card>
  );
}
