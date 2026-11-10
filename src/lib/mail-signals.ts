/** Pure mail-signal helpers (no I/O), shared by sync and tests. */
import type { gmail_v1 } from "googleapis";
import type { DeliveryStatus } from "./db/schema";
import { cleanList } from "./mime";

export function header(m: gmail_v1.Schema$Message, name: string) {
  return m.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Out-of-office and other automatic replies (RFC 3834 headers + common subjects). */
export function isAutoReply(m: gmail_v1.Schema$Message) {
  const auto = header(m, "Auto-Submitted").toLowerCase();
  if (auto && auto !== "no") return true;
  if (header(m, "X-Autoreply") || header(m, "X-Autorespond") || header(m, "X-Auto-Response-Suppress").toLowerCase().includes("all")) return true;
  if (/auto_reply|auto-reply/i.test(header(m, "Precedence"))) return true;
  return /automatic reply|auto(matic)?[- ]?reply|out of (the )?office|ooo\b|away from (the |my )?office|on leave|on vacation/i.test(header(m, "Subject"));
}

/**
 * Delivery rule (as requested): an email is flagged as undelivered only when EVERY
 * recipient (To + CC + BCC) bounced. If even one went through it is "delivered" (or "partial_bounce").
 */
export function deliveryFor(e: { to: string[]; cc: string[]; bcc: string[] }, bounced: string[]): DeliveryStatus {
  const all = cleanList([...e.to, ...e.cc, ...e.bcc]);
  const b = new Set(cleanList(bounced));
  const n = all.filter((a) => b.has(a)).length;
  if (n === 0) return "delivered";
  return n >= all.length ? "all_bounced" : "partial_bounce";
}
