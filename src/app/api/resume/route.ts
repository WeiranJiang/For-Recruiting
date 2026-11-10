import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { handle, requireUser } from "@/lib/session";
import { AI_COST, chargeAi } from "@/lib/quota";
import { userError } from "@/lib/errors";
import { extractResumeText } from "@/lib/ai";
import { textToPdf } from "@/lib/pdf";
import { publicUser } from "@/lib/views";

export const maxDuration = 120;

/** ASCII-only, no quotes/CR/LF/path separators: safe inside a Content-Disposition header. */
function safeFilename(name: string | null | undefined) {
  const base = (name ?? "").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(0, 80);
  return /\.pdf$/i.test(base) ? base : `${base || "Resume"}.pdf`;
}

/**
 * multipart/form-data:
 *  - file: a PDF resume (attached to emails; text extracted for personalisation if no text pasted)
 *  - text: pasted resume text (used for personalisation; if no PDF exists, a simple PDF is generated from it)
 */
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const form = await req.formData();
  const file = form.get("file");
  const text = String(form.get("text") ?? "").trim();
  if (text.length > 20_000) throw userError("Resume text is too long (20,000 characters max).");
  const db = await getDb();
  const set: Partial<typeof schema.users.$inferInsert> = {};
  let profile = { ...u.profile };

  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > 4 * 1024 * 1024) throw userError("Resume PDF must be under 4 MB");
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw userError("Please upload a PDF file");
    set.resumePdfB64 = buf.toString("base64");
    set.resumeFilename = safeFilename(file.name);
    if (!text) {
      await chargeAi(u.id, AI_COST.resume);
      profile.resumeText = await extractResumeText(set.resumePdfB64);
    }
  }
  if (text) {
    profile = { ...profile, resumeText: text };
    if (!set.resumePdfB64 && !u.resumePdfB64) {
      set.resumePdfB64 = Buffer.from(await textToPdf(text, profile.fullName || u.name)).toString("base64");
      set.resumeFilename = `${(profile.fullName || u.name || "Resume").replace(/[^\w ]/g, "").trim().replace(/\s+/g, "_")}_Resume.pdf`;
    }
  }
  set.profile = profile;
  const [nu] = await db.update(schema.users).set(set).where(eq(schema.users.id, u.id)).returning();
  return Response.json({ user: publicUser(nu) });
});

export const DELETE = handle(async () => {
  const u = await requireUser();
  const db = await getDb();
  const [nu] = await db
    .update(schema.users)
    .set({ resumePdfB64: null, resumeFilename: null })
    .where(eq(schema.users.id, u.id))
    .returning();
  return Response.json({ user: publicUser(nu) });
});

export const GET = handle(async () => {
  const u = await requireUser();
  if (!u.resumePdfB64) return new Response("No resume", { status: 404 });
  // User-uploaded content: serve as an attachment-safe PDF in a sandbox so it can't run script on our origin.
  return new Response(Buffer.from(u.resumePdfB64, "base64"), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeFilename(u.resumeFilename)}"`,
      "Content-Security-Policy": "sandbox; default-src 'none'; object-src 'self'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});
