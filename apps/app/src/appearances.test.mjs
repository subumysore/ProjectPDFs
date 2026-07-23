// DESKTOP-side proof of the bug the extension had: one CJK/Indic value used to abort the ENTIRE
// PDF export (`WinAnsi cannot encode`, thrown at save time after every field was set), so a user
// filling a Chinese form got no file at all. The desktop has its own pdf-lib and its own fill path
// in src/pdf.ts, so fixing the shared engine did NOT fix the .exe — this covers the desktop half.
//
// Fonts are no longer bundled in the installer: the app fetches a script's font on first use and
// caches it in app-data (Rust `script_font`). That fetch needs Tauri, so here the picker is
// injected and reads the SAME Noto files from the asset host — the identical bytes the app
// downloads, embedded through the desktop's own pdf-lib and fontkit.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// fontkit shapes Indic scripts through a regenerator-compiled path: without this, embedding a
// Devanagari or Tamil font throws `regeneratorRuntime is not defined`. fill/fonts.ts imports it
// for the same reason - the test must load the same runtime the app does.
import "regenerator-runtime/runtime.js";
import { PDFDocument, PDFHexString, PDFName, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { appearances } from "./fill/appearances.ts";

const HOST = "https://objectstorage.us-ashburn-1.oraclecloud.com/p/MeK_72_tOM4xQH7J-bSokMlJ14erObpr5QYjeVFi-Oh7PsQt-jtjyzA4YGyJRSyP/n/idlqdkwlstnb/b/polyglotformfill-dl/o/fonts/";
const CACHE = join(tmpdir(), "ppf-font-test-cache");

// Mirrors the app's script table for the scripts under test. Kept explicit here so the test
// fails loudly if the hosted file names ever change.
const FOR_SCRIPT = [
  { id: "zh", test: /\p{Script=Han}/u, file: "NotoSansSC-Regular.otf" },
  { id: "hi", test: /\p{Script=Devanagari}/u, file: "NotoSansDevanagari-Regular.ttf" },
  { id: "ta", test: /\p{Script=Tamil}/u, file: "NotoSansTamil-Regular.ttf" },
  { id: "ja", test: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, file: "NotoSansJP-Regular.otf" },
  // Gurmukhi and Malayalam are here deliberately: their mark glyphs hit the upstream fontkit
  // NULL-anchor crash that `patches/@pdf-lib__fontkit.patch` fixes. If that patch is ever lost on
  // a dependency bump, these two fail and say exactly which scripts stopped working.
  { id: "pa", test: /\p{Script=Gurmukhi}/u, file: "NotoSansGurmukhi-Regular.ttf" },
  { id: "ml", test: /\p{Script=Malayalam}/u, file: "NotoSansMalayalam-Regular.ttf" },
];

async function fontBytes(file) {
  await mkdir(CACHE, { recursive: true });
  const path = join(CACHE, file);
  if (existsSync(path)) return readFile(path);
  const res = await fetch(HOST + file);
  assert.ok(res.ok, `${file} must be served by the asset host (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(path, buf);
  return buf;
}

// The same contract as fill/fonts.ts makeFontPicker, minus the Tauri fetch.
const makeTestPicker = async (pdf) => {
  pdf.registerFontkit(fontkit);
  const latin = await pdf.embedFont(StandardFonts.Helvetica);
  const cache = {};
  return async (text) => {
    const s = FOR_SCRIPT.find((x) => x.test.test(text));
    if (!s) return latin;
    if (!cache[s.id]) {
      cache[s.id] = await pdf.embedFont(new Uint8Array(await fontBytes(s.file)), { subset: true });
    }
    return cache[s.id];
  };
};

async function fillOne(value, picker = makeTestPicker) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 300]);
  const form = pdf.getForm();
  const f = form.createTextField("field0");
  f.addToPage(page, { x: 40, y: 200, width: 400, height: 24 });
  f.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText("Full name"));

  const app = await appearances(pdf, picker);
  f.setText(value);
  app.note(f, value);
  const dropped = await app.finish();
  const bytes = await pdf.save({ updateFieldAppearances: false });
  const back = await PDFDocument.load(bytes);
  return { dropped, got: back.getForm().getTextField("field0").getText(), bytes };
}

before(async () => {
  // Fail fast and clearly if the host isn't serving fonts at all, rather than as four odd
  // assertion failures further down.
  const res = await fetch(HOST + "NotoSansTamil-Regular.ttf", { method: "GET" });
  assert.ok(res.ok, "the asset host must serve the script fonts");
});

for (const { value, label } of [
  { value: "陳偉明", label: "Chinese" },
  { value: "राजेश कुमार", label: "Hindi (Devanagari)" },
  { value: "முருகன்", label: "Tamil" },
  { value: "さくら", label: "Japanese (kana)" },
  { value: "ਰਾਜੇਸ਼", label: "Punjabi (Gurmukhi)" },
  { value: "രാജേഷ്", label: "Malayalam" },
]) {
  test(`desktop: a ${label} value is embedded and exported, not dropped`, async () => {
    const { dropped, got, bytes } = await fillOne(value);
    assert.deepEqual(dropped, [], `${label} should have been drawn with its own font`);
    assert.equal(got, value);
    assert.ok(bytes.length > 0);
  });
}

test("desktop: a script with no font available is reported, not silently lost, and the document still saves", async () => {
  // Picker that can only do Latin — what the app falls back to when a script has no hosted font
  // or the device is offline on first use of that script.
  const latinOnly = async (pdf) => {
    const latin = await pdf.embedFont(StandardFonts.Helvetica);
    return async () => latin;
  };
  const { dropped, got, bytes } = await fillOne("Ψυχή", latinOnly);
  assert.equal(dropped.length, 1, "the undrawable value must be reported to the UI");
  assert.ok(!got, "the box is left blank for manual entry rather than filled with junk");
  assert.ok(bytes.length > 0, "the document must still export");
});

test("desktop: an ordinary Latin value is unaffected", async () => {
  const { dropped, got } = await fillOne("John Smith");
  assert.deepEqual(dropped, []);
  assert.equal(got, "John Smith");
});
