// Render a results JSON (baseline-current.json / granite.json / comparison) into a Markdown report
// with a per-form table, a macro-averaged rollup over ground-truth-labeled forms, and the concrete
// failure list (proof). Usage: node report.mjs baseline-current.json "Current engine (proximity)"
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, "../../docs/testing/engine-benchmark/results");
const inFile = process.argv[2] || "baseline-current.json";
const title = process.argv[3] || "Current engine";
const rows = JSON.parse(readFileSync(join(resultsDir, inFile), "utf8"));

const pct = (v) => (v == null ? "—" : (v * 100).toFixed(0) + "%");
const labeled = rows.filter((r) => (r.labeled || 0) > 0);
const avg = (key) => { const xs = labeled.map((r) => r[key]).filter((v) => v != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };

let md = `# Engine benchmark — ${title}\n\n`;
md += `Reproduce: \`node scripts/engine-benchmark/run-current.mjs\` (baseline) → \`node scripts/engine-benchmark/report.mjs ${inFile}\`.\n`;
md += `Vault + ground-truth: \`scripts/engine-benchmark/score.mjs\`, \`docs/testing/engine-benchmark/ground-truth/*.json\`.\n\n`;
md += `**P** = precision (of labeled fills, how many correct) · **R** = recall (of should-fill fields, how many correct) · `;
md += `**blankOK** = of should-be-BLANK fields, how many correctly left blank (over-fill guard) · **cov** = distinct vault values that landed.\n\n`;
md += `| Form | Pages | Fields | Filled | P | R | blankOK | cov | GT |\n|---|--:|--:|--:|--:|--:|--:|--:|--:|\n`;
for (const r of rows) {
  md += `| ${r.form} | ${r.pages} | ${r.fields} | ${r.filled} | ${pct(r.precision)} | ${pct(r.recall)} | ${pct(r.blankOk)} | ${r.coverage ?? "—"} | ${r.labeled || 0} |\n`;
}
md += `\n## Rollup (macro-average over ${labeled.length} ground-truth-labeled forms)\n\n`;
md += `- **Precision:** ${pct(avg("precision"))}\n- **Recall:** ${pct(avg("recall"))}\n- **Blank-correctness (over-fill guard):** ${pct(avg("blankOk"))}\n\n`;

md += `## Confirmed failures (proof)\n\n`;
for (const r of labeled) {
  const fails = (r.failures || []);
  if (!fails.length) { md += `### ${r.form} — clean\n\n`; continue; }
  md += `### ${r.form} — ${fails.length} issue(s)\n\n`;
  for (const f of fails) md += `- **${f.why}** — ${f.note || f.idRe || f.capRe || f.tipRe} ${f.got ? `(got: ${JSON.stringify(f.got)})` : ""}\n`;
  md += `\n`;
}
writeFileSync(join(resultsDir, inFile.replace(/\.json$/, ".md")), md);
console.log(`wrote results/${inFile.replace(/\.json$/, ".md")}`);
console.log(`Rollup: P=${pct(avg("precision"))} R=${pct(avg("recall"))} blankOK=${pct(avg("blankOk"))} over ${labeled.length} labeled forms`);
