// On-device PDF form filling for the browser (pdf-lib). Fetches the PDF, fills its
// AcroForm fields from your vault using the shared semantic resolver, and returns the
// completed bytes. Nothing is uploaded.
//
// A field is matched by the best readable label we can find: its TOOLTIP (/TU — a
// human-readable description many well-built forms set, e.g. "Employee's name"), else
// its field name. Forms with neither (cryptic XFA/LiveCycle forms like the IRS W-2)
// can't be matched by name at all — we detect that and report it honestly.
import { PDFDocument, PDFName, PDFTextField, PDFCheckBox, PDFDropdown } from "../vendor/pdf-lib.esm.min.js";
import { resolveFields, resolveBundle } from "./resolver.js";
import { identifyAcroForm } from "./pdfforms.js";

function tooltip(field) {
  try {
    const v = field.acroField.dict.lookup(PDFName.of("TU"));
    if (v && typeof v.decodeText === "function") return v.decodeText();
  } catch (_) { /* no tooltip */ }
  return "";
}

export async function fillPdfBytes(bytes, vault) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  const all = form.getFields();
  if (!all.length) return { total: 0, filled: 0, bytes: null, xfa: false };

  // AcroForm field-NAME template first (W-4/W-9): the field names are cryptic but
  // stable, so we setText on exactly the mapped fields — deterministic, no OCR.
  const acroForm = identifyAcroForm(all.map((f) => f.getName()));
  if (acroForm) {
    const bundle = resolveBundle(vault);
    let filled = 0;
    for (const f of all) {
      if (!(f instanceof PDFTextField)) continue;
      const rule = acroForm.fields.find((r) => r.m.test(f.getName()));
      if (!rule) continue;
      const value = rule.v(bundle);
      if (value == null || value === "") continue;
      try { f.setText(String(value)); filled++; } catch (_) { /* skip */ }
    }
    try { form.updateFieldAppearances(); } catch (_) { /* best-effort */ }
    const out = await pdf.save();
    return { total: acroForm.fields.length, filled, bytes: out, xfa: false, templated: true, form: acroForm.name };
  }

  // Label = tooltip if present (human description), else the field name.
  let withTU = 0;
  let bracketNames = 0;
  const descriptors = all.map((f) => {
    const name = f.getName();
    const tu = tooltip(f);
    if (tu) withTU++;
    if (name.includes("[")) bracketNames++; // LiveCycle/XFA naming signature
    return { label: tu || name, maxLength: (f instanceof PDFTextField && f.getMaxLength()) || -1 };
  });
  // An XFA/LiveCycle form: mostly bracket-named fields and no tooltips — unmappable by name.
  const xfa = withTU === 0 && bracketNames > all.length / 2;

  const values = resolveFields(vault, descriptors);
  let filled = 0;
  all.forEach((f, i) => {
    const v = values[i];
    if (v == null || v === "") return;
    try {
      if (f instanceof PDFTextField) { f.setText(String(v)); filled++; }
      else if (f instanceof PDFDropdown) {
        const match = f.getOptions().find((o) => o.toLowerCase() === String(v).toLowerCase());
        if (match) { f.select(match); filled++; }
      } else if (f instanceof PDFCheckBox) {
        if (/^(y|yes|true|1|on)$/i.test(String(v))) { f.check(); filled++; }
      }
    } catch (_) { /* skip a field that refuses a value */ }
  });

  try { form.updateFieldAppearances(); } catch (_) { /* best-effort */ }
  const out = await pdf.save();
  return { total: all.length, filled, bytes: out, xfa };
}

export async function fillPdfFromUrl(url, vault) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`couldn't fetch the PDF (HTTP ${res.status})`);
  return fillPdfBytes(new Uint8Array(await res.arrayBuffer()), vault);
}
