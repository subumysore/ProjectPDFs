// E2E-1: assert the "which pages carry vault data" scan (scanFilledPages logic) returns the correct
// page set for a REAL filled N-400 — the fix behind the "Your data on: …" pager + auto-scroll. Run:
//   node scripts/e2e/verify-scan.mjs "<path to a filled n-400>.pdf"
import { readFile } from "node:fs/promises";
import { getDocument } from "../../node_modules/.pnpm/pdfjs-dist@4.10.38/node_modules/pdfjs-dist/legacy/build/pdf.min.mjs";

// EXACT mirror of scanFilledPages() in apps/app/src/pdf.ts — keep in lockstep.
function isHit(a) {
  if (a.subtype !== "Widget") return false;
  if (typeof a.fieldName === "string" && /barcode|pdf417/i.test(a.fieldName)) return false;
  if (a.fieldType === "Tx") return typeof a.fieldValue === "string" && a.fieldValue.trim() !== "";
  if (a.fieldType === "Btn") { const v = a.fieldValue; return typeof v === "string" && v && v !== "Off"; }
  if (a.fieldType === "Ch") { const v = a.fieldValue; return (Array.isArray(v) ? v.join("") : String(v ?? "")).trim() !== ""; }
  return false;
}
const path = process.argv[2];
const data = new Uint8Array(await readFile(path));
const doc = await getDocument({ data }).promise;
const pages = [];
for (let pi = 0; pi < doc.numPages; pi++) {
  const anns = await (await doc.getPage(pi + 1)).getAnnotations().catch(() => []);
  if (anns.some(isHit)) pages.push(pi);
}
const oneBased = pages.map((p) => p + 1);
const expect = [1, 2, 3, 4, 5, 11];
const ok = expect.every((p) => oneBased.includes(p)) && oneBased[0] === 1;
console.log("Filled pages (1-based):", oneBased.join(", "));
console.log("First filled page:", pages[0] + 1, "(auto-scroll target page)");
console.log(ok ? "PASS ✅ scan finds your data on the expected pages incl. 1(name),2(DOB),3-5(address),11(email/phone)"
              : "FAIL ❌ expected to include " + expect.join(","));
process.exit(ok ? 0 : 1);
