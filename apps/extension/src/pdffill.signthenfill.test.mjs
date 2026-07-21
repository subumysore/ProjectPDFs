// REGRESSION: filling and signing must work in EITHER order. A PDF that has already been
// signed (its overlay flattened into the page) must still fill every field. Proven here so
// the "sign first, then fill" real-world flow can't silently break.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const EXT = pathToFileURL(new URL("../", import.meta.url).pathname).href.replace(/^file:\/\//, "");
const { PDFDocument, StandardFonts } = await import(new URL("../vendor/pdf-lib.esm.min.js", import.meta.url));
const { fillPdfBytes } = await import(new URL("./pdffill.js", import.meta.url));
const { flattenOverlays } = await import(new URL("./signflatten.js", import.meta.url));

// A 1x1 transparent-ish PNG is enough for flattenOverlays to exercise the draw path.
const PNG_1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function buildForm() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Name:", { x: 40, y: 760, size: 10, font });
  const form = doc.getForm();
  form.createTextField("Surname").addToPage(page, { x: 120, y: 756, width: 200, height: 16, borderWidth: 0 });
  form.createTextField("Date of Birth").addToPage(page, { x: 120, y: 726, width: 160, height: 16, borderWidth: 0 });
  const sex = form.createRadioGroup("Sex");
  sex.addOptionToPage("Male", page, { x: 120, y: 696, width: 12, height: 12 });
  sex.addOptionToPage("Female", page, { x: 180, y: 696, width: 12, height: 12 });
  const mar = form.createRadioGroup("Marital status");
  mar.addOptionToPage("Single", page, { x: 120, y: 666, width: 12, height: 12 });
  mar.addOptionToPage("Married", page, { x: 200, y: 666, width: 12, height: 12 });
  return await doc.save();
}

const VAULT = { last_name: "MYSORE", date_of_birth: "11/30/1968", gender: "M", marital_status: "Married" };

test("fill works on a blank form", async () => {
  const res = await fillPdfBytes(await buildForm(), VAULT);
  assert.ok(res.filled >= 4, `expected >=4 filled, got ${res.filled}`);
});

test("SIGN FIRST then FILL: fill still fills every field on an already-flattened PDF", async () => {
  const blank = await buildForm();
  const signed = await flattenOverlays(blank, { "0": PNG_1x1 }); // emulate a prior signature
  const res = await fillPdfBytes(signed, VAULT);
  assert.ok(res.filled >= 4, `after signing, expected >=4 filled, got ${res.filled}`);
});

test("FILL FIRST then SIGN: signing an already-filled PDF preserves it and stays valid", async () => {
  const filled = (await fillPdfBytes(await buildForm(), VAULT)).bytes;
  const out = await flattenOverlays(filled, { "0": PNG_1x1 });
  // Re-open: still a valid PDF whose fields kept their values.
  const doc = await PDFDocument.load(out);
  const f = doc.getForm().getTextField("Surname");
  assert.equal(f.getText(), "MYSORE");
});
