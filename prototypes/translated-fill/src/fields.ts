import type { OcrLine } from './ocr';

export interface DetectedField {
  /** AI/heuristic field name aligned to the ask (slug of the translated label). */
  name: string;
  /** Original-language label text (from OCR). */
  labelSource: string;
  /** Input box position, canvas pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Heuristic field detection from OCR lines. This is the deliberately-simplified
 * part of the spike: a real detector needs layout analysis (colons, ruled boxes,
 * underscores, table cells). Here we treat a label-like line as an "ask" and place
 * an input immediately to its right, within the page width.
 *
 * Returns fields keyed by the SOURCE label; naming/translation happens in main.ts.
 */
export function detectFields(lines: OcrLine[], pageWidthPx: number): DetectedField[] {
  const fields: DetectedField[] = [];
  for (const line of lines) {
    if (line.confidence < 40) continue;
    if (!looksLikeLabel(line.text)) continue;

    const h = Math.max(18, line.y1 - line.y0);
    const gap = 8;
    const x = Math.min(line.x1 + gap, pageWidthPx - 40);
    const w = Math.max(60, pageWidthPx - x - 12);
    fields.push({
      name: slug(line.text),
      labelSource: line.text,
      x,
      y: line.y0,
      w,
      h,
    });
  }
  return dedupe(fields);
}

/** A short line that reads like a prompt/label rather than a paragraph. */
function looksLikeLabel(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 40) return false;
  // Ends with a colon (any script) or contains a fill marker → strong signal.
  if (/[:：]\s*$/.test(t) || /[_＿]{2,}/.test(t)) return true;
  // Otherwise: a few words, not a sentence.
  const wordish = t.split(/\s+/).length <= 6;
  const notSentence = !/[。.]\s*$/.test(t);
  return wordish && notSentence;
}

/** Provisional field name from the source label; replaced by the translated slug later. */
export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[:：_＿]/g, ' ')
      .trim()
      .replace(/[^a-z0-9À-ɏ]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'field'
  );
}

function dedupe(fields: DetectedField[]): DetectedField[] {
  const seen = new Set<string>();
  const out: DetectedField[] = [];
  for (const f of fields) {
    const k = `${f.name}@${Math.round(f.y / 6)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}
