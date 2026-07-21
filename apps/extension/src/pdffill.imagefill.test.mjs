// PROOF that a photo/signature IMAGE actually draws into a PDF form field — builds a real
// PDF with a "Signature" field, fills a real PNG, and verifies the image was embedded and
// the field consumed. Runs in node with the vendored pdf-lib.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "../vendor/pdf-lib.esm.min.js";
import { fillPdfBytes } from "./pdffill.js";

// A valid 1x1 PNG (red pixel).
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_DATAURL = "data:image/png;base64," + PNG;

async function makePdfWith(fieldName) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const tf = doc.getForm().createTextField(fieldName);
  tf.addToPage(page, { x: 40, y: 40, width: 200, height: 90 });
  return doc.save();
}

test("a signature IMAGE is embedded + drawn into the PDF's Signature field", async () => {
  const bytes = await makePdfWith("Signature");
  const res = await fillPdfBytes(bytes, { signature: PNG_DATAURL });

  assert.equal(res.filled, 1, "one field filled");
  assert.ok(res.bytes && res.bytes.length, "produced output bytes");

  // Proof 1: the output PDF contains an embedded Image XObject.
  const out = new TextDecoder("latin1").decode(res.bytes);
  assert.ok(/\/Subtype\s*\/Image/.test(out), "output PDF has an embedded image XObject");

  // Proof 2: the field was consumed (removed) so its opaque widget can't cover the image.
  const outDoc = await PDFDocument.load(res.bytes);
  const names = outDoc.getForm().getFields().map((f) => f.getName());
  assert.ok(!names.includes("Signature"), "Signature field was consumed by the drawn image");
});

test("a profile_picture (data:image) draws into a 'Photo' field", async () => {
  const bytes = await makePdfWith("Photo");
  const res = await fillPdfBytes(bytes, { profile_picture: PNG_DATAURL });
  assert.equal(res.filled, 1);
  const out = new TextDecoder("latin1").decode(res.bytes);
  assert.ok(/\/Subtype\s*\/Image/.test(out), "profile picture embedded as an image");
});

test("a plain text field is NOT treated as an image (regression guard)", async () => {
  const bytes = await makePdfWith("Full Name");
  const res = await fillPdfBytes(bytes, { full_name: "Asha Rao" });
  assert.equal(res.filled, 1);
  const outDoc = await PDFDocument.load(res.bytes);
  const tf = outDoc.getForm().getTextField("Full Name");
  assert.equal(tf.getText(), "Asha Rao"); // text stayed text, field preserved
});
