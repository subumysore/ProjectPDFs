// PHASE 1 — baseline: run the CURRENT engine (shared proximity planner, the exact code the desktop
// app + extension use on the pdf.js widget layer) over all 15 forms with a fixed known vault, and
// score against per-form ground-truth assertions (precision / recall / blank-correctness), not just
// coverage. Writes results/baseline-current.json + prints a table.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractForm } from "./extract.mjs";
import { currentEngine } from "./engines.mjs";
import { scoreForm } from "./score.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bench = join(here, "../../docs/testing/engine-benchmark");
const formsDir = join(bench, "forms");
const gtDir = join(bench, "ground-truth");

const files = readdirSync(formsDir).filter((f) => f.endsWith(".pdf")).sort();
const rows = [];
for (const file of files) {
  const form = await extractForm(readFileSync(join(formsDir, file)));
  const assignments = currentEngine(form);
  const gtPath = join(gtDir, file.replace(/\.pdf$/, ".json"));
  const gt = existsSync(gtPath) ? JSON.parse(readFileSync(gtPath, "utf8")) : null;
  const sc = scoreForm(assignments, gt, form);
  rows.push({ form: file, pages: form.pages, fields: form.fields.length, filled: assignments.length, ...sc });
  const pct = (v) => (v == null ? " n/a " : (v * 100).toFixed(0).padStart(3) + "%");
  console.log(`${file.padEnd(20)} filled=${String(assignments.length).padStart(4)}  P=${pct(sc.precision)} R=${pct(sc.recall)} blankOK=${pct(sc.blankOk)}  (gt: ${sc.labeled ?? 0})`);
}
writeFileSync(join(bench, "results/baseline-current.json"), JSON.stringify(rows, null, 2));
console.log(`\nwrote results/baseline-current.json`);
