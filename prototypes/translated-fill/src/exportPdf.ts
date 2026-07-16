import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { DetectedField } from './fields';

/** A CJK-capable TTF is required to stamp Japanese/CJK values. Configurable + optional. */
const CJK_FONT_URL =
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf';

export interface FilledField extends DetectedField {
  /** The string to stamp, already in the desired output language. */
  value: string;
}

/**
 * Stamp values onto the original (scanned) PDF at the detected boxes and return bytes.
 * Because the source is image-only, we draw text directly (no AcroForm) — a "flattened" fill.
 *
 * @param renderScale  canvas pixels per PDF point used when the page was rendered/OCR'd
 */
export async function exportFilledPdf(
  originalBytes: ArrayBuffer,
  fields: FilledField[],
  renderScale: number,
  needsCjk: boolean,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(originalBytes);
  pdf.registerFontkit(fontkit);
  const page = pdf.getPage(0);
  const pageHeight = page.getHeight();

  let font: PDFFont;
  if (needsCjk) {
    font = (await tryEmbedCjk(pdf)) ?? (await pdf.embedFont(StandardFonts.Helvetica));
  } else {
    font = await pdf.embedFont(StandardFonts.Helvetica);
  }

  for (const f of fields) {
    if (!f.value.trim()) continue;
    // canvas px -> pdf points; canvas y is top-down, pdf y is bottom-up.
    const xPt = f.x / renderScale;
    const boxTopPt = f.y / renderScale;
    const boxHpt = f.h / renderScale;
    const size = Math.min(12, Math.max(8, boxHpt * 0.7));
    const yPt = pageHeight - boxTopPt - boxHpt + (boxHpt - size) / 2;
    try {
      page.drawText(f.value, { x: xPt + 2, y: yPt, size, font, color: rgb(0.05, 0.1, 0.6) });
    } catch {
      // glyph not in font (e.g. Devanagari in a Latin/CJK font) — skip, surfaced as a finding.
    }
  }
  return pdf.save();
}

async function tryEmbedCjk(pdf: PDFDocument): Promise<PDFFont | null> {
  try {
    const res = await fetch(CJK_FONT_URL);
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    return await pdf.embedFont(bytes, { subset: true });
  } catch {
    return null;
  }
}
