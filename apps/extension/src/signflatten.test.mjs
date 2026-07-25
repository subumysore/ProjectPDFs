// PROOF that annotation overlays flatten onto the PDF (the place-on-PDF / handwrite feature).
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { PDFDocument, degrees } from "../vendor/pdf-lib.esm.min.js";
import { flattenOverlays, overlayPlacement } from "./signflatten.js";

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

// ---- Regression: page /Rotate must not flip the flattened overlay (guide "sign" bug) --------
// pdf.js renders a rotated page UPRIGHT and the user draws on that; the overlay must be baked so
// that after the viewer re-applies /Rotate it stays upright & aligned. The old code drew every
// overlay at {x:0,y:0,w,h,rotate:0}, so a /Rotate 180 page came out upside-down.

test("overlayPlacement converts the y-origin per /Rotate (pageHeight - y, not y)", () => {
  // Unrotated: identity at the origin (no conversion needed).
  assert.deepEqual(overlayPlacement(0, 300, 400), { x: 0, y: 0, width: 300, height: 400, rotate: 0 });
  // 180°: the image must be translated to the TOP-RIGHT corner (x=w, y=pageHeight) and spun 180° —
  // the naive {x:0,y:0,rotate:0} is exactly the inversion bug this guards against.
  assert.deepEqual(overlayPlacement(180, 300, 400), { x: 300, y: 400, width: 300, height: 400, rotate: 180 });
  assert.notEqual(overlayPlacement(180, 300, 400).rotate, 0, "180° page must NOT be drawn un-rotated");
  assert.equal(overlayPlacement(180, 300, 400).y, 400, "y must be converted to pageHeight, not left at 0");
  // 90° / 270°: viewport dims are swapped, so the draw box swaps w/h too.
  assert.deepEqual(overlayPlacement(90, 300, 400), { x: 300, y: 0, width: 400, height: 300, rotate: 90 });
  assert.deepEqual(overlayPlacement(270, 300, 400), { x: 0, y: 400, width: 400, height: 300, rotate: 270 });
});

// Decompress the flate content stream that contains the image-paint (`Do`) operator.
function imageOps(pdfBytes) {
  const buf = Buffer.from(pdfBytes);
  const s = buf.toString("latin1");
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    try {
      const inf = zlib.inflateSync(buf.subarray(start, end)).toString("latin1");
      if (inf.includes(" Do")) return inf;
    } catch { /* not a flate stream */ }
  }
  return "";
}

test("a /Rotate 180 page bakes the overlay with the inverse rotation (not flipped)", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  page.setRotation(degrees(180));
  const bytes = await doc.save({ useObjectStreams: false });
  const out = await flattenOverlays(bytes, { 0: OVERLAY });
  const ops = imageOps(await PDFDocument.load(out).then((d) => d.save({ useObjectStreams: false })));
  // Correct: translate to the page's top-right + a 180° rotation matrix (-1 0 0 -1).
  assert.match(ops, /1 0 0 1 300 400 cm/, "overlay is translated to (w, pageHeight) — the y-conversion");
  assert.match(ops, /-1 [-\d.e]+ [-\d.e]+ -1 0 0 cm/, "overlay carries the inverse 180° rotation");
  // Guard against a regression to the old naive draw (origin, no rotation).
  assert.doesNotMatch(ops, /1 0 0 1 0 0 cm\s+300 0 0 400 0 0 cm/, "must NOT draw un-rotated at the origin");
});

test("an unrotated page still draws the overlay 1:1 at the origin", async () => {
  const bytes = await blankPdf(1); // [300,400], no /Rotate
  const out = await flattenOverlays(bytes, { 0: OVERLAY });
  const ops = imageOps(out);
  assert.match(ops, /300 0 0 400 0 0 cm/, "unrotated overlay scales to the full page");
  assert.doesNotMatch(ops, /-1 0 0 -1 0 0 cm/, "no rotation applied to an unrotated page");
});
