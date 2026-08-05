// Authoring aid: dump a form's fields (id | tooltip | printed caption | value the current engine
// assigned) so ground-truth locators can be written precisely. Optional 2nd arg filters by regex
// over id/tooltip/caption. Usage: node dump.mjs 10-irs-w4.pdf "name|address|ssn|first|last"
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractForm } from "./extract.mjs";
import { currentEngine } from "./engines.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const formsDir = join(here, "../../docs/testing/engine-benchmark/forms");
const arg = process.argv[2];
const filter = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const file = readdirSync(formsDir).find((f) => f === arg || f.startsWith(arg));
const form = await extractForm(readFileSync(join(formsDir, file)));
const asn = new Map(currentEngine(form).map((a) => [a.id, a.value]));

for (const f of form.fields) {
  const blob = `${f.id} ${f.tooltip} ${f.__caption}`;
  if (filter && !filter.test(blob)) continue;
  const v = asn.get(f.id) || "";
  console.log(`p${f.page + 1} | id=${(f.id || "").slice(0, 42).padEnd(42)} | tip=${(f.tooltip || "").slice(0, 46).padEnd(46)} | cap=${(f.__caption || "").slice(0, 30).padEnd(30)} | => ${v}`);
}
