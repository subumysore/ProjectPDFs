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
import { normOpt, fuzzyOptionMatch, pickOption } from "./optmatch.js";

// The user's enumerable values (the concepts that appear as list options / option
// checkboxes). Used to TICK the checkbox whose label equals one of these.
function userOptionValues(vault) {
  const ask = (label) => resolveFields(vault, [{ label, maxLength: -1 }])[0];
  const out = [];
  for (const c of ["salutation", "nationality", "country", "state", "marital status", "gender"]) {
    const v = ask(c); if (v) out.push(String(v));
  }
  const g = normOpt(ask("gender"));
  if (g === "m" || g === "male") out.push("male");
  if (g === "f" || g === "female") out.push("female");
  return out;
}

function tooltip(field) {
  try {
    const v = field.acroField.dict.lookup(PDFName.of("TU"));
    if (v && typeof v.decodeText === "function") return v.decodeText();
  } catch (_) { /* no tooltip */ }
  return "";
}

// Draw an image data-URI value at a field's on-page rectangle (for photo/signature
// fields), fitted and centred. Returns true if anything was drawn.
async function drawImageAtField(pdf, field, dataUrl) {
  const widgets = field.acroField.getWidgets();
  if (!widgets || !widgets.length) return false;
  const isPng = /^data:image\/png/i.test(dataUrl);
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1] || ""), (c) => c.charCodeAt(0));
  const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const pages = pdf.getPages();
  let drew = false;
  for (const w of widgets) {
    const rect = w.getRectangle(); // { x, y, width, height } in PDF points
    let page = pages[0];
    try {
      const pRef = w.dict.get(PDFName.of("P"));
      if (pRef) { const hit = pages.find((pg) => pg.ref.toString() === pRef.toString()); if (hit) page = hit; }
    } catch (_) { /* fall back to page 0 */ }
    const scale = Math.min(rect.width / img.width, rect.height / img.height) || 1;
    const dw = img.width * scale, dh = img.height * scale;
    page.drawImage(img, { x: rect.x + (rect.width - dw) / 2, y: rect.y + (rect.height - dh) / 2, width: dw, height: dh });
    drew = true;
  }
  return drew;
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
  const optionValues = userOptionValues(vault); // for ticking option-style checkboxes
  let filled = 0;
  for (let i = 0; i < all.length; i++) {
    const f = all[i];
    const v = values[i];
    const label = descriptors[i].label;
    try {
      // An IMAGE value (profile photo / signature stored as a data-URI) is DRAWN at the
      // field's location rather than typed — photo boxes and signature fields.
      if (typeof v === "string" && v.startsWith("data:image")) {
        if (await drawImageAtField(pdf, f, v)) {
          filled++;
          // Remove the field so its (opaque) widget box doesn't paint over the image.
          try { form.removeField(f); } catch (_) { /* older pdf-lib: leave the field */ }
        }
      } else if (f instanceof PDFTextField) {
        if (v == null || v === "") continue;
        f.setText(String(v)); filled++;
      } else if (f instanceof PDFDropdown || (typeof f.select === "function" && typeof f.getOptions === "function")) {
        // Dropdown / list box: select the option that SEMANTICALLY matches the value
        // ("Indian" selects "India"/"Indian"). Fall back to matching an option against
        // any of the user's enumerable values when the field itself didn't resolve.
        if (v == null || v === "") continue;
        const match = pickOption(f.getOptions(), v)
          || f.getOptions().find((o) => optionValues.some((uv) => fuzzyOptionMatch(o, uv)));
        if (match) { f.select(match); filled++; }
      } else if (f instanceof PDFCheckBox) {
        // A boolean checkbox with a truthy value, OR an OPTION checkbox whose label equals
        // one of the user's values (e.g. "Indian" under Nationality, "Male" under Sex).
        const truthy = v != null && v !== "" && /^(y|yes|true|1|on|x|checked)$/i.test(String(v));
        const optMatch = optionValues.some((uv) => fuzzyOptionMatch(label, uv));
        if (truthy || optMatch) { f.check(); filled++; }
      } else if (v != null && v !== "") {
        // Unknown field type that still accepts text.
        if (typeof f.setText === "function") { f.setText(String(v)); filled++; }
      }
    } catch (_) { /* skip a field that refuses a value */ }
  }

  try { form.updateFieldAppearances(); } catch (_) { /* best-effort */ }
  const out = await pdf.save();
  // Label→value pairs (for the viewer's "view in my language" side panel: shows each
  // field's label AND the value that fills it, both in the user's language).
  const pairs = descriptors
    .map((d, i) => ({ label: d.label, value: values[i] == null ? "" : String(values[i]) }))
    .filter((p) => p.label);
  return { total: all.length, filled, bytes: out, xfa, pairs };
}

export async function fillPdfFromUrl(url, vault) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`couldn't fetch the PDF (HTTP ${res.status})`);
  return fillPdfBytes(new Uint8Array(await res.arrayBuffer()), vault);
}
