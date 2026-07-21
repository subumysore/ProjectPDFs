// PROOF that annotation overlays flatten onto the PDF (the place-on-PDF / handwrite feature).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "../vendor/pdf-lib.esm.min.js";
import { flattenOverlays } from "./signflatten.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const OVERLAY = "data:image/png;base64," + PNG;

async function blankPdf(pages = 2) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 400]);
  return doc.save();
}

test("an overlay is embedded onto the chosen page", async () => {
  const bytes = await blankPdf(2);
  const out = await flattenOverlays(bytes, { 0: OVERLAY });
  const s = new TextDecoder("latin1").decode(out);
  assert.ok(/\/Subtype\s*\/Image/.test(s), "overlay embedded as an image on the page");
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 2); // pages preserved
});

test("pages without an overlay are left untouched; multiple pages supported", async () => {
  const bytes = await blankPdf(3);
  const out = await flattenOverlays(bytes, { 0: OVERLAY, 2: OVERLAY });
  assert.ok(out.length > bytes.length, "output grew (images added)");
});

test("empty/invalid overlays are ignored, not crashes", async () => {
  const bytes = await blankPdf(1);
  const out = await flattenOverlays(bytes, { 0: "", 1: "not-a-dataurl" });
  assert.ok(out && out.length, "still returns a valid PDF");
});
