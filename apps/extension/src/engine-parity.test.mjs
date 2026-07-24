// Guards against the two fill engines DRIFTING APART.
//
// `resolver.js` powers PDF-field fill; `pagefill.js` is the self-contained function injected
// into a web page (it cannot import, so its concept table is a deliberate copy). On 2026-07-23
// end-to-end testing found the copy had fallen 12 concepts behind: `occupation`, `ssn`, `taxid`,
// `birthplace`, `age` and others filled in PDFs and silently did NOTHING on web forms. Nothing
// caught it, because each file's own tests passed.
//
// This test fails the moment a concept is added to one and not the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const conceptKeys = (file) => {
  const src = readFileSync(join(here, file), "utf8");
  // Alias tables are `  key: ["syn", ...]` at four-space indent inside the ALIASES literal.
  return new Set([...src.matchAll(/^\s{4}([a-z_]+):\s*\[/gm)].map((m) => m[1]));
};

// Concepts that are IMAGE-valued (drawn into a PDF rectangle). A web text input cannot receive
// them, so they legitimately live only in resolver.js. Anything else must exist in both.
const PDF_ONLY = new Set([
  "photo", "signature", "drivers_license", "drivers_license_back", "passport_copy",
]);
// Education field concepts (Degree/Field/School/Year/GPA) come from the SHARED education.js module
// (EDU_FIELD_SYNS), used by both engines — resolver.js imports it, pagefill.js inlines a copy since
// it can't import. They are therefore in parity by construction; the per-engine ALIASES scan below
// would double-count pagefill's inlined copy, so exclude them here.
const EDUCATION = new Set(["degree", "field", "school", "year", "gpa"]);

test("every text concept in resolver.js also exists in pagefill.js", () => {
  const resolver = conceptKeys("resolver.js");
  const pagefill = conceptKeys("pagefill.js");
  const missing = [...resolver].filter((k) => !pagefill.has(k) && !PDF_ONLY.has(k) && !EDUCATION.has(k)).sort();
  assert.deepEqual(
    missing,
    [],
    "these concepts fill in PDFs but do nothing on web forms — add them to pagefill.js " +
      "(or to PDF_ONLY if they are genuinely image-valued): " + missing.join(", "),
  );
});

test("pagefill.js introduces no concept resolver.js lacks", () => {
  const resolver = conceptKeys("resolver.js");
  const pagefill = conceptKeys("pagefill.js");
  const extra = [...pagefill].filter((k) => !resolver.has(k) && !EDUCATION.has(k)).sort();
  assert.deepEqual(extra, [], "concepts only on the web side: " + extra.join(", "));
});

// Concept parity is not enough. The rules about what NOT to fill are just as load-bearing —
// a PDF that leaves the office-use check-digit box alone while the web version fills it is the
// same class of bug. Each rule below must exist on BOTH sides.
const SAFETY_RULES = [
  ["office-use / derived boxes", /NOT_THE_APPLICANTS/],
  ["script-qualified names", /SCRIPT_WORDS/],
  ["qualified addresses", /ADDRESS_QUALIFIERS/],
];
for (const [name, re] of SAFETY_RULES) {
  test(`both engines carry the "${name}" rule`, () => {
    const src = (f) => readFileSync(join(here, f), "utf8");
    assert.ok(re.test(src("resolver.js")), `resolver.js is missing the ${name} rule`);
    assert.ok(re.test(src("pagefill.js")), `pagefill.js is missing the ${name} rule`);
  });
}

test("the guard is actually reading real tables (not silently matching nothing)", () => {
  assert.ok(conceptKeys("resolver.js").size > 20, "resolver.js concept table not parsed");
  assert.ok(conceptKeys("pagefill.js").size > 20, "pagefill.js concept table not parsed");
});
