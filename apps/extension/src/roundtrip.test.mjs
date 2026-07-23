// THE FULL LOOP, per language: type onto a form -> capture -> store in the vault -> come back to
// a form later and have it FILL. Web and PDF, same vault, same expectations.
//
// Why this test exists. Every language bug so far was found one at a time, by hand, on a real
// form — because each piece was unit-tested in isolation and nothing exercised the loop the user
// actually lives in. This test is the loop. It caught, on its first run, that a captured key
// never filled ANYTHING in any language (including English): the resolver matched only through
// its English concept table, and its key normaliser was ASCII-only, so every non-Latin vault key
// collapsed to the same empty string and they overwrote one another. Captured data was write-only.
//
// A new language belongs in SAMPLES. If the loop does not close for it, it is not supported.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { PDFDocument, PDFHexString, PDFName } from "../vendor/pdf-lib.esm.min.js";
import { collectTypedValues, newInformation } from "./pagecapture.js";
import { keyFromLabel, isCapturableLabel } from "./vaultkey.js";
import { resolveFields } from "./resolver.js";
import { fillPdfBytes } from "./pdffill.js";

// A user filling a form in their own language: the form's own labels, the values they'd type.
const SAMPLES = [
  { lang: "Japanese", fields: [["氏名", "田中太郎"], ["電話番号", "03-1234-5678"]] },
  { lang: "Chinese", fields: [["全名", "陳偉明"], ["電話號碼", "5555-1234"]] },
  { lang: "Hindi", fields: [["पूरा नाम", "राजेश कुमार"], ["शहर", "मुंबई"]] },
  { lang: "Tamil", fields: [["முழு பெயர்", "முருகன்"], ["நகரம்", "சென்னை"]] },
  { lang: "Arabic", fields: [["الاسم الكامل", "محمد علي"], ["المدينة", "دبي"]] },
  { lang: "Korean", fields: [["성명", "김민준"], ["도시", "서울"]] },
  { lang: "Russian", fields: [["Полное имя", "Иван Петров"], ["Город", "Москва"]] },
  { lang: "English", fields: [["Employee ID", "E-4471"], ["Badge colour", "blue"]] },
];

function page(fields) {
  const html = fields
    .map(([label, value], i) => `<label for="f${i}">${label}</label><input id="f${i}" name="f${i}" value="${value}">`)
    .join("");
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: "https://example.test/" });
  globalThis.document = dom.window.document;
  return dom;
}

// ---- 1. CAPTURE: what the user typed is offered, keyed in their own script ------------------
for (const s of SAMPLES) {
  test(`${s.lang}: what was typed is captured, keyed in its own script`, () => {
    page(s.fields);
    const proposed = newInformation(collectTypedValues(), {}, keyFromLabel, isCapturableLabel);
    assert.deepEqual(
      proposed.map((p) => [p.label, p.value]),
      s.fields,
      `${s.lang}: every typed value should be offered for capture`,
    );
    for (const p of proposed) assert.ok(p.key.length > 0, `${s.lang}: "${p.label}" produced an empty key`);
    // Distinct labels MUST produce distinct keys, or they overwrite each other in the vault.
    assert.equal(new Set(proposed.map((p) => p.key)).size, proposed.length, `${s.lang}: keys collided`);
  });
}

// ---- 2. REFILL (web): the captured vault fills the same form next time ----------------------
for (const s of SAMPLES) {
  test(`${s.lang}: the captured values fill the same web form next time`, async () => {
    page(s.fields);
    const vault = {};
    for (const p of newInformation(collectTypedValues(), {}, keyFromLabel, isCapturableLabel)) vault[p.key] = p.value;

    // A fresh, EMPTY copy of the same form.
    const dom = page(s.fields.map(([label]) => [label, ""]));
    for (const k of ["window", "HTMLInputElement", "HTMLTextAreaElement", "Event", "HTMLElement"]) {
      globalThis[k] = k === "window" ? dom.window : dom.window[k];
    }
    const { fillPage } = await import("./pagefill.js");
    await fillPage(vault, null);
    s.fields.forEach(([label, value], i) => {
      assert.equal(
        dom.window.document.getElementById(`f${i}`).value, value,
        `${s.lang}: "${label}" should have been filled from the captured vault`,
      );
    });
  });
}

// ---- 3. REFILL (PDF): the same vault fills a PDF whose fields carry those labels -------------
for (const s of SAMPLES) {
  test(`${s.lang}: the captured values fill a PDF with the same labels`, async () => {
    const vault = {};
    for (const [label, value] of s.fields) vault[keyFromLabel(label)] = value;

    const doc = await PDFDocument.create();
    const pg = doc.addPage([600, 400]);
    const form = doc.getForm();
    s.fields.forEach(([label], i) => {
      const f = form.createTextField(`field${i}`);
      f.addToPage(pg, { x: 40, y: 340 - i * 40, width: 400, height: 24 });
      f.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText(label)); // the printed caption
    });

    const r = await fillPdfBytes(await doc.save(), vault);
    assert.deepEqual(r.unencodable, [], `${s.lang}: nothing should be undrawable`);
    const back = await PDFDocument.load(r.bytes);
    s.fields.forEach(([label, value], i) => {
      assert.equal(
        back.getForm().getTextField(`field${i}`).getText(), value,
        `${s.lang}: PDF field "${label}" should have been filled`,
      );
    });
  });
}

// ---- 4. The resolver must not lose keys that differ only outside ASCII ----------------------
test("vault keys in a non-Latin script stay DISTINCT (they used to collapse into one)", () => {
  const vault = { 氏名: "田中太郎", 生年月日: "1990-01-15", 電話番号: "03-1234-5678" };
  const got = resolveFields(vault, [{ label: "氏名" }, { label: "生年月日" }, { label: "電話番号" }]);
  assert.deepEqual(got, ["田中太郎", "1990-01-15", "03-1234-5678"]);
});

test("a concept still wins when the user has no key of their own for that label", () => {
  // "Full name" isn't a key in this vault; the English concept table must still resolve it.
  const got = resolveFields({ full_name: "Asha Rao" }, [{ label: "Name of applicant" }]);
  assert.equal(got[0], "Asha Rao");
});
