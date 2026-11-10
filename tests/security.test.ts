/**
 * Security unit tests for pure logic (no network, no DB).
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMime, cleanList, isValidEmail, safeUrl, encodeHeader } from "../src/lib/mime";
import { findPlaceholders, typographize, resumeFilename } from "../src/lib/text-rules";
import { isAllowedEmail } from "../src/lib/access";
import { deliveryFor, isAutoReply } from "../src/lib/mail-signals";
import { normalizeBank } from "../src/lib/rules";

test("safeUrl only allows http(s)", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("JaVaScRiPt:alert(1)"), "");
  assert.equal(safeUrl(" javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,<script>alert(1)</script>"), "");
  assert.equal(safeUrl("vbscript:msgbox"), "");
  assert.equal(safeUrl("not a url"), "");
  assert.equal(safeUrl("https://www.linkedin.com/in/x"), "https://www.linkedin.com/in/x");
});

test("email address validation rejects header-injection payloads", () => {
  assert.equal(isValidEmail("a@b.com"), true);
  assert.equal(isValidEmail("a@b.com\r\nBcc: victim@x.com"), false);
  assert.equal(isValidEmail("a@b.com, c@d.com"), false);
  assert.equal(isValidEmail("<script>@x.com"), false);
  assert.deepEqual(cleanList("A@B.com, a@b.com; c@d.com"), ["a@b.com", "c@d.com"]);
});

test("MIME: CRLF in subject cannot inject headers", () => {
  const raw = buildMime({
    from: "Me <me@x.com>",
    to: ["a@b.com"],
    cc: [],
    bcc: [],
    subject: "Hi\r\nBcc: attacker@evil.com",
    body: "hello",
  });
  const headerBlock = raw.split("\r\n\r\n")[0];
  assert.ok(!/^Bcc:/im.test(headerBlock), "no injected Bcc header");
  assert.match(headerBlock, /^Subject: =\?UTF-8\?B\?/m, "non-printable subject is RFC 2047 encoded");
  assert.equal(encodeHeader("plain"), "plain");
});

test("MIME: HTML part escapes user content", () => {
  const raw = buildMime({ from: "me@x.com", to: ["a@b.com"], cc: [], bcc: [], subject: "s", body: "<img src=x onerror=alert(1)>" });
  const htmlB64 = raw.split('Content-Type: text/html; charset="UTF-8"')[1].split("\r\n\r\n")[1].split("\r\n--")[0];
  const html = Buffer.from(htmlB64.replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.ok(!html.includes("<img"), "raw tag must be escaped");
  assert.ok(html.includes("&lt;img"), "escaped");
});

test("access allowlist", () => {
  assert.equal(isAllowedEmail("x@y.com", "", { production: false }), true, "dev without allowlist = open");
  assert.equal(isAllowedEmail("x@y.com", "", { production: true, openSignups: false }), false, "prod without allowlist = closed (secure default)");
  assert.equal(isAllowedEmail("x@y.com", "", { production: true, openSignups: true }), true, "explicit OPEN_SIGNUPS=1");
  assert.equal(isAllowedEmail("me@upenn.edu", "@upenn.edu"), true);
  assert.equal(isAllowedEmail("me@evil-upenn.edu", "@upenn.edu"), false);
  assert.equal(isAllowedEmail("ME@Gmail.com", "me@gmail.com, you@gmail.com"), true);
  assert.equal(isAllowedEmail("other@gmail.com", "me@gmail.com"), false);
});

test("bounce rule: flagged only when EVERY recipient bounced", () => {
  const e = { to: ["a@x.com"], cc: ["b@x.com"], bcc: ["c@x.com"] };
  assert.equal(deliveryFor(e, []), "delivered");
  assert.equal(deliveryFor(e, ["a@x.com"]), "partial_bounce");
  assert.equal(deliveryFor(e, ["a@x.com", "b@x.com", "c@x.com"]), "all_bounced");
});

test("auto-replies are not counted as replies", () => {
  const msg = (headers: Record<string, string>) => ({ payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) } });
  assert.equal(isAutoReply(msg({ "Auto-Submitted": "auto-replied", Subject: "Re: hi" })), true);
  assert.equal(isAutoReply(msg({ Subject: "Automatic reply: Coffee chat" })), true);
  assert.equal(isAutoReply(msg({ Subject: "Out of Office" })), true);
  assert.equal(isAutoReply(msg({ "Auto-Submitted": "no", Subject: "Re: Coffee chat" })), false);
});

test("placeholders block sending; typography leaves addresses/URLs alone", () => {
  assert.deepEqual(findPlaceholders("See you [date] at [time]. arr[0]"), ["[date]", "[time]"]);
  assert.equal(typographize("o'neil@x.com https://a.com/it's"), "o'neil@x.com https://a.com/it's");
});

test("resume filename is header-safe", () => {
  assert.equal(resumeFilename('Jane "Q" Doe\r\nX'), "Jane_X_Resume.pdf");
});

test("bank normalisation", () => {
  assert.equal(normalizeBank("Goldman Sachs & Co. LLC"), "goldman sachs");
  assert.equal(normalizeBank("J.P. Morgan"), "jpmorgan");
  assert.equal(normalizeBank("Goldman Sachs India"), "goldman sachs");
});
