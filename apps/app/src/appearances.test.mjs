// DESKTOP-side proof of the same bug the extension had: one CJK/Indic value used to abort the
// ENTIRE PDF export (`WinAnsi cannot encode`, thrown at save time after every field was set), so
// a user filling a Chinese form got no file at all. The desktop has its own pdf-lib and its own
// fill path in src/pdf.ts, so fixing the shared engine did NOT fix the .exe — this test covers
// the desktop half. (The extension half is proven by pdffill's tests.)
//
// It exercises the real desktop modules: pdf-lib from node_modules, the real Noto fonts shipped
// in public/fonts (served from the app origin at runtime; here `fetch` is pointed at the same
// files on disk, which is exactly what the packaged app loads).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PDFDocument, PDFHexString, PDFName } from "pdf-lib";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

// The app fetches "/fonts/NotoSans….ttf" from its own origin; serve those from disk.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => {
  const u = String(url);
  if (u.startsWith("/")) {
    try {
      const buf = await readFile(join(publicDir, u));
      return new Response(buf, { status: 200 });
    } catch {
      return new Response("", { status: 404 });
    }
  }
  return realFetch(url, ...rest);
};

const { appearances } = await import("./fill/appearances.ts");

async function fillOne(value) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 300]);
  const form = pdf.getForm();
  const f = form.createTextField("field0");
  f.addToPage(page, { x: 40, y: 200, width: 400, height: 24 });
  f.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText("Full name"));

  const app = await appearances(pdf);
  f.setText(value);
  app.note(f, value);
  const dropped = await app.finish();
  const bytes = await pdf.save({ updateFieldAppearances: false });
  const back = await PDFDocument.load(bytes);
  return { dropped, got: back.getForm().getTextField("field0").getText(), bytes };
}

test("desktop: a Chinese value exports instead of aborting the whole document", async () => {
  const { dropped, got, bytes } = await fillOne("陳偉明");
  assert.deepEqual(dropped, [], "the CJK value should have been drawn with an embedded font");
  assert.equal(got, "陳偉明");
  assert.ok(bytes.length > 0);
});

test("desktop: a Devanagari value exports", async () => {
  const { dropped, got } = await fillOne("राजेश कुमार");
  assert.deepEqual(dropped, []);
  assert.equal(got, "राजेश कुमार");
});

test("desktop: a script with no shipped font is reported, not silently lost, and the rest of the document still saves", async () => {
  const { dropped, got, bytes } = await fillOne("முருகன்"); // Tamil — no font in public/fonts
  assert.equal(dropped.length, 1, "the undrawable value must be reported to the UI");
  assert.equal(dropped[0].value, "முருகன்");
  assert.ok(!got, "the box is left blank for manual entry rather than filled with junk");
  assert.ok(bytes.length > 0, "the document must still export");
});

test("desktop: an ordinary Latin value is unaffected", async () => {
  const { dropped, got } = await fillOne("John Smith");
  assert.deepEqual(dropped, []);
  assert.equal(got, "John Smith");
});
