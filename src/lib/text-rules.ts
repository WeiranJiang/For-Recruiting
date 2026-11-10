/**
 * Deterministic writing rules shared by server and client:
 * typography, day/date checks, placeholders, signature block, resume filename.
 */

/** Curly quotes/apostrophes and en dashes for numeric ranges. Leaves emails/URLs alone. */
export function typographize(text: string): string {
  return text
    .split(/(\S+@\S+|https?:\/\/\S+)/g)
    .map((part, i) => {
      if (i % 2 === 1) return part; // email address or URL
      return part
        .replace(/(\w)'(\w)/g, "$1’$2") // don't, I'm
        .replace(/(^|[\s(\[{—–-])'/g, "$1‘") // opening single
        .replace(/'/g, "’") // closing single / apostrophe
        .replace(/(^|[\s(\[{—–-])"/g, "$1“") // opening double
        .replace(/"/g, "”") // closing double
        .replace(/(\d)\s?-\s?(\d)/g, "$1–$2"); // 10:30-10:50 → 10:30–10:50, 1-2 → 1–2
    })
    .join("");
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DATE_RE = new RegExp(
  `\\b(${DAYS.join("|")}|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\\.?,?\\s+(${MONTHS.join("|")}|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
  "gi",
);
const SHORT_DAYS: Record<string, number> = { mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sun: 0 };

export type DateIssue = { text: string; message: string; suggestion: string };

/**
 * Finds "Friday, November 20th" style pairs whose weekday is wrong.
 * Without a year, assumes the next occurrence of that date (within the coming ~10 months).
 */
export function findDateIssues(text: string, now = new Date()): DateIssue[] {
  const out: DateIssue[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const [whole, dayRaw, monRaw, dRaw, yRaw] = m;
    const dayKey = dayRaw.toLowerCase();
    const wantDay = DAYS.indexOf(dayKey) >= 0 ? DAYS.indexOf(dayKey) : SHORT_DAYS[dayKey];
    const mi = MONTHS.findIndex((x) => x.startsWith(monRaw.toLowerCase().slice(0, 3)));
    const d = parseInt(dRaw, 10);
    if (mi < 0 || wantDay === undefined || d < 1 || d > 31) continue;
    let year = yRaw ? parseInt(yRaw, 10) : now.getFullYear();
    if (!yRaw) {
      const candidate = new Date(year, mi, d);
      if (candidate.getTime() < now.getTime() - 60 * 86_400_000) year += 1;
    }
    const date = new Date(year, mi, d);
    if (date.getMonth() !== mi) {
      out.push({ text: whole, message: `${monRaw} ${d} doesn’t exist`, suggestion: whole });
      continue;
    }
    if (date.getDay() !== wantDay) {
      const real = DAYS[date.getDay()];
      const realCased = real[0].toUpperCase() + real.slice(1);
      const fixed = whole.replace(dayRaw, dayRaw.length <= 5 && !DAYS.includes(dayKey) ? realCased.slice(0, 3) : realCased);
      out.push({ text: whole, message: `${monRaw} ${d}, ${year} is a ${realCased}, not ${dayRaw}`, suggestion: fixed });
    }
  }
  return out;
}

/** Placeholders the draft left for the student to fill in, e.g. [date]. */
export const PLACEHOLDER_RE = /\[[A-Za-z][^\]\n]{0,39}\]/g;
export function findPlaceholders(text: string): string[] {
  return [...new Set(text.match(PLACEHOLDER_RE) ?? [])];
}

export type SignatureProfile = {
  fullName: string;
  school: string;
  gradYear: string;
  major: string;
  phone?: string;
};

/** Default signature block: Full Name / University | Class of Year / Major / Email | Phone. */
export function signatureBlock(p: SignatureProfile, email: string): string {
  const lines = [
    p.fullName,
    [p.school, p.gradYear && `Class of ${p.gradYear}`].filter(Boolean).join(" | "),
    p.major,
    [email, p.phone].filter(Boolean).join(" | "),
  ].filter((l) => l && l.trim());
  return lines.join("\n");
}

/** Clean, general attachment name: FirstName_LastName_Resume.pdf */
export function resumeFilename(fullName: string, fallback = "Resume.pdf"): string {
  const parts = fullName.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  const name = parts.length > 1 ? `${parts[0]}_${parts[parts.length - 1]}` : parts[0];
  return `${name}_Resume.pdf`;
}
