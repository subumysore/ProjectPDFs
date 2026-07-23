// Tests for PDF-fill helpers. `repeatedRowIndexes` was added 2026-07-23 after end-to-end
// testing against the real HK Civil Service form (GF340) showed the engine writing the same
// employer into all NINE employment-history rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repeatedRowIndexes } from "./pdffill.js";

const idx = (names) => [...repeatedRowIndexes(names)].sort((a, b) => a - b);

test("repeated table rows: only the lowest-numbered row is kept", () => {
  const names = [
    "form1[0].Page5[0].NameOfFirm1[0]",
    "form1[0].Page5[0].NameOfFirm2[0]",
    "form1[0].Page5[0].NameOfFirm3[0]",
  ];
  assert.deepEqual(idx(names), [1, 2], "rows 2 and 3 must be skipped, row 1 kept");
});

test("row numbering that does not start at 1 keeps the lowest present", () => {
  assert.deepEqual(idx(["a.Ref3[0]", "a.Ref5[0]", "a.Ref4[0]"]), [1, 2]);
});

test("a lone numbered field is NOT treated as a table", () => {
  // e.g. "AddressLine1" with no AddressLine2 sibling — must still fill.
  assert.deepEqual(idx(["form1[0].Page2[0].ResidentialAddress1[0]"]), []);
});

test("address line 1 and 2 are distinct concepts, but ARE numbered siblings", () => {
  // Documents current behaviour: line 2 is skipped as a row. Acceptable because the resolver
  // composes a single address into line 1; revisit if per-line fill is wanted.
  assert.deepEqual(idx(["a.AddressLine1[0]", "a.AddressLine2[0]"]), [1]);
});

test("fields with no trailing number are untouched", () => {
  assert.deepEqual(idx(["a.EmailAddress[0]", "a.JobTitle[0]", "a.PassportNumber[0]"]), []);
});

test("same stem under DIFFERENT parents are separate tables", () => {
  const names = [
    "form1[0].Page5[0].NameOfFirm1[0]",
    "form1[0].Page5[0].NameOfFirm2[0]",
    "form1[0].Page6[0].NameOfFirm1[0]",
    "form1[0].Page6[0].NameOfFirm2[0]",
  ];
  // One row survives per page, not one overall.
  assert.deepEqual(idx(names), [1, 3]);
});

test("the GF340 case: nine employers collapse to one", () => {
  const names = Array.from({ length: 9 }, (_, i) => `form1[0].Page5[0].NameOfFirm${i + 1}[0]`);
  assert.equal(repeatedRowIndexes(names).size, 8);
});

test("names without the XFA [0] suffix still group", () => {
  assert.deepEqual(idx(["Employer1", "Employer2", "Employer3"]), [1, 2]);
});

// --- non-Latin values in standard AcroForm fields (found 2026-07-23) ---
import { needsUnicodeFont } from "./pdffill.js";

test("CJK / Indic / Arabic values are flagged as needing a Unicode font", () => {
  for (const v of ["\u9673\u5049", "\u0905\u092E\u093F\u0924", "\u0627\u0644\u0639\u0644\u064A", "\u0B85\u0BB0\u0BC1\u0BA3\u0BCD"]) {
    assert.equal(needsUnicodeFont(v), true, `expected ${v} to need a Unicode font`);
  }
});

test("Latin-1 values are fine for the standard WinAnsi appearance font", () => {
  for (const v of ["Li Wei Chen", "wei.chen@example.com", "+852 5555 0142", "Zurich", "Ren\u00e9 Fran\u00e7ois"]) {
    assert.equal(needsUnicodeFont(v), false, `expected ${v} to be encodable`);
  }
});

test("non-strings are not flagged", () => {
  assert.equal(needsUnicodeFont(null), false);
  assert.equal(needsUnicodeFont(undefined), false);
  assert.equal(needsUnicodeFont(42), false);
});
