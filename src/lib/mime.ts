import crypto from "node:crypto";

export function encodeHeader(v: string) {
  // RFC 2047 encode non-ASCII header values
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

function wrap76(b64: string) {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function bodyToHtml(body: string) {
  return body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px 0">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export type MimeInput = {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  inReplyTo?: string | null;
  attachment?: { filename: string; contentB64: string; mimeType: string } | null;
};

/** Builds an RFC 5322 message (text + html alternative, optional attachment). */
export function buildMime(m: MimeInput): string {
  const alt = "alt_" + crypto.randomBytes(8).toString("hex");
  const mixed = "mix_" + crypto.randomBytes(8).toString("hex");
  const addr = m.from.match(/<([^>]+)>/)?.[1] ?? m.from;
  const domain = addr.split("@")[1]?.trim() || "mail.local";
  const headers = [
    `From: ${m.from}`,
    `To: ${m.to.join(", ")}`,
    m.cc.length ? `Cc: ${m.cc.join(", ")}` : null,
    m.bcc.length ? `Bcc: ${m.bcc.join(", ")}` : null,
    `Subject: ${encodeHeader(m.subject)}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    m.inReplyTo ? `In-Reply-To: ${m.inReplyTo}` : null,
    m.inReplyTo ? `References: ${m.inReplyTo}` : null,
    "MIME-Version: 1.0",
  ].filter(Boolean) as string[];

  const altPart = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(m.body, "utf8").toString("base64")),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(`<div style="font-family:Arial,sans-serif;font-size:14px">${bodyToHtml(m.body)}</div>`, "utf8").toString("base64")),
    `--${alt}--`,
  ].join("\r\n");

  if (!m.attachment) return [...headers, altPart].join("\r\n");

  const fname = m.attachment.filename.replace(/"/g, "");
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    altPart,
    `--${mixed}`,
    `Content-Type: ${m.attachment.mimeType}; name="${fname}"`,
    `Content-Disposition: attachment; filename="${fname}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(m.attachment.contentB64.replace(/\s/g, "")),
    `--${mixed}--`,
  ].join("\r\n");
}

export const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function cleanList(list: string[] | string | undefined | null): string[] {
  const arr = Array.isArray(list) ? list : (list ?? "").split(/[,;\s]+/);
  const out: string[] = [];
  for (const raw of arr) {
    const s = raw.trim().toLowerCase();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function isValidEmail(s: string) {
  return /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s);
}

/** Only http(s) URLs survive; anything else (javascript:, data:, vbscript:...) becomes "". */
export function safeUrl(u: string | null | undefined): string {
  if (!u) return "";
  try {
    const url = new URL(u.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}
