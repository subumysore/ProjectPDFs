// Universal on-device PDF fill via OCR — the fallback for PDFs that CAN'T be
// matched by AcroForm field names: XFA/LiveCycle forms (e.g. the IRS W-2, whose
// fields are cryptic "Col_L" names with no tooltips), scanned/flattened PDFs, or
// any form that is really just printed ink.
//
// How it works (all on-device):
//   1. Render each page with pdf.js to a canvas.
//   2. Red-dropout: use the GREEN channel as grayscale, so dropout-red ink
//      (like the W-2 "Copy A") turns dark and becomes OCR-readable.
//   3. OCR the page with Tesseract (WASM). Engine is vendored; the ~11 MB English
//      model is fetched once from our asset host, then cached (asset-DOWN only).
//   4. Match each printed label to your vault with the shared semantic resolver.
//   5. DRAW the value at the label's coordinates with pdf-lib.
// Nothing is uploaded. Only the OCR model file is downloaded, never your data.
import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
import { PDFDocument, StandardFonts, rgb } from "../vendor/pdf-lib.esm.min.js";
import { resolveFields } from "./resolver.js";
import { identifyForm } from "./pdfforms.js";
import { getTessWorker } from "./tess.js";
import { detectLang } from "./lang.js";
import { makeFontPicker } from "./fonts.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs");
const MAX_PAGES = 3; // cap OCR work — fillable fields are almost always in the first pages

// Render one page and return { canvas, ctx, scale, pageHeightPts }.
async function renderPage(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  await page.render({ canvasContext: ctx, viewport }).promise;
  // Red-dropout: collapse to the green channel so red ink becomes dark.
  const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = d[i + 1];
  ctx.putImageData(im, 0, 0);
  return { canvas, scale, pageHeightPts: viewport.height / scale };
}

/**
 * OCR-fill a PDF from raw bytes. Returns { total, filled, bytes, pages }.
 * `total` = OCR label-lines seen, `filled` = values drawn.
 */
// Split an OCR page into label SEGMENTS at box markers. Grid forms (W-2)
// concatenate many labels on one visual row — "a Employee's SSN  1 Wages…" — so
// matching a whole line misfires. A marker is a box tag: a lone letter (a–h), a
// 1–2 digit number, or "12a". The marker itself isn't label text — it just begins
// a new segment (a new box). Returns [{ text, bbox }].
function extractSegments(data) {
  const segs = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        if ((line.confidence ?? 0) < 45) continue;
        let cur = null;
        const flush = () => { if (cur && cur.words.length) segs.push(cur); cur = null; };
        for (const w of line.words ?? []) {
          const t = String(w.text ?? "").trim();
          if (!t) continue;
          const isMarker = /^[a-hA-H]$/.test(t) || /^\d{1,2}$/.test(t) || /^\d{1,2}[a-z]$/.test(t);
          if (isMarker) { flush(); cur = { words: [], bbox: { ...w.bbox } }; continue; }
          if (!cur) cur = { words: [], bbox: { ...w.bbox } };
          cur.words.push({ text: t, bbox: w.bbox });
          cur.bbox.x0 = Math.min(cur.bbox.x0, w.bbox.x0);
          cur.bbox.y0 = Math.min(cur.bbox.y0, w.bbox.y0);
          cur.bbox.x1 = Math.max(cur.bbox.x1, w.bbox.x1);
          cur.bbox.y1 = Math.max(cur.bbox.y1, w.bbox.y1);
        }
        flush();
      }
    }
  }
  return segs.map((s) => ({
    text: s.words.map((w) => w.text).join(" ").replace(/[|]/g, "").trim(),
    bbox: s.bbox,
    words: s.words,
  }));
}

// Never fill someone else's / an authority's cell in the generic (unknown-form) path.
const NOT_MINE = /employer|official use|state id|locality|control number|for privacy|instructions|see |cat\. no|form w|wage and tax/i;

export async function fillPdfByOcr(bytes, vault, onStatus) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await pdfjsLib.getDocument({ data: src.slice(0) }).promise;
  const out = await PDFDocument.load(src.slice(0), { ignoreEncryption: true });
  const pickFont = await makeFontPicker(out); // picks a script-appropriate font per value
  const outPages = out.getPages();
  const worker = await getTessWorker(onStatus);
  const nPages = Math.min(doc.numPages, MAX_PAGES);

  // Phase 1 — OCR every page, collect labelled segments + page geometry.
  const pageData = [];
  let fullText = "";
  for (let p = 1; p <= nPages; p++) {
    onStatus?.(`reading page ${p}/${nPages} (OCR)…`);
    const page = await doc.getPage(p);
    const { canvas, scale, pageHeightPts } = await renderPage(page, 3);
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const segs = extractSegments(data);
    pageData.push({ segs, scale, pageHeightPts });
    fullText += " " + segs.map((s) => s.text).join(" ");
  }

  // Detect the form's language (spec: language-aware filling). Used to flag when the
  // form isn't in the user's native language so the viewer can offer a translated view.
  const formLang = detectLang(fullText).lang;
  const nativeLang = (vault && vault.native_language) || "en";

  // Phase 2 — recognise the form. Known form → precise template fill; unknown →
  // generic strict fill (only high-confidence "your data" boxes).
  const form = identifyForm(fullText);
  onStatus?.(form ? `recognised ${form.name} — filling by template…` : "filling recognised labels…");

  let total = 0;
  let filled = 0;
  const drawInto = async (outPage, geom, bbox, value, place) => {
    // Image values (data: URIs) belong in AcroForm image draws, not text-drawn here.
    if (typeof value === "string" && value.startsWith("data:image")) return false;
    const { scale, pageHeightPts } = geom;
    const labelH = Math.max(9, (bbox.y1 - bbox.y0) / scale);
    const size = Math.min(11, Math.max(8, labelH * 0.95));
    // canvas px → PDF points, y flipped (canvas top-down, PDF bottom-up).
    const x = place === "right" ? bbox.x1 / scale + 6 : bbox.x0 / scale + 1;
    const y = place === "right"
      ? pageHeightPts - bbox.y1 / scale + 1               // baseline on the label line
      : pageHeightPts - bbox.y1 / scale - labelH - 3;     // one line below (inside the box)
    try {
      const font = await pickFont(value); // Devanagari/CJK values get an embedded Noto font
      outPage.drawText(String(value), { x, y, size, font, color: rgb(0.04, 0.13, 0.55) });
      return true;
    } catch (_) { return false; }
  };

  for (let idx = 0; idx < pageData.length; idx++) {
    const geom = pageData[idx];
    const outPage = outPages[idx];
    const { segs } = geom;
    if (form) {
      // Template layer: each rule anchors on a printed FIELD CAPTION. Reject
      // instruction PROSE so a rule can't latch onto a paragraph that merely mentions
      // the words ("…may be your social security number…"). The tell isn't length —
      // real captions can be compound ("Employee's social security number For Official
      // Use Only") — it's sentence vocabulary: prose carries connective/lowercase-flow
      // words that field captions never do.
      const PROSE = /\b(may|see|enter|your|you|if|instruction|example|optional|issued|foreign|flow|disregard|proprietor|account|valid|entity|individual|line|about|which|when|from)\b/i;
      const captions = segs.filter((s) => {
        const words = s.text.split(/\s+/).filter(Boolean).length;
        return words <= 9 && s.text.length <= 60 && !PROSE.test(s.text);
      });
      for (const rule of form.rules) {
        const seg = captions.find((s) => rule.on.test(s.text));
        if (!seg) continue;
        const maxLength = /initial/i.test(rule.ask) ? 1 : -1;
        const val = resolveFields(vault, [{ label: rule.ask, maxLength }])[0];
        if (val == null || val === "") continue;
        // A rule may share one OCR segment with others (grid boxes OCR'd as a
        // single row, e.g. W-2 box e "first name … | Last name | Suff."). `col`
        // pins the draw column to a sub-word inside that segment.
        let box = seg.bbox;
        if (rule.col) {
          const w = (seg.words || []).find((x) => rule.col.test(x.text));
          if (w) box = { x0: w.bbox.x0, y0: seg.bbox.y0, x1: w.bbox.x1, y1: seg.bbox.y1 };
        }
        total++;
        if (await drawInto(outPage, geom, box, val, rule.place)) filled++;
      }
    } else {
      // Generic strict path for unknown forms.
      const labels = segs.filter((s) => s.text.length >= 3 && s.text.length <= 44 && !NOT_MINE.test(s.text));
      if (!labels.length) continue;
      total += labels.length;
      const values = resolveFields(vault, labels.map((l) => ({ label: l.text, maxLength: -1 })));
      const seen = new Set();
      for (let i = 0; i < labels.length; i++) {
        const v = values[i];
        if (v == null || v === "" || seen.has(String(v))) continue;
        if (await drawInto(outPage, geom, labels[i].bbox, v, "below")) { filled++; seen.add(String(v)); }
      }
    }
  }

  onStatus?.(filled ? `filled ${filled} field(s) by reading the form` : "no matching labels found");
  const saved = await out.save();
  // Distinct caption-like labels for the bilingual side panel (Phase 3): short,
  // readable, de-duplicated, in document order.
  const seenLabel = new Set();
  const labels = [];
  for (const geom of pageData) {
    for (const s of geom.segs) {
      const words = s.text.split(/\s+/).filter(Boolean).length;
      if (words <= 9 && s.text.length >= 3 && s.text.length <= 60 && !seenLabel.has(s.text)) {
        seenLabel.add(s.text);
        labels.push(s.text);
      }
    }
  }
  return {
    total, filled, bytes: saved, pages: nPages,
    form: form ? form.name : null,
    formLang, nativeLang, labels,
  };
}
