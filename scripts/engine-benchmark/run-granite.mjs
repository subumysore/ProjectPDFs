// PHASE 3 — run the Granite-Docling engine over the same 15 forms and score identically to the baseline,
// so the two are directly comparable. If Granite can't run in this environment (no rasteriser / no model),
// we record a typed "pending" result with the reason — never a fabricated number.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractForm } from "./extract.mjs";
import { graniteEngine, GraniteUnavailable } from "./granite.mjs";
import { scoreForm } from "./score.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bench = join(here, "../../docs/testing/engine-benchmark");
const formsDir = join(bench, "forms");
const gtDir = join(bench, "ground-truth");

const files = readdirSync(formsDir).filter((f) => f.endsWith(".pdf")).sort();
const rows = [];
let unavailable = null;
for (const file of files) {
  const form = await extractForm(readFileSync(join(formsDir, file)));
  try {
    const assignments = await graniteEngine(form);
    const gtPath = join(gtDir, file.replace(/\.pdf$/, ".json"));
    const gt = existsSync(gtPath) ? JSON.parse(readFileSync(gtPath, "utf8")) : null;
    const sc = scoreForm(assignments, gt, form);
    rows.push({ form: file, pages: form.pages, fields: form.fields.length, filled: assignments.length, ...sc });
    console.log(`${file}  filled=${assignments.length}`);
  } catch (e) {
    if (e instanceof GraniteUnavailable) { unavailable = e.message; break; }
    throw e;
  }
}

if (unavailable) {
  const status = { engine: "granite-docling-258M", status: "PENDING", reason: unavailable,
    repro: "See docs/testing/engine-benchmark/README.md — provide a PDF rasteriser + the int8 model, then re-run." };
  writeFileSync(join(bench, "results/granite.json"), JSON.stringify(status, null, 2));
  console.log(`\nGranite comparison PENDING — ${unavailable}`);
  console.log("Wrote results/granite.json (status: PENDING). No fabricated numbers.");
} else {
  writeFileSync(join(bench, "results/granite.json"), JSON.stringify(rows, null, 2));
  console.log("\nwrote results/granite.json — run: node scripts/engine-benchmark/report.mjs granite.json 'Granite-Docling'");
}
