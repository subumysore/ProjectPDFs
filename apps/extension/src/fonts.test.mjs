// Every script the engine claims it can write must ACTUALLY be writable: detected correctly,
// its font served by the asset host, embedded by fontkit, and read back out of the saved PDF.
//
// This is the test that would have caught the state this shipped in: `fonts.js` listed two
// scripts, so a Tamil or Japanese value was quietly reported as unfillable — the engine was
// honest about it, but the product could not do the thing it exists to do. A script is only in
// the table if this test proves it round-trips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "../vendor/pdf-lib.esm.min.js";
import { scriptOf, canEmbed, FONT_FILE_FOR } from "./fonts.js";
import { fillPdfBytes } from "./pdffill.js";

// One real word per script, in that script — the value a user would actually have in their vault.
const SAMPLES = [
  { id: "hi", text: "राजेश कुमार", lang: "Hindi" },
  { id: "bn", text: "রাজেশ", lang: "Bengali" },
  { id: "gu", text: "રાજેશ", lang: "Gujarati" },
  { id: "pa", text: "ਰਾਜੇਸ਼", lang: "Punjabi" },
  { id: "kn", text: "ರಾಜೇಶ್", lang: "Kannada" },
  { id: "ml", text: "രാജേഷ്", lang: "Malayalam" },
  { id: "ta", text: "முருகன்", lang: "Tamil" },
  { id: "te", text: "రాజేష్", lang: "Telugu" },
  { id: "ar", text: "محمد علي", lang: "Arabic" },
  { id: "he", text: "דוד כהן", lang: "Hebrew" },
  { id: "th", text: "สมชาย", lang: "Thai" },
  { id: "zh", text: "陳偉明", lang: "Chinese" },
  { id: "ja", text: "さくら", lang: "Japanese" },
  { id: "ko", text: "김민준", lang: "Korean" },
  { id: "cyrl", text: "Иван Петров", lang: "Russian" },
  { id: "grek", text: "Ψυχή", lang: "Greek" },
];

test("each sample is detected as its own script", () => {
  for (const s of SAMPLES) {
    assert.equal(scriptOf(s.text), s.id, `${s.lang}: "${s.text}" detected as ${scriptOf(s.text)}`);
    assert.ok(canEmbed(s.text), `${s.lang} claims to be embeddable`);
  }
});

test("Japanese and Korean are NOT routed to the Chinese font", () => {
  // Japanese and Korean text contains Han characters too. Routing them to the Simplified-Chinese
  // font would drop every kana and every Hangul syllable — a half-written name, silently.
  assert.equal(scriptOf("東京さくら"), "ja", "kana must win over Han");
  assert.equal(scriptOf("서울시 김민준"), "ko", "Hangul must win over Han");
  assert.equal(scriptOf("陳偉明"), "zh");
});

test("Latin (including accents) still uses the built-in font", () => {
  for (const t of ["John Smith", "Vollständiger Name", "José Ángel", ""]) {
    assert.equal(scriptOf(t), "latin", `"${t}"`);
  }
});

// A real fill per script: the value goes through the whole engine (resolver → appearances →
// save) and must come back out of the saved bytes intact, with nothing reported as undrawable.
for (const s of SAMPLES) {
  test(`${s.lang}: the value is embedded and survives a save/reload`, async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 300]);
    const field = doc.getForm().createTextField("full_name");
    field.addToPage(page, { x: 40, y: 200, width: 400, height: 24 });
    const blank = await doc.save();

    const r = await fillPdfBytes(blank, { full_name: s.text });
    assert.ok(r.bytes, `${s.lang}: the document must export`);
    assert.deepEqual(r.unencodable, [], `${s.lang}: nothing should be reported as undrawable`);

    const back = await PDFDocument.load(r.bytes);
    assert.equal(back.getForm().getTextField("full_name").getText(), s.text);
  });
}

test("the font table and the asset host agree — every listed font is actually served", async () => {
  const BASE = "https://objectstorage.us-ashburn-1.oraclecloud.com/p/MeK_72_tOM4xQH7J-bSokMlJ14erObpr5QYjeVFi-Oh7PsQt-jtjyzA4YGyJRSyP/n/idlqdkwlstnb/b/polyglotformfill-dl/o/fonts/";
  for (const [id, file] of Object.entries(FONT_FILE_FOR)) {
    const res = await fetch(BASE + file);
    assert.ok(res.ok, `${id}: ${file} is in the table but the host returns HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const sig = String.fromCharCode(...buf.slice(0, 4));
    const ok = sig === "OTTO" || sig === "true" || sig === "ttcf" ||
      (buf[0] === 0 && buf[1] === 1 && buf[2] === 0 && buf[3] === 0);
    assert.ok(ok, `${id}: ${file} is served but is not a font file`);
  }
});
