// Regression suite for form recognition (pdfforms.js): AcroForm field-name templates
// and OCR-text form detection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { identifyAcroForm, identifyForm } from "./pdfforms.js";

test("identifyAcroForm: W-4 recognised by its Step1a subform signature", () => {
  const f = identifyAcroForm(["topmostSubform[0].Page1[0].Step1a[0].f1_01[0]", "topmostSubform[0].Page1[0].f1_05[0]"]);
  assert.equal(f && f.id, "irs-w4");
});

test("identifyAcroForm: W-9 recognised by its classification subform signature", () => {
  const f = identifyAcroForm(["topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[0]"]);
  assert.equal(f && f.id, "irs-w9");
});

test("identifyAcroForm: an unrelated form is not misidentified", () => {
  assert.equal(identifyAcroForm(["form1[0].page1[0].name[0]", "form1[0].page1[0].email[0]"]), null);
});

test("identifyForm: detects a W-2 from its OCR'd caption text", () => {
  const f = identifyForm("22222 Wage and Tax Statement 2026 Department of the Treasury OMB No. 1545-0029");
  assert.equal(f && f.id, "irs-w2");
});

test("identifyForm: detects Form I-9 from its title", () => {
  const f = identifyForm("Employment Eligibility Verification USCIS Form I-9");
  assert.equal(f && f.id, "uscis-i9");
});

test("identifyForm: unrecognised text returns null", () => {
  assert.equal(identifyForm("Just a plain letter with no form markers."), null);
});
