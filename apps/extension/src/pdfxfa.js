// Fill a hybrid-XFA / LiveCycle form (USCIS N-400, I-130, …) that pdf-lib CANNOT parse as an AcroForm
// (getFields() returns 0; getPages() can even throw). pdf.js — which we already ship for OCR/translate —
// can BOTH read and WRITE these forms: we set each widget's value in pdf.js's annotationStorage and call
// saveDocument(), which emits a valid PDF that KEEPS every field EDITABLE. Boxes are labelled by their
// PRINTED caption via the shared proximity planner (no per-form rules). This is the desktop app's
// `fillXfaByWidgets` ported to the extension so both surfaces behave identically (CLAUDE.md dual-surface).
//
// If saveDocument is unavailable in some runtime, we fall back to rasterising each page with the values
// drawn on — a flat but fully-filled PDF — so the user always gets output.
import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
import { PDFDocument } from "../vendor/pdf-lib.esm.min.js";
import { planProximityFill, captionFor } from "./pdfproximity.js";
import { resolveFields } from "./resolver.js";

try { pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs"); } catch (_) { /* set elsewhere */ }

async function extractTexts(doc) {
  const texts = [];
  for (let pi = 0; pi < doc.numPages; pi++) {
    const tc = await (await doc.getPage(pi + 1)).getTextContent();
    for (const it of tc.items) { const s = (it.str || "").trim(); if (s) texts.push({ page: pi, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || 10, s }); }
  }
  return texts;
}

/**
 * @param {ArrayBuffer|Uint8Array} bytes  the source PDF
 * @param {Record<string,string>} vault
 * @param {Record<string,string>} [values]  explicit name->value overrides (review editor)
 * @returns {Promise<{filled:number,total:number,bytes:Uint8Array|null,captions:Record<string,string>,xfa:true}>}
 */
export async function fillPdfXfaWidgets(bytes, vault, values) {
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes).slice();
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  const texts = await extractTexts(doc);

  const groups = new Map();
  for (let pi = 0; pi < doc.numPages; pi++) {
    const anns = await (await doc.getPage(pi + 1)).getAnnotations().catch(() => []);
    for (const a of anns) {
      if (a.subtype !== "Widget" || !a.fieldName || a.hidden || a.readOnly) continue;
      const R = a.rect;
      const rect = { x: Math.min(R[0], R[2]), y: Math.min(R[1], R[3]), width: Math.abs(R[2] - R[0]), height: Math.abs(R[3] - R[1]) };
      if (rect.width < 2 || rect.height < 2) continue;
      const w = { id: a.id, name: a.fieldName, page: pi, kind: a.fieldType === "Tx" ? "text" : "choice", rect, isButton: a.fieldType === "Btn", exportValue: a.buttonValue ?? null, tooltip: (a.alternativeText || "").trim() };
      const g = groups.get(w.name) || []; g.push(w); groups.set(w.name, g);
    }
  }
  if (!groups.size) return { filled: 0, total: 0, bytes: null, captions: {}, xfa: true, widgets: true };

  const fields = [], captions = {};
  const textsByPage = new Map();
  for (const t of texts) { const a = textsByPage.get(t.page) || []; a.push(t); textsByPage.set(t.page, a); }
  for (const [name, ws] of groups) {
    const w0 = ws[0]; if (!w0) continue;
    const kind = w0.kind === "text" && !w0.isButton ? "text" : "choice";
    const options = ws.map((w) => w.exportValue).filter(Boolean);
    fields.push({ id: name, kind, page: w0.page, rect: w0.rect, options, tooltip: w0.tooltip || "", widgets: ws.map((w) => ({ page: w.page, rect: w.rect })) });
    try { const c = captionFor(textsByPage.get(w0.page) || [], w0.rect); if (c) captions[name] = c; } catch (_) { /* none */ }
  }

  const { assignments } = planProximityFill(fields, texts, vault, resolveFields);
  const planByName = new Map();
  for (const a of assignments) planByName.set(a.id, { value: a.value, option: a.option });
  if (values) for (const [name, v] of Object.entries(values)) if (v != null && v !== "") planByName.set(name, { value: v });

  let filled = 0;
  for (const [name, plan] of planByName) {
    const ws = groups.get(name); const w0 = ws && ws[0]; if (!ws || !w0) continue;
    try {
      if (plan.option != null) {
        const hit = ws.find((w) => w.exportValue && String(w.exportValue) === String(plan.option)) || w0;
        doc.annotationStorage.setValue(hit.id, ws.length > 1 && hit.exportValue ? { value: String(plan.option) } : { value: true });
        filled++;
      } else {
        const value = String(plan.value ?? ""); if (!value) continue;
        doc.annotationStorage.setValue(w0.id, { value });
        filled++;
      }
    } catch (_) { /* skip a value this widget can't take */ }
  }

  // PREFERRED: pdf.js writes the values back and keeps the form editable.
  try {
    const out = await doc.saveDocument();
    if (out && out.byteLength > 0) return { filled, total: fields.length, bytes: new Uint8Array(out), captions, xfa: true, widgets: true };
  } catch (_) { /* fall through to raster */ }

  // FALLBACK: rasterise each page with values drawn on (flat, but every value baked in).
  const outDoc = await PDFDocument.create();
  const SC = 2;
  for (let pi = 0; pi < doc.numPages; pi++) {
    const page = await doc.getPage(pi + 1);
    const vp = page.getViewport({ scale: SC });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext("2d"); if (!ctx) continue;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, annotationMode: 0 }).promise;
    for (const [name, plan] of planByName) {
      const ws = (groups.get(name) || []).filter((w) => w.page === pi); const w0 = ws[0]; if (!w0) continue;
      const target = plan.option != null ? (ws.find((w) => String(w.exportValue) === String(plan.option)) || w0) : w0;
      const [ax, ay, bx, by] = vp.convertToViewportRectangle([target.rect.x, target.rect.y, target.rect.x + target.rect.width, target.rect.y + target.rect.height]);
      const left = Math.min(ax, bx), top = Math.min(ay, by), h = Math.abs(by - ay), w = Math.abs(bx - ax);
      ctx.fillStyle = "#0a1466";
      if (plan.option != null) { ctx.font = `${Math.round(h * 0.9)}px sans-serif`; ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.fillText("X", left + w / 2, top + h / 2); }
      else {
        const value = String(plan.value ?? ""); if (!value) continue;
        let px = Math.max(8, Math.min(h * 0.72, 22)); ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.font = `${Math.round(px)}px sans-serif`;
        while (ctx.measureText(value).width > w - 4 && px > 6) { px -= 1; ctx.font = `${Math.round(px)}px sans-serif`; }
        ctx.fillText(value, left + 3, top + h / 2);
      }
    }
    const img = await outDoc.embedJpg(canvas.toDataURL("image/jpeg", 0.85));
    const pt = page.getViewport({ scale: 1 });
    outDoc.addPage([pt.width, pt.height]).drawImage(img, { x: 0, y: 0, width: pt.width, height: pt.height });
  }
  return { filled, total: fields.length, bytes: await outDoc.save(), captions, xfa: true, widgets: true };
}
