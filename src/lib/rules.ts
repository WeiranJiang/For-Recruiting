import { DateTime } from "luxon";
import { z } from "zod";

export const RulesSchema = z.object({
  timezone: z.string().describe("IANA timezone used for all send windows, e.g. America/New_York"),
  sendDays: z.array(z.number().int()).describe("Allowed weekdays, 1=Monday ... 7=Sunday"),
  windows: z
    .array(z.object({ start: z.string().describe("HH:mm 24h"), end: z.string().describe("HH:mm 24h") }))
    .describe("Time-of-day windows in which emails may go out"),
  minMinutesBetweenAnyEmails: z.number().int().describe("Minimum minutes between any two sends"),
  minHoursBetweenSameBank: z.number().describe("Minimum hours between two emails to people at the same bank"),
  maxPerBankPerDay: z.number().int(),
  maxPerBankPerWeek: z.number().int(),
  maxPerDay: z.number().int().describe("Max emails sent per day in total"),
  jitterMinutes: z.number().int().describe("Random offset added to each slot so sends don't look automated"),
  followUpAfterBusinessDays: z.number().int(),
  maxFollowUps: z.number().int(),
  defaultCc: z.array(z.string()),
  defaultBcc: z.array(z.string()),
  subjectTemplate: z
    .string()
    .describe("Subject template. Placeholders: {school} {bank} {group} {firstName} {myName} {year}"),
  emailFormat: z.string().describe("Free-text guidance for structure/tone/length of drafts"),
  maxWords: z.number().int(),
  attachResumeByDefault: z.boolean(),
});

export type Rules = z.infer<typeof RulesSchema>;

export const DEFAULT_RULES: Rules = {
  timezone: "America/New_York",
  sendDays: [1, 2, 3, 4],
  windows: [{ start: "07:00", end: "08:45" }],
  minMinutesBetweenAnyEmails: 4,
  minHoursBetweenSameBank: 24,
  maxPerBankPerDay: 1,
  maxPerBankPerWeek: 4,
  maxPerDay: 15,
  jitterMinutes: 6,
  followUpAfterBusinessDays: 5,
  maxFollowUps: 2,
  defaultCc: [],
  defaultBcc: [],
  subjectTemplate: "{school} Student – {bank}",
  emailFormat: "Follow the writing guide: Hi [First Name], short paragraphs, one clear 15-minute ask, 'Best,' sign-off.",
  maxWords: 160,
  attachResumeByDefault: true,
};

export function withDefaults(r: Partial<Rules> | null | undefined): Rules {
  return { ...DEFAULT_RULES, ...(r ?? {}) };
}

// ---------- bank normalisation ----------
const ALIASES: Record<string, string> = {
  gs: "goldman sachs",
  goldman: "goldman sachs",
  ms: "morgan stanley",
  jpm: "jpmorgan",
  "jp morgan": "jpmorgan",
  "j p morgan": "jpmorgan",
  "jpmorgan chase": "jpmorgan",
  "jp morgan chase": "jpmorgan",
  bofa: "bank of america",
  baml: "bank of america",
  "bank of america merrill lynch": "bank of america",
  "bofa securities": "bank of america",
  "bank of america securities": "bank of america",
  citigroup: "citi",
  citibank: "citi",
  pwp: "perella weinberg",
  "perella weinberg partners": "perella weinberg",
  cvp: "centerview",
  "centerview partners": "centerview",
  pjt: "pjt partners",
  "evercore isi": "evercore",
  "moelis company": "moelis",
  "lazard freres": "lazard",
  "guggenheim securities": "guggenheim",
  "guggenheim partners": "guggenheim",
  "wells fargo securities": "wells fargo",
  "rbc capital markets": "rbc",
  "barclays capital": "barclays",
  "deutsche bank securities": "deutsche bank",
  db: "deutsche bank",
  "ubs investment bank": "ubs",
  "houlihan lokey": "houlihan lokey",
  hl: "houlihan lokey",
  "william blair company": "william blair",
  "jefferies llc": "jefferies",
};

export function normalizeBank(b: string): string {
  let s = (b || "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[.,'’()]/g, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(inc|llc|lp|llp|plc|co|company|group|the|ltd|limited|holdings|corp|corporation)\b/g, " ")
    // regional qualifiers shouldn't split one bank into two (idea from apptrack's company_key)
    .replace(/\b(usa|uk|emea|apac|americas|europe|asia|international|global|india|canada|new york|london|hong kong)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = ALIASES[s] ?? s;
  return s;
}

// ---------- scheduler ----------
export type Booked = { at: Date; bank: string };

function parseHM(s: string) {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return { hour: h || 0, minute: m || 0 };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

/**
 * Finds the earliest send time that satisfies all rules, given emails already
 * booked (scheduled or sent). Returns null if nothing fits in the next 90 days.
 */
export function nextSlot(params: {
  rules: Rules;
  bank: string;
  booked: Booked[];
  now?: Date;
  seed?: string;
  notBefore?: Date;
}): Date | null {
  const { rules, booked } = params;
  const tz = rules.timezone || "America/New_York";
  const bank = normalizeBank(params.bank);
  const now = params.now ?? new Date();
  const start = new Date(Math.max(now.getTime() + 60_000, params.notBefore?.getTime() ?? 0));
  const windows = (rules.windows.length ? rules.windows : [{ start: "00:00", end: "23:59" }]).map((w) => ({
    s: parseHM(w.start),
    e: parseHM(w.end),
  }));
  const days = rules.sendDays.length ? rules.sendDays : [1, 2, 3, 4, 5, 6, 7];
  const jitterMax = Math.max(0, rules.jitterMinutes);
  const jitter = jitterMax ? hash(params.seed ?? String(now.getTime())) % (jitterMax + 1) : 0;
  const bookedNorm = booked.map((b) => ({ t: b.at.getTime(), bank: normalizeBank(b.bank), dt: DateTime.fromJSDate(b.at).setZone(tz) }));

  let day = DateTime.fromJSDate(start).setZone(tz).startOf("day");
  for (let d = 0; d < 90; d++, day = day.plus({ days: 1 })) {
    if (!days.includes(day.weekday)) continue;
    const sameDay = bookedNorm.filter((b) => b.dt.hasSame(day, "day"));
    if (sameDay.length >= rules.maxPerDay) continue;
    if (bank && sameDay.filter((b) => b.bank === bank).length >= rules.maxPerBankPerDay) continue;
    if (bank) {
      const weekStart = day.startOf("week");
      const inWeek = bookedNorm.filter((b) => b.bank === bank && b.dt >= weekStart && b.dt < weekStart.plus({ weeks: 1 }));
      if (inWeek.length >= rules.maxPerBankPerWeek) continue;
    }
    for (const w of windows) {
      const ws = day.set({ hour: w.s.hour, minute: w.s.minute });
      const we = day.set({ hour: w.e.hour, minute: w.e.minute });
      for (let c = ws; c <= we; c = c.plus({ minutes: 5 })) {
        let cand = c;
        if (cand.toMillis() < start.getTime()) continue;
        if (jitter && cand.plus({ minutes: jitter }) <= we) cand = cand.plus({ minutes: jitter });
        const t = cand.toMillis();
        const gapAny = rules.minMinutesBetweenAnyEmails * 60_000;
        if (bookedNorm.some((b) => Math.abs(b.t - t) < gapAny)) continue;
        if (bank) {
          const gapBank = rules.minHoursBetweenSameBank * 3_600_000;
          if (bookedNorm.some((b) => b.bank === bank && Math.abs(b.t - t) < gapBank)) continue;
        }
        return new Date(t);
      }
    }
  }
  return null;
}

export function businessDaysBetween(a: Date, b: Date): number {
  let n = 0;
  let d = DateTime.fromJSDate(a).startOf("day").plus({ days: 1 });
  const end = DateTime.fromJSDate(b).startOf("day");
  while (d <= end) {
    if (d.weekday <= 5) n++;
    d = d.plus({ days: 1 });
  }
  return n;
}

export function renderSubject(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "").replace(/\s+/g, " ").replace(/\s+([–-])\s*$/, "").trim();
}

export function describeRules(r: Rules): string[] {
  const dayNames = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return [
    `Send on ${r.sendDays.map((d) => dayNames[d]).join(", ")} between ${r.windows.map((w) => `${w.start}–${w.end}`).join(" / ")} (${r.timezone})`,
    `Same bank: at least ${r.minHoursBetweenSameBank}h apart, max ${r.maxPerBankPerDay}/day and ${r.maxPerBankPerWeek}/week`,
    `Overall: max ${r.maxPerDay}/day, ≥${r.minMinutesBetweenAnyEmails} min between sends, ±${r.jitterMinutes} min jitter`,
    `Follow up after ${r.followUpAfterBusinessDays} business days, at most ${r.maxFollowUps} follow-ups`,
    `Default CC: ${r.defaultCc.join(", ") || "none"} · Default BCC: ${r.defaultBcc.join(", ") || "none"}`,
    `Subject: “${r.subjectTemplate}” · ≤${r.maxWords} words · resume ${r.attachResumeByDefault ? "attached" : "not attached"} by default`,
  ];
}
