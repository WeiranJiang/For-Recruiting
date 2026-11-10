import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Renders pasted resume text into a clean, single-column PDF (used only when no PDF was uploaded). */
export async function textToPdf(text: string, name: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = 10;
  const margin = 50;
  const width = 612 - margin * 2;
  let page = doc.addPage([612, 792]);
  let y = 792 - margin;

  // WinAnsi fonts can't encode every character; replace the unsupported ones.
  const safe = (s: string) =>
    s
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/[•●▪]/g, "-")
      .replace(/[^\x20-\x7e\xa0-\xff]/g, "");

  const line = (t: string, f = font, s = size) => {
    if (y < margin) {
      page = doc.addPage([612, 792]);
      y = 792 - margin;
    }
    page.drawText(t, { x: margin, y, size: s, font: f, color: rgb(0.1, 0.1, 0.1) });
    y -= s * 1.4;
  };

  if (name) {
    line(safe(name), bold, 16);
    y -= 4;
  }
  for (const raw of text.split(/\r?\n/)) {
    const para = safe(raw);
    if (!para.trim()) {
      y -= size * 0.6;
      continue;
    }
    const isHeading = para.length < 40 && para === para.toUpperCase() && /[A-Z]/.test(para);
    const f = isHeading ? bold : font;
    let cur = "";
    for (const w of para.split(/\s+/)) {
      const next = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > width) {
        line(cur, f);
        cur = w;
      } else cur = next;
    }
    if (cur) line(cur, f);
  }
  return doc.save();
}
