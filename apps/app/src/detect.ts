import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { createWorker } from "tesseract.js";
import type { CatalogFieldSpec } from "./pdf";

// OCR/CV field detection for UNCATALOGUED flat/scanned PDFs (REQ-02 fallback).
// Renders the page (pdf.js), OCRs it on-device (self-hosted Tesseract) to get text
// LINES with bounding boxes, treats label-like lines as "asks", maps them to
// ontology keys, and emits field rects (converted to PDF points) — which feed the
// same create-widgets-and-fill code. Everything runs on-device.
//
// This is the deliberately-simplified detector from the feasibility trial: a real
// one needs deskew, ruled-line/box/checkbox analysis, and a layout model. Good
// enough to place fields next to recognised labels on a reasonable scan.

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const TESS = "/tesseract";

const KEY_HINTS: Array<[RegExp, string]> = [
  [/full\s*name|(^|\b)name\b/i, "full_name"],
  [/date of birth|dob|d\.o\.b|birth/i, "date_of_birth"],
  [/nationalit/i, "nationality"],
  [/passport/i, "passport_no"],
  [/phone|mobile|contact/i, "phone"],
  [/address/i, "address"],
];

function labelToKey(text: string): string | null {
  const t = text.trim();
  if (t.length > 40) return null; // paragraphs aren't labels
  for (const [re, key] of KEY_HINTS) if (re.test(t)) return key;
  return null;
}

interface OcrLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

/** Detect fillable fields on a PDF page via OCR, returning field-map specs with coordinates. */
export async function detectFields(
  pdfBytes: ArrayBuffer,
  onStatus?: (s: string) => void,
): Promise<{ fields: CatalogFieldSpec[]; note: string }> {
  const scale = 2;
  const doc = await pdfjs.getDocument({ data: pdfBytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale });
  const pageHeightPts = viewport.height / scale;
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { fields: [], note: "no canvas context" };
  await page.render({ canvasContext: ctx, viewport }).promise;

  onStatus?.("OCR (detecting fields)…");
  const worker = await createWorker("eng", 1, {
    workerPath: `${TESS}/worker.min.js`,
    corePath: `${TESS}/`,
    langPath: `${TESS}/`,
    workerBlobURL: false,
    gzip: true,
  });
  // Request block/line geometry.
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  await worker.terminate();

  const lines: OcrLine[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const block of ((data as any).blocks ?? []) as any[]) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const text = String(line.text ?? "").replace(/\s+/g, " ").trim();
        if (text) lines.push({ text, bbox: line.bbox, confidence: line.confidence ?? 0 });
      }
    }
  }

  const fields: CatalogFieldSpec[] = [];
  const used = new Set<string>();
  const gap = 8;
  for (const line of lines) {
    if (line.confidence < 40) continue;
    const key = labelToKey(line.text);
    if (!key || used.has(key)) continue;
    const b = line.bbox;
    const fx = b.x1 + gap; // place the input to the RIGHT of the label
    const fw = Math.max(80, canvas.width - fx - 12);
    // canvas px -> PDF points; canvas y is top-down, PDF y is bottom-up.
    fields.push({
      name: line.text.replace(/[:：_].*$/, "").trim() || key,
      ontology_key: key,
      kind: "Text",
      rect: {
        page: 0,
        x: fx / scale,
        y: pageHeightPts - b.y1 / scale,
        w: fw / scale,
        h: Math.max(14, (b.y1 - b.y0) / scale),
      },
    });
    used.add(key);
  }
  return {
    fields,
    note: `Detected ${fields.length} field(s) from ${lines.length} OCR lines (label → nearest input).`,
  };
}
