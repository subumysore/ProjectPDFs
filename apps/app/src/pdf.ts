import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { PDFDocument, PDFTextField, PDFRadioGroup, PDFCheckBox, PDFDropdown, PDFName, StandardFonts, rgb } from "pdf-lib";
import { resolveFields, resolveBundle } from "./fill/resolver";
import { identifyAcroForm } from "./fill/forms";
import { detectLang } from "./fill/lang";
import { planProximityFill, captionFor } from "./fill/pdfproximity";
import { appearances } from "./fill/appearances";
import { userOptionValues, decideChoice } from "./fill/optmatch";
// Sign/annotate ENGINE — shared with the extension (flatten drawn overlays into the PDF). The
// drawing canvas is a per-platform UI layer; this flattening core is identical on both.
export { flattenOverlays } from "@engine/signflatten.js";

/** Read a text field's tooltip (/TU) — a human label many good forms set. */
function fieldTooltip(field: PDFTextField): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (field as any).acroField.dict.lookup(PDFName.of("TU"));
    if (v && typeof v.decodeText === "function") return v.decodeText();
  } catch {
    /* no tooltip */
  }
  return "";
}

/** A field-map entry from the catalog (mirrors core-catalog FieldSpec). */
export interface CatalogFieldSpec {
  name: string;
  ontology_key: string;
  kind: "Text" | "CheckBox";
  rect: { page: number; x: number; y: number; w: number; h: number } | null;
}

// On-device PDF render + fill/export. pdf.js renders the page (view); pdf-lib
// fills AcroForm fields from the vault and exports the filled copy. Everything
// runs in the webview — the PDF and values never leave the device.

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** The 0-based index of the FIRST page carrying a filled text value — so the preview can jump straight
 *  to where the user's data landed (many gov forms have a blank "office use only" page 1). 0 if none. */
export async function firstFilledPage(bytes: ArrayBuffer): Promise<number> {
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice() }).promise;
    for (let pi = 0; pi < doc.numPages; pi++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anns: any[] = await (await doc.getPage(pi + 1)).getAnnotations().catch(() => []);
      for (const a of anns) {
        if (a.subtype === "Widget" && a.fieldType === "Tx" && typeof a.fieldValue === "string" && a.fieldValue.trim()) return pi;
      }
    }
  } catch { /* fall through */ }
  return 0;
}

/** Render page 1 of a PDF into a canvas. */
export async function renderFirstPage(bytes: ArrayBuffer, canvas: HTMLCanvasElement): Promise<void> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1.2 });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
}

// Render a specific page (0-based) into `canvas` at `scale`, returning the page count and the
// rendered pixel size — so the Sign tool can lay an ink overlay exactly over each page.
export async function renderPage(
  bytes: ArrayBuffer,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  scale = 1.3,
): Promise<{ width: number; height: number; numPages: number }> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
  return { width: viewport.width, height: viewport.height, numPages: doc.numPages };
}

// A form field positioned ON the rendered page, so the UI can lay an editable box exactly over
// the real field — the user edits the FORM itself rather than a separate key/value list.
export interface FormFieldBox {
  name: string;
  kind: "text" | "radio" | "check" | "dropdown";
  value: string;
  options?: string[];
  optionValue?: string;   // for a radio WIDGET: the export value this one widget represents ("on" state)
  left: number;   // canvas px
  top: number;
  width: number;
  height: number;
}

/**
 * Render one page AND return its form fields already mapped to canvas pixel boxes, so the caller
 * can overlay real inputs on the page. Uses pdf.js annotations (authoritative widget rectangles).
 */
export async function renderPageWithFields(
  bytes: ArrayBuffer,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  scale = 1.3,
  fitWidth?: number,
): Promise<{ width: number; height: number; numPages: number; fields: FormFieldBox[] }> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(pageIndex + 1);
  // Fit the page to the available width so the whole form is visible (no side clipping).
  if (fitWidth && fitWidth > 0) {
    const base = page.getViewport({ scale: 1 });
    scale = Math.max(0.5, Math.min(2.5, fitWidth / base.width));
  }
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  // annotationMode 0 = DISABLE: do NOT paint widget appearances. The filled values would otherwise
  // be drawn by the PDF *and* by our overlay inputs — the doubled/offset text. The page renders the
  // static form (labels, rules, boxes) and our inputs supply every value exactly on the field.
  if (ctx) await page.render({ canvasContext: ctx, viewport, annotationMode: 0 }).promise;

  const fields: FormFieldBox[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const annots: any[] = await page.getAnnotations().catch(() => []);
  for (const a of annots) {
    if (a.subtype !== "Widget" || !a.fieldName || a.hidden) continue;
    const r = viewport.convertToViewportRectangle(a.rect);
    const left = Math.min(r[0], r[2]);
    const top = Math.min(r[1], r[3]);
    const width = Math.abs(r[2] - r[0]);
    const height = Math.abs(r[3] - r[1]);
    if (width < 2 || height < 2) continue;
    let kind: FormFieldBox["kind"] = "text";
    if (a.fieldType === "Btn") kind = a.checkBox === false || a.radioButton ? "radio" : "check";
    else if (a.fieldType === "Ch") kind = "dropdown";
    fields.push({
      name: a.fieldName,
      kind,
      value: typeof a.fieldValue === "string" ? a.fieldValue : a.fieldValue ? String(a.fieldValue) : "",
      options: Array.isArray(a.options) ? a.options.map((o: { displayValue?: string; exportValue?: string }) => o.displayValue || o.exportValue || "") : undefined,
      // A radio group has one Widget annotation per option; buttonValue is THIS widget's export value.
      optionValue: kind === "radio" ? (a.buttonValue ?? undefined) : undefined,
      left, top, width, height,
    });
  }
  return { width: viewport.width, height: viewport.height, numPages: doc.numPages, fields };
}

// One reviewable/editable form field for the "review before you finalize" step.
export interface ReviewField {
  name: string;                 // the PDF field name (stable key)
  label: string;                // human label (tooltip → name)
  kind: "text" | "radio" | "check" | "dropdown";
  value: string;                // current value ("" / "Off" when empty/unchecked)
  options?: string[];           // for radio / dropdown
}

// List every AcroForm field with its current value so the user can REVIEW and EDIT what was filled
// before finalizing (nothing is auto-committed silently). Returns [] for flat/scanned PDFs.
export async function listReviewFields(bytes: ArrayBuffer): Promise<ReviewField[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out: ReviewField[] = [];
  for (const f of pdf.getForm().getFields()) {
    const name = f.getName();
    if (f instanceof PDFTextField) {
      out.push({ name, label: fieldTooltip(f) || name, kind: "text", value: f.getText() ?? "" });
    } else if (f instanceof PDFRadioGroup) {
      out.push({ name, label: name, kind: "radio", value: f.getSelected() ?? "", options: f.getOptions() });
    } else if (f instanceof PDFCheckBox) {
      out.push({ name, label: name, kind: "check", value: f.isChecked() ? "Yes" : "Off" });
    } else if (f instanceof PDFDropdown) {
      out.push({ name, label: name, kind: "dropdown", value: (f.getSelected() ?? [])[0] ?? "", options: f.getOptions() });
    }
  }
  return out;
}

// Apply the user's edited values back into the PDF's form fields and re-export. Only fields the
// user actually changed need be passed; the rest keep their filled values.
export async function applyReviewEdits(
  bytes: ArrayBuffer,
  edits: Record<string, string>,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  const app = await appearances(pdf);
  for (const [name, value] of Object.entries(edits)) {
    let f;
    try { f = form.getField(name); } catch { continue; }
    try {
      if (f instanceof PDFTextField) f.setText(value);
      else if (f instanceof PDFRadioGroup) { if (value) f.select(value); }
      else if (f instanceof PDFCheckBox) { if (value === "Yes") f.check(); else f.uncheck(); }
      else if (f instanceof PDFDropdown) { if (value) f.select(value); }
      app.note(f, value);
    } catch { /* skip a value that doesn't fit this field */ }
  }
  await app.finish(); // per-field appearances with an embedded script font where needed
  return pdf.save({ updateFieldAppearances: false });
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

// Map a PDF form-field name to a vault ontology key by keyword.
function matchKey(fieldName: string, vault: Record<string, string>): string | undefined {
  const n = normalize(fieldName);
  if (vault[n] !== undefined) return n;
  const hints: Array<[RegExp, string]> = [
    [/name/, "full_name"],
    [/(dob|birth)/, "date_of_birth"],
    [/nationalit/, "nationality"],
    [/passport/, "passport_no"],
    [/phone|mobile/, "phone"],
    [/address/, "address"],
  ];
  for (const [re, key] of hints) if (re.test(n) && vault[key] !== undefined) return key;
  return undefined;
}

/**
 * Fill a PDF's AcroForm from the vault and return the filled bytes. Three layers,
 * strongest first (parity with the extension):
 *  1) Known-form field-NAME template (W-4/W-9 etc.): setText the exact mapped fields.
 *  2) Semantic resolver by each field's label (tooltip → name): meaning-matching,
 *     name composition, address combine/split — not literal key equality.
 *  3) Legacy matchKey hints as a last resort.
 * Also returns the detected form language (for language-aware viewing).
 */
// Extract the pdf.js text layer (positions in PDF user space) so opaque XFA/LiveCycle forms can be
// filled by PROXIMITY to each box's printed caption instead of its meaningless field name.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function extractTexts(bytes: ArrayBuffer): Promise<any[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice() }).promise;
  const texts: any[] = [];
  for (let pi = 0; pi < doc.numPages; pi++) {
    const tc = await (await doc.getPage(pi + 1)).getTextContent();
    for (const it of tc.items as any[]) { const s = (it.str || "").trim(); if (s) texts.push({ page: pi, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || 10, s }); }
  }
  return texts;
}

/** Fill a PDF whose field NAMES are meaningless (XFA/LiveCycle) by matching each box to its nearest
 *  printed caption — the SAME shared planner the extension uses, applied with the desktop's pdf-lib. */
export async function fillByProximity(bytes: ArrayBuffer, vault: Record<string, string>): Promise<{ filled: number; total: number; data: Uint8Array; unencodable: Array<{ field: string; value: string }> }> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  const pageRefs = pdf.getPages().map((p) => p.ref);
  const texts = await extractTexts(bytes);
  const fields: any[] = [];
  for (const f of form.getFields()) {
    const ws = (f as any).acroField.getWidgets(); if (!ws.length) continue;
    const kind = (typeof (f as any).select === "function" && typeof (f as any).getOptions === "function") ? "choice" : "text";
    const widgets = ws.map((w: any) => ({ page: pageRefs.findIndex((pr) => pr === w.P()), rect: w.getRectangle() }));
    let options: any = null; if (kind === "choice") { try { options = (f as any).getOptions(); } catch { options = []; } }
    fields.push({ id: f.getName(), field: f, kind, page: widgets[0].page, rect: widgets[0].rect, options, widgets });
  }
  const { assignments } = planProximityFill(fields, texts, vault, resolveFields);
  const byId = new Map(fields.map((f) => [f.id, f.field]));
  const app = await appearances(pdf);
  let filled = 0;
  for (const a of assignments) {
    const f: any = byId.get(a.id);
    try {
      if (a.option != null) { f.select(a.option); app.note(f, String(a.option)); filled++; }
      else if (typeof f.setText === "function") { f.setText(String(a.value)); app.note(f, String(a.value)); filled++; }
    } catch { /* skip */ }
  }
  const unencodable = await app.finish();
  filled -= unencodable.length;
  return { filled, total: fields.length, data: await pdf.save({ updateFieldAppearances: false }), unencodable };
}

// A single fillable widget as pdf.js sees it — used when pdf-lib CANNOT parse the form's fields
// (hybrid XFA / LiveCycle forms like the USCIS N-400: pdf-lib's getFields() returns 0, yet the page
// annotations are all present and fillable). rect is PDF user space (bottom-left origin).
interface Widget {
  name: string; page: number; kind: "text" | "choice";
  rect: { x: number; y: number; width: number; height: number };
  isButton: boolean; exportValue: string | null; options?: string[];
}
async function enumerateWidgets(bytes: ArrayBuffer): Promise<Widget[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice() }).promise;
  const out: Widget[] = [];
  for (let pi = 0; pi < doc.numPages; pi++) {
    const anns = await (await doc.getPage(pi + 1)).getAnnotations().catch(() => [] as any[]);
    for (const a of anns as any[]) {
      if (a.subtype !== "Widget" || !a.fieldName || a.hidden || a.readOnly) continue;
      const R = a.rect;
      const rect = { x: Math.min(R[0], R[2]), y: Math.min(R[1], R[3]), width: Math.abs(R[2] - R[0]), height: Math.abs(R[3] - R[1]) };
      if (rect.width < 2 || rect.height < 2) continue;
      const isButton = a.fieldType === "Btn";
      out.push({
        name: a.fieldName, page: pi, kind: a.fieldType === "Tx" ? "text" : "choice", rect, isButton,
        exportValue: (a.buttonValue ?? null) as string | null,
        options: Array.isArray(a.options) ? a.options.map((o: any) => o.displayValue || o.exportValue || "") : undefined,
      });
    }
  }
  return out;
}

/** Fill a hybrid-XFA / LiveCycle form (USCIS N-400 &c.) that pdf-lib CANNOT parse at all — not its
 *  fields, not even its page tree (`getPages()` throws "Expected instance of PDFDict"). pdf.js, which
 *  ALREADY renders the form, can also WRITE it: we set each widget's value in pdf.js's annotation
 *  storage and call `saveDocument()`, which emits a valid PDF that KEEPS every field EDITABLE (verified:
 *  a filled N-400 reloads with all 440 widgets intact and the values in place). Boxes are labelled by
 *  their PRINTED caption via the shared proximity planner. `values` (from the review editor) win over
 *  the auto-plan. Returns 0/0 when there is nothing to fill by widget (caller then falls back to OCR). */
export async function fillXfaByWidgets(
  bytes: ArrayBuffer,
  vault: Record<string, string>,
  values?: Record<string, string>, // optional explicit name->value overrides (from the review editor)
): Promise<{ filled: number; total: number; data: Uint8Array; formLang: string; captions: Record<string, string> }> {
  const texts = await extractTexts(bytes);
  // ONE doc instance: its annotationStorage is what saveDocument() serialises, and the annotation ids
  // we set must come from THIS doc's getAnnotations().
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), useSystemFonts: true }).promise;
  interface W { id: string; name: string; page: number; kind: "text" | "choice"; rect: { x: number; y: number; width: number; height: number }; isButton: boolean; exportValue: string | null }
  const groups = new Map<string, W[]>();
  for (let pi = 0; pi < doc.numPages; pi++) {
    const anns = await (await doc.getPage(pi + 1)).getAnnotations().catch(() => [] as any[]);
    for (const a of anns as any[]) {
      if (a.subtype !== "Widget" || !a.fieldName || a.hidden || a.readOnly) continue;
      const R = a.rect;
      const rect = { x: Math.min(R[0], R[2]), y: Math.min(R[1], R[3]), width: Math.abs(R[2] - R[0]), height: Math.abs(R[3] - R[1]) };
      if (rect.width < 2 || rect.height < 2) continue;
      const w: W = { id: a.id, name: a.fieldName, page: pi, kind: a.fieldType === "Tx" ? "text" : "choice", rect, isButton: a.fieldType === "Btn", exportValue: (a.buttonValue ?? null) as string | null };
      const g = groups.get(w.name) ?? []; g.push(w); groups.set(w.name, g);
    }
  }
  if (!groups.size) return { filled: 0, total: 0, data: new Uint8Array(bytes), formLang: "en", captions: {} };

  const fields: any[] = [];
  // Caption per field (its printed label) — lets the caller map an ANSWER back to a vault key, so the
  // user can save what they typed for next time. Computed for every field, filled or not.
  const captions: Record<string, string> = {};
  const textsByPage = new Map<number, any[]>();
  for (const t of texts as any[]) { const a = textsByPage.get(t.page) ?? []; a.push(t); textsByPage.set(t.page, a); }
  for (const [name, ws] of groups) {
    const w0 = ws[0]; if (!w0) continue;
    const kind = w0.kind === "text" && !w0.isButton ? "text" : "choice";
    const options = ws.map((w) => w.exportValue).filter(Boolean) as string[];
    fields.push({ id: name, kind, page: w0.page, rect: w0.rect, options, widgets: ws.map((w) => ({ page: w.page, rect: w.rect })) });
    try { const c = captionFor(textsByPage.get(w0.page) ?? [], w0.rect); if (c) captions[name] = c; } catch { /* no caption */ }
  }
  const { assignments } = planProximityFill(fields, texts, vault, resolveFields);
  const planByName = new Map<string, { value?: string; option?: string }>();
  for (const a of assignments as any[]) planByName.set(a.id, { value: a.value, option: a.option });
  if (values) for (const [name, v] of Object.entries(values)) if (v != null && v !== "") planByName.set(name, { value: v });

  let filled = 0;
  for (const [name, plan] of planByName) {
    const ws = groups.get(name); const w0 = ws?.[0]; if (!ws || !w0) continue;
    try {
      if (plan.option != null) {
        // Radio (many widgets, distinct export values) → select the chosen one; checkbox → check it.
        const hit = ws.find((w) => w.exportValue && String(w.exportValue) === String(plan.option)) ?? w0;
        doc.annotationStorage.setValue(hit.id, ws.length > 1 && hit.exportValue ? { value: String(plan.option) } : { value: true } as any);
        filled++;
      } else {
        const value = String(plan.value ?? ""); if (!value) continue;
        doc.annotationStorage.setValue(w0.id, { value } as any);
        filled++;
      }
    } catch { /* skip a value this widget can't take */ }
  }
  const formLang = detectLang(texts.map((x: any) => x.s).join(" ")).lang as string;
  // PREFERRED: pdf.js writes the values back and keeps the form editable.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outBytes: Uint8Array = await (doc as any).saveDocument();
    if (outBytes && outBytes.byteLength > 0) return { filled, total: fields.length, data: new Uint8Array(outBytes), formLang, captions };
  } catch { /* saveDocument unavailable/failed in this runtime → raster fallback below */ }

  // FALLBACK (guarantees output even if saveDocument fails): render each page and DRAW the values on,
  // then assemble a new flattened PDF from the page images. Not editable, but every value is baked in.
  const out = await PDFDocument.create();
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
      const ws = (groups.get(name) ?? []).filter((w) => w.page === pi); if (!ws.length) continue;
      const w0 = ws[0]; if (!w0) continue;
      const target = plan.option != null ? (ws.find((w) => String(w.exportValue) === String(plan.option)) ?? w0) : w0;
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
    const img = await out.embedJpg(canvas.toDataURL("image/jpeg", 0.85));
    const pt = page.getViewport({ scale: 1 });
    out.addPage([pt.width, pt.height]).drawImage(img, { x: 0, y: 0, width: pt.width, height: pt.height });
  }
  return { filled, total: fields.length, data: await out.save(), formLang, captions };
}

/** Review rows for a hybrid-XFA form pdf-lib can't parse — read straight from the pdf.js widgets so
 *  the UI can still show/edit every field (grouped by name; radios list their option export values). */
export async function listWidgetReviewFields(bytes: ArrayBuffer): Promise<ReviewField[]> {
  const widgets = await enumerateWidgets(bytes);
  const groups = new Map<string, Widget[]>();
  for (const w of widgets) { const g = groups.get(w.name) ?? []; g.push(w); groups.set(w.name, g); }
  const out: ReviewField[] = [];
  for (const [name, ws] of groups) {
    const w0 = ws[0]; if (!w0) continue;
    const label = name.split(/[.[\]]/).filter(Boolean).pop() || name;
    if (w0.kind === "text" && !w0.isButton) out.push({ name, label, kind: "text", value: "" });
    else { const options = ws.map((w) => w.exportValue).filter(Boolean) as string[]; out.push({ name, label, kind: options.length > 1 ? "radio" : "check", value: "", options: options.length ? options : undefined }); }
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function fillAndExport(
  bytes: ArrayBuffer,
  vault: Record<string, string>,
): Promise<{ filled: number; total: number; data: Uint8Array; formLang: string; unencodable: Array<{ field: string; value: string }> }> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  const fields = form.getFields();
  const names = fields.map((f) => f.getName());
  let filled = 0;

  // pdf-lib sees NO fillable fields — either a flat/scanned PDF, or a hybrid-XFA form whose structure
  // pdf-lib cannot parse. Return "0" immediately and do NOT touch appearances()/getPages(): on some XFA
  // forms (USCIS N-400) pdf-lib's page tree is unreadable and getPages() throws "Expected instance of
  // PDFDict". Signalling 0 lets the caller route to the pdf.js widget filler (fillXfaByWidgets).
  if (fields.length === 0) {
    return { filled: 0, total: 0, data: new Uint8Array(bytes), formLang: "en", unencodable: [] };
  }

  // Opaque XFA/LiveCycle form (bracket names, no tooltips) → fill by proximity to printed captions,
  // matching the extension. Use it when it beats the name-based pass.
  const bracketNames = names.filter((n) => n.includes("[")).length;
  const withTU = fields.filter((f) => f instanceof PDFTextField && fieldTooltip(f)).length;
  if (withTU === 0 && bracketNames > names.length / 2) {
    try {
      const prox = await fillByProximity(bytes, vault);
      const nameGuess = names.filter((n) => resolveFields(vault, [{ label: n }])[0]).length;
      if (prox.filled > nameGuess) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const texts = await extractTexts(bytes).catch(() => [] as any[]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const formLang = detectLang(texts.map((x: any) => x.s).join(" ")).lang as string;
        return { ...prox, formLang };
      }
    } catch { /* fall back to name-based */ }
  }

  const app = await appearances(pdf);
  const acro = identifyAcroForm(names);
  if (acro) {
    const bundle = resolveBundle(vault);
    for (const f of fields) {
      if (!(f instanceof PDFTextField)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rule = acro.fields.find((r: any) => r.m.test(f.getName()));
      if (!rule) continue;
      const val = rule.v(bundle);
      if (val == null || val === "") continue;
      try { f.setText(String(val)); app.note(f, String(val)); filled++; } catch { /* skip */ }
    }
  } else {
    const textFields = fields.filter((f) => f instanceof PDFTextField) as PDFTextField[];
    const descriptors = textFields.map((f) => ({
      label: fieldTooltip(f) || f.getName(),
      name: f.getName(), // the raw field name also decides office-use / derived boxes
      maxLength: (f.getMaxLength && f.getMaxLength()) || -1,
    }));
    const values = resolveFields(vault, descriptors);
    textFields.forEach((f, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let v: any = values[i];
      if (v == null || v === "") {
        const key = matchKey(f.getName(), vault); // legacy fallback
        v = key ? vault[key] : undefined;
      }
      if (v != null && v !== "") { try { f.setText(String(v)); app.note(f, String(v)); filled++; } catch { /* skip */ } }
    });
  }

  // NON-TEXT fields: dropdowns, radio groups and checkboxes. Real government forms are largely
  // made of these — sex, marital status, nationality, "tick if applicable" — and the desktop used
  // to skip every one of them because it only ever looked at PDFTextField. The decision itself is
  // the shared engine's (`decideChoice`), so a radio group behaves the same here as in the browser.
  {
    const optionValues = userOptionValues(vault, resolveFields);
    for (const f of fields) {
      if (f instanceof PDFTextField) continue;
      const isChoice = f instanceof PDFDropdown || f instanceof PDFRadioGroup;
      const isCheck = f instanceof PDFCheckBox;
      if (!isChoice && !isCheck) continue;
      const label = (f instanceof PDFTextField ? fieldTooltip(f) : "") || f.getName();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let options: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (isChoice) { try { options = (f as any).getOptions() || []; } catch { options = []; } }
      const value = resolveFields(vault, [{ label, name: f.getName() }])[0];
      const decision = decideChoice({
        kind: isChoice ? "choice" : "check",
        label,
        value,
        options,
        optionValues,
      });
      if (!decision) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (decision.select != null) { (f as any).select(decision.select); app.note(f, String(decision.select)); filled++; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else if (decision.check) { (f as any).check(); app.note(f, ""); filled++; }
      } catch { /* a field that refuses the value is left alone */ }
    }
  }

  const formLang = detectLang(names.join(" ")).lang as string;
  // Per-field appearances with the font each value needs. A value no embeddable font can draw
  // is left blank and reported — it no longer aborts the whole export.
  const unencodable = await app.finish();
  filled -= unencodable.length;
  const data = await pdf.save({ updateFieldAppearances: false });
  return { filled, total: fields.length, data, formLang, unencodable };
}

/**
 * Wrap a form IMAGE (photo/scan: JPG or PNG) into a single-page PDF at the image's
 * own pixel dimensions (1px → 1pt). The result is a flat PDF with no fields — feed it
 * straight into `detectFields` (OCR) or `makeFillableAndFill`. Runs on-device; the
 * image is only embedded locally and never uploaded.
 */
export async function imageToPdf(bytes: ArrayBuffer, mimeType: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const isPng = /png/i.test(mimeType) || (!/jpe?g/i.test(mimeType) && new Uint8Array(bytes)[0] === 0x89);
  const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const page = pdf.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  return pdf.save();
}

/** Generate a FLAT sample PDF — real page content, but NO AcroForm fields. */
export async function generateFlatSamplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Passport Application (flat PDF — no form fields)", { x: 50, y: 790, size: 15, font: bold });
  page.drawText("This page has NO fillable fields. 'Make fillable' creates + places + fills them.", {
    x: 50,
    y: 768,
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  for (const [label, y] of [
    ["Full name", 740],
    ["Date of birth", 690],
    ["Nationality", 640],
  ] as const) {
    page.drawText(label + ":", { x: 50, y, size: 12, font });
    page.drawLine({ start: { x: 180, y: y - 2 }, end: { x: 500, y: y - 2 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  }
  return pdf.save();
}

/**
 * Make a FLAT PDF fillable: CREATE each field-map widget at its coordinates, fill
 * it from the vault, and return the new (fillable + filled) PDF. This is the
 * "non-editable PDF → fillable" core (REQ-02) for PDFs with no AcroForm.
 */
export async function makeFillableAndFill(
  bytes: ArrayBuffer,
  fields: CatalogFieldSpec[],
  vault: Record<string, string>,
): Promise<{ created: number; filled: number; data: Uint8Array }> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  const pages = pdf.getPages();
  let created = 0;
  let filled = 0;
  for (const f of fields) {
    if (!f.rect) continue;
    const page = pages[f.rect.page] ?? pages[0];
    if (!page) continue;
    const opts = { x: f.rect.x, y: f.rect.y, width: f.rect.w, height: f.rect.h };
    // Value for this detected field. An EXACT vault key wins (and is the only way images resolve),
    // but fall back to the semantic resolver so a field like "Full name" composes from first_name +
    // last_name even though the vault has no "full_name" key. Without this, OCR-detected name/city/
    // etc. fields stayed blank whenever the vault stored the parts rather than the exact key.
    const exact = vault[f.ontology_key];
    const val = exact !== undefined && exact !== ""
      ? exact
      : resolveFields(vault, [{ label: f.name, name: f.ontology_key }])[0] ?? undefined;
    // If the vault value is an IMAGE (profile photo / signature stored as a data-URI),
    // draw it onto the page at the field's coordinates instead of a text field.
    if (typeof val === "string" && val.startsWith("data:image")) {
      const isPng = /^data:image\/png/i.test(val);
      const b64 = val.split(",")[1] ?? "";
      const imgBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const img = isPng ? await pdf.embedPng(imgBytes) : await pdf.embedJpg(imgBytes);
      // Fit within the field box, preserving aspect ratio.
      const scale = Math.min(f.rect.w / img.width, (f.rect.h * 3) / img.height, 1);
      page.drawImage(img, { x: f.rect.x, y: f.rect.y, width: img.width * scale, height: img.height * scale });
      created++;
      filled++;
      continue;
    }
    if (f.kind === "CheckBox") {
      const cb = form.createCheckBox(f.ontology_key);
      cb.addToPage(page, opts);
      if (val) {
        cb.check();
        filled++;
      }
    } else {
      const tfld = form.createTextField(f.ontology_key);
      if (val !== undefined && val !== "") {
        tfld.setText(String(val));
        filled++;
      }
      tfld.addToPage(page, opts);
    }
    created++;
  }
  const data = await pdf.save();
  return { created, filled, data };
}

/** Trigger a browser download of bytes as a file. */
export function downloadBytes(data: Uint8Array, filename: string): void {
  const blob = new Blob([data as unknown as BlobPart], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
