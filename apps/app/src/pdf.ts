import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { PDFDocument, PDFTextField, PDFName, StandardFonts, rgb } from "pdf-lib";
import { resolveFields, resolveBundle } from "./fill/resolver";
import { identifyAcroForm } from "./fill/forms";
import { detectLang } from "./fill/lang";
import { planProximityFill } from "./fill/pdfproximity";
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
export async function fillByProximity(bytes: ArrayBuffer, vault: Record<string, string>): Promise<{ filled: number; total: number; data: Uint8Array }> {
  const pdf = await PDFDocument.load(bytes);
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
  let filled = 0;
  for (const a of assignments) {
    const f: any = byId.get(a.id);
    try { if (a.option != null) { f.select(a.option); filled++; } else if (typeof f.setText === "function") { f.setText(String(a.value)); filled++; } } catch { /* skip */ }
  }
  try { form.updateFieldAppearances(); } catch { /* best-effort */ }
  return { filled, total: fields.length, data: await pdf.save() };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function fillAndExport(
  bytes: ArrayBuffer,
  vault: Record<string, string>,
): Promise<{ filled: number; total: number; data: Uint8Array; formLang: string }> {
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const fields = form.getFields();
  const names = fields.map((f) => f.getName());
  let filled = 0;

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
      try { f.setText(String(val)); filled++; } catch { /* skip */ }
    }
  } else {
    const textFields = fields.filter((f) => f instanceof PDFTextField) as PDFTextField[];
    const descriptors = textFields.map((f) => ({
      label: fieldTooltip(f) || f.getName(),
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
      if (v != null && v !== "") { try { f.setText(String(v)); filled++; } catch { /* skip */ } }
    });
  }

  const formLang = detectLang(names.join(" ")).lang as string;
  try { form.updateFieldAppearances(); } catch { /* best-effort */ }
  const data = await pdf.save();
  return { filled, total: fields.length, data, formLang };
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
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const pages = pdf.getPages();
  let created = 0;
  let filled = 0;
  for (const f of fields) {
    if (!f.rect) continue;
    const page = pages[f.rect.page] ?? pages[0];
    if (!page) continue;
    const opts = { x: f.rect.x, y: f.rect.y, width: f.rect.w, height: f.rect.h };
    const val = vault[f.ontology_key];
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
      if (vault[f.ontology_key]) {
        cb.check();
        filled++;
      }
    } else {
      const tfld = form.createTextField(f.ontology_key);
      const v = vault[f.ontology_key];
      if (v !== undefined) {
        tfld.setText(v);
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
