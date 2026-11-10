import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { handle, requireUser } from "@/lib/session";
import { extractResumeText } from "@/lib/ai";
import { textToPdf } from "@/lib/pdf";
import { publicUser } from "@/lib/views";

export const maxDuration = 120;

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
  const db = await getDb();
  const set: Partial<typeof schema.users.$inferInsert> = {};
  let profile = { ...u.profile };

  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > 4 * 1024 * 1024) throw new Error("Resume PDF must be under 4 MB");
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.subarray(0, 4).toString() !== "%PDF") throw new Error("Please upload a PDF file");
    set.resumePdfB64 = buf.toString("base64");
    set.resumeFilename = file.name || "Resume.pdf";
    if (!text) profile.resumeText = await extractResumeText(set.resumePdfB64);
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
  return new Response(Buffer.from(u.resumePdfB64, "base64"), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${u.resumeFilename ?? "Resume.pdf"}"` },
  });
});
