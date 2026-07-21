// PROOF that radio-button GROUPS (marital status, sex, …) get the right option selected —
// including when the group's field NAME is generic and only the OPTION labels are meaningful.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "../vendor/pdf-lib.esm.min.js";
import { fillPdfBytes } from "./pdffill.js";

async function pdfWithRadio(groupName, options) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  const rg = doc.getForm().createRadioGroup(groupName);
  let y = 300;
  for (const o of options) { rg.addOptionToPage(o, page, { x: 40, y, width: 14, height: 14 }); y -= 30; }
  return doc.save();
}
const selected = async (bytes, name) => (await PDFDocument.load(bytes)).getForm().getRadioGroup(name).getSelected();

test("marital-status radio group: 'Married' is selected (field name resolves)", async () => {
  const bytes = await pdfWithRadio("Marital Status", ["Single", "Married", "Widowed", "Divorced"]);
  const res = await fillPdfBytes(bytes, { marital_status: "Married" });
  assert.equal(res.filled, 1);
  assert.equal(await selected(res.bytes, "Marital Status"), "Married");
});

test("marital-status radio group with a GENERIC field name still selects 'Married' (option fallback)", async () => {
  // This is the case the old code skipped: the group is named "Group1", so the field itself
  // doesn't resolve — but the option labels do.
  const bytes = await pdfWithRadio("Group1", ["Single", "Married", "Widowed", "Divorced"]);
  const res = await fillPdfBytes(bytes, { marital_status: "Married" });
  assert.equal(await selected(res.bytes, "Group1"), "Married");
});

test("sex radio group: gender 'M' selects 'Male' (expansion), never 'Female'", async () => {
  const bytes = await pdfWithRadio("Sex", ["Male", "Female"]);
  const res = await fillPdfBytes(bytes, { gender: "M" });
  assert.equal(await selected(res.bytes, "Sex"), "Male");
});

test("no false selection when the user has no matching value", async () => {
  const bytes = await pdfWithRadio("Group9", ["Cash", "Card", "Cheque"]);
  const res = await fillPdfBytes(bytes, { marital_status: "Married", gender: "M" });
  const doc = await PDFDocument.load(res.bytes);
  assert.equal(doc.getForm().getRadioGroup("Group9").getSelected(), undefined); // nothing picked
});
