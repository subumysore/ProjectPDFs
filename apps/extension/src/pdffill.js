// On-device PDF form filling for the browser — the same engine the desktop app uses
// (pdf-lib), so "Fill this page" works on PDFs too. Fetches the PDF, fills its AcroForm
// fields from your vault using the shared semantic resolver, and returns the completed
// bytes for download. Nothing is uploaded.
import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown } from "../vendor/pdf-lib.esm.min.js";
import { resolveFields } from "./resolver.js";

export async function fillPdfBytes(bytes, vault) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  const all = form.getFields();
  if (!all.length) return { total: 0, filled: 0, bytes: null };

  // Resolve every field by its name (labels come from the PDF field names).
  const descriptors = all.map((f) => ({
    label: f.getName(),
    maxLength: (f instanceof PDFTextField && f.getMaxLength()) || -1,
  }));
  const values = resolveFields(vault, descriptors);

  let filled = 0;
  all.forEach((f, i) => {
    const v = values[i];
    if (v == null || v === "") return;
    try {
      if (f instanceof PDFTextField) {
        f.setText(String(v));
        filled++;
      } else if (f instanceof PDFDropdown) {
        const opts = f.getOptions();
        const match = opts.find((o) => o.toLowerCase() === String(v).toLowerCase());
        if (match) { f.select(match); filled++; }
      } else if (f instanceof PDFCheckBox) {
        if (/^(y|yes|true|1|on)$/i.test(String(v))) { f.check(); filled++; }
      }
    } catch (_) { /* skip a field that refuses a value */ }
  });

  try { form.updateFieldAppearances(); } catch (_) { /* best-effort */ }
  const out = await pdf.save();
  return { total: all.length, filled, bytes: out };
}

// Fetch a PDF from a URL (works for the active tab under activeTab) and fill it.
export async function fillPdfFromUrl(url, vault) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`couldn't fetch the PDF (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return fillPdfBytes(bytes, vault);
}
