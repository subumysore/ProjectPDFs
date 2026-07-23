// Real government forms are mostly NOT text boxes: sex, marital status, nationality, "tick if
// applicable". The extension selected and ticked those; the desktop's fillAndExport only ever
// looked at PDFTextField, so the app left every dropdown, radio group and checkbox blank while the
// browser filled them. Both apps read the same vault, so the user got two different filled forms.
//
// The decision now lives in the engine (`decideChoice`), and this test pins BOTH the behaviour and
// the fact that the desktop still calls it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decideChoice, userOptionValues, fuzzyOptionMatch } from "./optmatch.js";
import { resolveFields } from "./resolver.js";

const here = dirname(fileURLToPath(import.meta.url));
const desktopPdf = readFileSync(join(here, "..", "..", "app", "src", "pdf.ts"), "utf8");
const extPdf = readFileSync(join(here, "pdffill.js"), "utf8");

const VAULT = { full_name: "Asha Rao", gender: "F", marital_status: "Married", nationality: "Indian" };
const OPTS = () => userOptionValues(VAULT, resolveFields);

test("a nationality dropdown selects the matching country", () => {
  const d = decideChoice({
    kind: "choice", label: "Nationality", value: "Indian",
    options: ["Select…", "India", "Indonesia", "Ireland"], optionValues: OPTS(),
  });
  assert.equal(d && d.select, "India");
});

test("a radio group with a MEANINGLESS name is still answered from what the user is", () => {
  // "Group1" resolves to nothing, so the options themselves must be matched against the user's
  // enumerable values — this is what selects Married on a marital-status group.
  const d = decideChoice({
    kind: "choice", label: "Group1", value: null,
    options: ["Single", "Married", "Divorced"], optionValues: OPTS(),
  });
  assert.equal(d && d.select, "Married");
});

test("gender stored as 'F' selects Female, never Male", () => {
  const d = decideChoice({
    kind: "choice", label: "Sex", value: "F",
    options: ["Male", "Female"], optionValues: OPTS(),
  });
  assert.equal(d && d.select, "Female");
});

test("an option checkbox labelled with one of the user's values is ticked", () => {
  const d = decideChoice({ kind: "check", label: "Married", value: null, optionValues: OPTS() });
  assert.deepEqual(d, { check: true });
});

test("an unrelated checkbox is left alone", () => {
  const d = decideChoice({ kind: "check", label: "I agree to receive marketing", value: null, optionValues: OPTS() });
  assert.equal(d, null, "a consent box must never be ticked for the user");
});

test("a boolean value ticks its own checkbox", () => {
  assert.deepEqual(decideChoice({ kind: "check", label: "Confirmed", value: "Yes", optionValues: [] }), { check: true });
  assert.equal(decideChoice({ kind: "check", label: "Confirmed", value: "No", optionValues: [] }), null);
});

test("a single letter cannot masquerade as a longer option", () => {
  // "M" must not match "Married" — that is why prefix matching requires 3+ characters.
  assert.equal(fuzzyOptionMatch("Married", "M"), false);
  assert.equal(fuzzyOptionMatch("Male", "male"), true);
});

test("no options and no match means the field is left untouched", () => {
  assert.equal(decideChoice({ kind: "choice", label: "Anything", value: null, options: [], optionValues: OPTS() }), null);
});

// ---- the parity guard itself -----------------------------------------------------------------
test("BOTH engines route non-text fields through the shared decision", () => {
  assert.ok(/decideChoice|pickOption/.test(extPdf), "the extension no longer uses the shared option logic");
  assert.ok(desktopPdf.includes("decideChoice"), "apps/app/src/pdf.ts does not use decideChoice — the desktop is back to text-only fill");
  assert.ok(desktopPdf.includes("userOptionValues"), "the desktop does not compute the user's enumerable values");
});

test("the desktop actually handles all three non-text field types", () => {
  for (const t of ["PDFDropdown", "PDFRadioGroup", "PDFCheckBox"]) {
    assert.ok(desktopPdf.includes(t), `apps/app/src/pdf.ts never mentions ${t}`);
  }
  // and it must call select()/check(), not merely detect them
  assert.ok(/\.select\(/.test(desktopPdf), "the desktop never selects an option");
  assert.ok(/\.check\(\)/.test(desktopPdf), "the desktop never ticks a checkbox");
});
