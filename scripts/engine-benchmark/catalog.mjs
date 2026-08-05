// Catalog every benchmark form: pages, distinct fields, total widgets, tooltip coverage, and a
// derived "kind" so we know what each form stresses. Writes results/catalog.json + prints a table.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractForm } from "./extract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const formsDir = join(here, "../../docs/testing/engine-benchmark/forms");
const outDir = join(here, "../../docs/testing/engine-benchmark/results");

function kindOf(f) {
  if (f.fields.length === 0) return "flat/XFA-opaque (pdf.js widgets)";
  const tipRatio = f.tooltipCount / Math.max(1, f.widgetCount);
  if (tipRatio > 0.3) return "AcroForm + tooltips";
  return "AcroForm/XFA, no tooltips (proximity)";
}

const rows = [];
for (const name of readdirSync(formsDir).filter((n) => n.endsWith(".pdf")).sort()) {
  const bytes = readFileSync(join(formsDir, name));
  try {
    const f = await extractForm(bytes);
    rows.push({ form: name, pages: f.pages, fields: f.fields.length, widgets: f.widgetCount, tooltips: f.tooltipCount, kind: kindOf(f) });
    console.log(`${name.padEnd(22)} pages=${String(f.pages).padStart(3)} fields=${String(f.fields.length).padStart(4)} widgets=${String(f.widgetCount).padStart(4)} tips=${String(f.tooltipCount).padStart(4)}  ${kindOf(f)}`);
  } catch (e) {
    rows.push({ form: name, error: String(e.message || e) });
    console.log(`${name.padEnd(22)} ERROR ${e.message || e}`);
  }
}
writeFileSync(join(outDir, "catalog.json"), JSON.stringify(rows, null, 2));
console.log(`\nwrote results/catalog.json (${rows.length} forms)`);
