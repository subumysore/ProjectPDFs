import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { PDFDocument, PDFTextField } from "pdf-lib";

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

/** Trigger a browser download of bytes as a file. */
export function downloadBytes(data: Uint8Array, filename: string): void {
  const blob = new Blob([data as unknown as BlobPart], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
