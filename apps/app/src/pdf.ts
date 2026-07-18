import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { PDFDocument, PDFTextField, StandardFonts, rgb } from "pdf-lib";

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

/** Fill a PDF's AcroForm text fields from the vault and return the filled bytes. */
export async function fillAndExport(
  bytes: ArrayBuffer,
  vault: Record<string, string>,
): Promise<{ filled: number; total: number; data: Uint8Array }> {
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const fields = form.getFields();
  let filled = 0;
  for (const field of fields) {
    if (field instanceof PDFTextField) {
      const key = matchKey(field.getName(), vault);
      if (key) {
        field.setText(vault[key]);
        filled++;
      }
    }
  }
  const data = await pdf.save();
  return { filled, total: fields.length, data };
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
