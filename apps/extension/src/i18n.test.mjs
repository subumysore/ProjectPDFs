// A half-translated UI is worse than an English one: the user sees their language and then hits an
// English button and no longer trusts what the app is telling them. So "missing translation" is a
// BUILD FAILURE here, not a silent fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STRINGS, AVAILABLE, UI_LANGS, RTL, dirOf, t, translator, detectUiLang } from "./i18n.js";

const KEYS = Object.keys(STRINGS.en);

test("every language translates every key — no gaps, no leftovers", () => {
  for (const lang of AVAILABLE) {
    if (lang === "en") continue;
    const missing = KEYS.filter((k) => !STRINGS[lang][k]);
    const extra = Object.keys(STRINGS[lang]).filter((k) => !KEYS.includes(k));
    assert.deepEqual(missing, [], `${lang}: missing ${missing.length} key(s): ${missing.join(", ")}`);
    assert.deepEqual(extra, [], `${lang}: has key(s) English doesn't: ${extra.join(", ")}`);
  }
});

test("nothing is left in English by accident", () => {
  // A translation identical to English is nearly always an untranslated string. Proper nouns and
  // a few borrowed words legitimately match, so those keys are listed explicitly.
  const SAME_IS_FINE = new Set(["app.name"]);
  const BORROWED_OK = new Set(["id", "pt", "es", "fr", "de", "vi", "tr"]); // Latin-script langs share some words
  for (const lang of AVAILABLE) {
    if (lang === "en" || BORROWED_OK.has(lang)) continue;
    for (const k of KEYS) {
      if (SAME_IS_FINE.has(k)) continue;
      assert.notEqual(STRINGS[lang][k], STRINGS.en[k], `${lang}: "${k}" is still the English text`);
    }
  }
});

test("every catalogue language is offered in the picker, labelled in its own language", () => {
  for (const lang of AVAILABLE) {
    assert.ok(UI_LANGS[lang], `${lang} has strings but is not offered in UI_LANGS`);
  }
  // The label must be in the language itself — "日本語", never "Japanese".
  assert.equal(UI_LANGS.ja, "日本語");
  assert.equal(UI_LANGS.ta, "தமிழ்");
  assert.equal(UI_LANGS.ar, "العربية");
});

test("placeholders survive translation in every language", () => {
  for (const lang of AVAILABLE) {
    for (const k of KEYS) {
      const enHas = /\{(\w+)\}/.test(STRINGS.en[k]);
      const trHas = /\{(\w+)\}/.test(STRINGS[lang][k]);
      assert.equal(trHas, enHas, `${lang}: "${k}" placeholder mismatch — a dropped {n} loses the number`);
    }
  }
});

test("placeholders are substituted", () => {
  assert.equal(t("en", "fill.done", { n: 7 }), "Filled 7 field(s).");
  assert.ok(t("hi", "fill.done", { n: 7 }).includes("7"));
  assert.ok(t("ja", "learn.saved", { n: 3 }).includes("3"));
});

test("right-to-left languages are marked and get dir=rtl", () => {
  for (const lang of ["ar", "he", "ur", "fa"]) {
    assert.ok(RTL.has(lang), `${lang} must be marked RTL`);
    assert.equal(dirOf(lang), "rtl");
  }
  assert.equal(dirOf("en"), "ltr");
  assert.equal(dirOf("ja"), "ltr");
});

test("an unknown language falls back to English rather than breaking", () => {
  assert.equal(t("xx", "action.save"), "Save");
  assert.equal(t("en", "no.such.key"), "no.such.key");
});

test("the browser's preferred language is honoured, including regional tags", () => {
  assert.equal(detectUiLang(["ta-IN", "en-US"]), "ta");
  assert.equal(detectUiLang(["pt-BR"]), "pt");
  assert.equal(detectUiLang(["xx-YY", "ja"]), "ja");
  assert.equal(detectUiLang([]), "en");
  assert.equal(detectUiLang(["kl-GL"]), "en", "an unsupported language must not throw");
});

test("translator() binds a language", () => {
  const tr = translator("de");
  assert.equal(tr("action.save"), "Speichern");
});

test("no string carries markup that a translation could break", () => {
  for (const lang of AVAILABLE) {
    for (const k of KEYS) {
      assert.ok(!/[<>]/.test(STRINGS[lang][k]), `${lang}: "${k}" contains markup`);
    }
  }
});
