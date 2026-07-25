// Validate the marketing string catalogue: every language file must carry exactly the English key
// set, matching types (string vs array), matching array lengths, and must preserve the {each}
// placeholder in price.familyDevices. Run: node docs/marketing/check-i18n.mjs
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const i18nDir = join(dirname(fileURLToPath(import.meta.url)), "i18n");
const EN = JSON.parse(readFileSync(join(i18nDir, "en.json"), "utf8"));
const enKeys = Object.keys(EN);
let problems = 0;

for (const f of readdirSync(i18nDir)) {
  if (!f.endsWith(".json") || f === "en.json") continue;
  const lang = f.replace(/\.json$/, "");
  let obj;
  try { obj = JSON.parse(readFileSync(join(i18nDir, f), "utf8")); }
  catch (e) { console.error(`✗ ${lang}: invalid JSON — ${e.message}`); problems++; continue; }
  const keys = Object.keys(obj);
  const missing = enKeys.filter((k) => !(k in obj));
  const extra = keys.filter((k) => !(k in EN));
  const typeMismatch = [];
  const untranslated = [];
  for (const k of enKeys) {
    if (!(k in obj)) continue;
    const a = EN[k], b = obj[k];
    if (Array.isArray(a) !== Array.isArray(b)) { typeMismatch.push(k); continue; }
    if (Array.isArray(a) && a.length !== b.length) typeMismatch.push(`${k}(len ${a.length}->${b.length})`);
    if (typeof b === "string" && b.trim() === "" ) typeMismatch.push(`${k}(empty)`);
  }
  if (typeof obj["price.familyDevices"] === "string" && !obj["price.familyDevices"].includes("{each}"))
    typeMismatch.push("price.familyDevices({each} lost)");
  const bad = missing.length || extra.length || typeMismatch.length;
  if (bad) {
    problems++;
    console.error(`✗ ${lang}: ${keys.length} keys` +
      (missing.length ? `\n    missing(${missing.length}): ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}` : "") +
      (extra.length ? `\n    extra(${extra.length}): ${extra.slice(0, 8).join(", ")}` : "") +
      (typeMismatch.length ? `\n    type/empty(${typeMismatch.length}): ${typeMismatch.slice(0, 8).join(", ")}` : ""));
  } else {
    console.log(`✓ ${lang}: ${keys.length} keys OK`);
  }
}
console.log(problems ? `\n${problems} file(s) with problems.` : `\nAll language files valid (${enKeys.length} keys each).`);
process.exit(problems ? 1 : 0);
