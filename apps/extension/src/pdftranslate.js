// Translate a SCANNED / printed (fieldless) PDF: OCR each page on-device, then translate
// the extracted lines into the user's language. Reading aid — the document itself is not
// altered. Supported-language scope: OCR uses the bundled English Tesseract data, and
// translation uses the on-device models (en/hi/es/fr/de/zh/ar/ru). A form whose source
// language lacks an OCR pack or a translation model can't be read yet (see docs).
//
// The orchestration (dedupe + translate + reassemble) is a PURE function, `buildTranslationDoc`,
// so it's unit-tested with a mock translator; the OCR/render glue wraps it.
import { detectLang } from "./lang.js"; // node-safe; the browser-only deps are imported lazily below

// Render a pdf.js page to a canvas at a given scale (higher = better OCR, slower).
async function renderPage(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}

// Tesseract blocks -> array of text lines (in reading order), trimmed, blanks dropped.
function linesFromOcr(data) {
  const out = [];
  const blocks = (data && data.blocks) || [];
  for (const b of blocks) for (const par of b.paragraphs || []) for (const ln of par.lines || []) {
    const t = (ln.text || "").replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  }
  if (!out.length && data && data.text) { // fallback: split the whole-page text
    for (const t of data.text.split(/\r?\n/)) { const s = t.replace(/\s+/g, " ").trim(); if (s) out.push(s); }
  }
  return out;
}

/**
 * PURE orchestrator: given pages of OCR'd lines, translate each UNIQUE line once (via the
 * injected async translateFn) and return the per-page src/translated pairs. Unit-tested.
 * @param {{page:number,lines:string[]}[]} pages
 * @param {(text:string,from:string,to:string)=>Promise<string>} translateFn
 */
export async function buildTranslationDoc(pages, translateFn, to, from = "", onStatus = () => {}) {
  const allLines = pages.flatMap((p) => p.lines).map((l) => (l || "").trim()).filter((l) => l.length >= 2);
  const src = from || (allLines.length ? detectLang(allLines.join(" ")).lang : "en");
  const uniq = [...new Set(allLines)];
  const cache = {};
  let n = 0;
  for (const line of uniq) {
    onStatus(`Translating ${++n}/${uniq.length}…`);
    cache[line] = src === to ? line : await translateFn(line, src, to);
  }
  return {
    from: src, to,
    pages: pages.map((p) => ({
      page: p.page,
      lines: (p.lines || []).map((l) => ({ src: l, tr: cache[(l || "").trim()] != null ? cache[(l || "").trim()] : l })),
    })),
  };
}

// Full pipeline: OCR the PDF on-device, then translate. Uses buildTranslationDoc internally.
export async function translateScannedPdf(bytes, { to = "en", from = "", onStatus = () => {} } = {}) {
  // Browser-only deps loaded on demand (keeps the module node-importable for tests).
  const pdfjsLib = await import("../vendor/pdfjs/pdf.min.mjs");
  const { getTessWorker } = await import("./tess.js");
  const { translateText } = await import("./translate.js");
  try { pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs"); } catch (_) { /* ignore */ }
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const worker = await getTessWorker((s) => onStatus(s));
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onStatus(`Reading page ${p} of ${doc.numPages} (on-device OCR)…`);
    const page = await doc.getPage(p);
    const canvas = await renderPage(page, 3);
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    pages.push({ page: p, lines: linesFromOcr(data) });
  }
  return buildTranslationDoc(pages, (t, f, tt) => translateText(t, f, tt, onStatus), to, from, onStatus);
}
