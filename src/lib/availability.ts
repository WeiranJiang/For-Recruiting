/**
 * Availability: weekly hours minus calendar busy time minus manual blocks → offerable slots.
 * Pure (no I/O) so it runs on the server and is easy to test. Ideas borrowed from apptrack's
 * scheduler: free/busy across all calendars, padded by a buffer, aligned to a fixed granularity.
 */
import { DateTime } from "luxon";

export type Availability = {
  timezone: string;
  days: number[]; // 1=Mon ... 7=Sun
  start: string; // "09:00"
  end: string; // "18:00"
  meetingMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  daysAhead: number;
  /** Slot starts (ISO) the user switched off by hand. */
  blocked: string[];
  /** Extra windows the user added by hand, outside weekly hours. */
  extra: { start: string; end: string }[];
};

export const DEFAULT_AVAILABILITY: Availability = {
  timezone: "America/New_York",
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "18:00",
  meetingMinutes: 20,
  bufferMinutes: 10,
  minNoticeHours: 18,
  daysAhead: 10,
  blocked: [],
  extra: [],
};

export function withAvailabilityDefaults(a: Partial<Availability> | null | undefined): Availability {
  return { ...DEFAULT_AVAILABILITY, ...(a ?? {}) };
}

export type Busy = { start: string; end: string };
export type Slot = { start: string; end: string; blocked: boolean };

const hm = (s: string) => {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return { hour: h || 0, minute: m || 0 };
};

/** Every slot in the horizon (blocked ones included, flagged) that doesn't collide with busy time. */
export function computeSlots(a: Availability, busy: Busy[], now = new Date()): Slot[] {
  const tz = a.timezone || "America/New_York";
  const len = Math.max(10, a.meetingMinutes);
  const step = len <= 20 ? 30 : len; // offer on clean :00 / :30 boundaries
  const buf = a.bufferMinutes * 60_000;
  const busyMs = busy.map((b) => ({ s: Date.parse(b.start) - buf, e: Date.parse(b.end) + buf }));
  const blocked = new Set(a.blocked.map((b) => new Date(b).toISOString()));
  const earliest = now.getTime() + a.minNoticeHours * 3_600_000;
  const out: Slot[] = [];
  const seen = new Set<string>();

  const pushRange = (from: DateTime, to: DateTime) => {
    for (let c = from; c.plus({ minutes: len }) <= to; c = c.plus({ minutes: step })) {
      const s = c.toMillis();
      const e = s + len * 60_000;
      if (s < earliest) continue;
      if (busyMs.some((b) => s < b.e && e > b.s)) continue;
      const iso = new Date(s).toISOString();
      if (seen.has(iso)) continue;
      seen.add(iso);
      out.push({ start: iso, end: new Date(e).toISOString(), blocked: blocked.has(iso) });
    }
  };

  let day = DateTime.fromJSDate(now).setZone(tz).startOf("day");
  for (let i = 0; i <= a.daysAhead; i++, day = day.plus({ days: 1 })) {
    if (!a.days.includes(day.weekday)) continue;
    const s = hm(a.start);
    const e = hm(a.end);
    pushRange(day.set({ hour: s.hour, minute: s.minute }), day.set({ hour: e.hour, minute: e.minute }));
  }
  for (const x of a.extra) {
    pushRange(DateTime.fromISO(x.start, { zone: tz }), DateTime.fromISO(x.end, { zone: tz }));
  }
  return out.sort((p, q) => p.start.localeCompare(q.start));
}

/** Suggests a spread of options: the first open slot on each of the next few distinct days. */
export function suggestSlots(slots: Slot[], tz: string, count = 3): string[] {
  const picks: string[] = [];
  const days = new Set<string>();
  for (const s of slots) {
    if (s.blocked) continue;
    const d = DateTime.fromISO(s.start).setZone(tz);
    const key = d.toISODate()!;
    if (days.has(key)) continue;
    // prefer late-morning / afternoon times over the very first minute of the day
    const sameDay = slots.filter((x) => !x.blocked && DateTime.fromISO(x.start).setZone(tz).toISODate() === key);
    const nice = sameDay.find((x) => {
      const h = DateTime.fromISO(x.start).setZone(tz).hour;
      return h >= 10 && h <= 16;
    });
    picks.push((nice ?? s).start);
    days.add(key);
    if (picks.length >= count) break;
  }
  return picks;
}

const TZ_ABBR: Record<string, string> = {
  "America/New_York": "ET",
  "America/Detroit": "ET",
  "America/Toronto": "ET",
  "America/Chicago": "CT",
  "America/Denver": "MT",
  "America/Phoenix": "MT",
  "America/Los_Angeles": "PT",
  "Europe/London": "UK time",
};

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function clock(d: DateTime, withMeridiem: boolean) {
  const h = d.hour % 12 || 12;
  const m = d.minute ? `:${String(d.minute).padStart(2, "0")}` : ":00";
  return `${h}${m}${withMeridiem ? (d.hour < 12 ? " am" : " pm") : ""}`;
}

/** "Tuesday, November 17th, from 10:00 to 10:20 am ET" (en dash style is applied by the caller's typography). */
export function formatSlot(startIso: string, endIso: string, tz: string): string {
  const s = DateTime.fromISO(startIso).setZone(tz);
  const e = DateTime.fromISO(endIso).setZone(tz);
  const sameHalf = (s.hour < 12) === (e.hour < 12);
  const abbr = TZ_ABBR[tz] ?? s.toFormat("ZZZZ");
  return `${s.toFormat("cccc, LLLL")} ${ordinal(s.day)}, from ${clock(s, !sameHalf)} to ${clock(e, true)} ${abbr}`;
}

/** The block that gets inserted into an email. */
export function formatOffer(slots: { start: string; end: string }[], tz: string): string {
  if (!slots.length) return "";
  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start));
  const lines = sorted.map((s) => `• ${formatSlot(s.start, s.end, tz)}`);
  return `Would any of these times work for a quick call?\n${lines.join("\n")}\nI'm happy to work around your schedule if none of these are convenient.`;
}

/** Inserts text as its own paragraph just before the sign-off ("Best," / "All the best," / "Thanks,"...). */
export function insertBeforeSignoff(body: string, block: string): string {
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => /^(best|all the best|best regards|kind regards|thanks|thank you|sincerely|warmly|regards|cheers)[,!]?\s*$/i.test(l.trim()));
  if (idx < 0) return `${body.replace(/\s+$/, "")}\n\n${block}`;
  const before = lines.slice(0, idx).join("\n").replace(/\s+$/, "");
  const after = lines.slice(idx).join("\n");
  return `${before}\n\n${block}\n\n${after}`;
}
