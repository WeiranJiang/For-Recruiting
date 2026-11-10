import { handle, requireUser } from "@/lib/session";
import { loadSheet } from "@/lib/views";

function csv(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const GET = handle(async () => {
  const u = await requireUser();
  const { rows } = await loadSheet(u.id, u.rules);
  const cols = [
    ["Name", "name"], ["Email", "email"], ["Bank", "bank"], ["Group", "group"], ["Title", "title"], ["School", "school"],
    ["Status", "status"], ["First sent", "firstSentAt"], ["Last sent", "lastSentAt"], ["Scheduled", "scheduledAt"],
    ["Replied", "repliedAt"], ["Follow-ups sent", "followUpsSent"], ["Follow-up due", "followUpDue"],
    ["Flag", "flagReason"], ["Email confidence %", "emailConfidence"], ["Info confidence %", "infoConfidence"],
    ["Overall accuracy %", "accuracy"], ["Email source", "emailSource"], ["LinkedIn", "linkedinUrl"],
  ] as const;
  const lines = [cols.map((c) => c[0]).join(",")];
  for (const r of rows) lines.push(cols.map(([, k]) => csv(r[k as keyof typeof r])).join(","));
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="outreach-tracker.csv"' },
  });
});
