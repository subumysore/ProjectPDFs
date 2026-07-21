// End-to-end (pdf-lib) proof that fillPdfByProximity fills a form whose field NAMES are opaque,
// using only the nearby printed captions — the mechanism that fills the real Japan MOFA visa form.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "../vendor/pdf-lib.esm.min.js";
import { fillPdfByProximity } from "./pdffill.js";

async function buildOpaqueForm() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const L = (t, x, y) => page.drawText(t, { x, y, size: 10, font });
  const form = doc.getForm();
  // Opaque field names (like the real XFA form) — nothing to match on but geometry.
  L("Surname", 65, 620); form.createTextField("T2").addToPage(page, { x: 211, y: 616, width: 300, height: 14, borderWidth: 0 });
  L("Sex:", 65, 532); L("Male", 86, 532); L("Female", 132, 532);
  const sex = form.createRadioGroup("RB1");
  sex.addOptionToPage("M", page, { x: 114, y: 530, width: 10, height: 10 });
  sex.addOptionToPage("F", page, { x: 171, y: 530, width: 10, height: 10 });
  L("Nationality or citizenship", 65, 512); // long label extends past the box left edge
  const nat = form.createDropdown("T50"); nat.addOptions(["  ", "INDIA", "JAPAN", "USA"]); nat.addToPage(page, { x: 184, y: 508, width: 366, height: 14, borderWidth: 0 });
  return await doc.save();
}

// The pdf.js text layer the caller would supply (x,y in PDF space, bottom-left origin).
const TEXTS = [
  { page: 0, x: 65, y: 620, w: 40, h: 10, s: "Surname" },
  { page: 0, x: 65, y: 532, w: 20, h: 10, s: "Sex:" },
  { page: 0, x: 86, y: 532, w: 22, h: 10, s: "Male" },
  { page: 0, x: 132, y: 532, w: 30, h: 10, s: "Female" },
  { page: 0, x: 65, y: 512, w: 120, h: 10, s: "Nationality or citizenship" },
];
const VAULT = { last_name: "MYSORE", gender: "M", nationality: "INDIA" };

test("fillPdfByProximity fills opaque-named fields by nearest caption", async () => {
  const res = await fillPdfByProximity(await buildOpaqueForm(), VAULT, TEXTS);
  assert.ok(res.filled >= 3, `expected >=3 filled, got ${res.filled}`);
  const doc = await PDFDocument.load(res.bytes);
  const form = doc.getForm();
  assert.equal(form.getTextField("T2").getText(), "MYSORE");
  assert.equal(form.getRadioGroup("RB1").getSelected(), "M");
  assert.equal(form.getDropdown("T50").getSelected()[0], "INDIA");
});
