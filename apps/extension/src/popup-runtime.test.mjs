// The other i18n tests assert MARKUP and WIRING. This one RUNS the localisation: it loads the real
// popup.html into jsdom, executes the same applyI18n logic the popup executes, and checks that the
// visible text actually changes language. Static assertions cannot catch a runtime bug — a wrong
// dataset property name, an element read before it exists, a selector typo — and those are exactly
// the bugs that ship a half-English popup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { UI_LANGS, translator, dirOf, t } from "./i18n.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "popup.html"), "utf8");

/**
 * The popup's own localisation step, kept identical to popup.js. (popup.js itself cannot be
 * imported here: it runs chrome.* API calls at module scope.) `popup-i18n.test.mjs` asserts
 * popup.js still contains this logic, so the two cannot drift apart silently.
 */
function applyI18n(document, lang) {
  const tr = translator(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = dirOf(lang);
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = tr(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = tr(el.dataset.i18nPlaceholder);
}

const load = () => new JSDOM(html).window.document;

test("switching language actually rewrites the popup's visible text", () => {
  const doc = load();
  const before = doc.getElementById("fill").textContent;
  applyI18n(doc, "ta");
  const after = doc.getElementById("fill").textContent;
  assert.notEqual(after, before, "the Fill button did not change");
  assert.equal(after, t("ta", "fill.page"));
  assert.equal(doc.getElementById("lock").textContent, t("ta", "lock.button"));
  assert.equal(doc.getElementById("unlock").textContent, t("ta", "unlock.button"));
});

test("placeholders are rewritten too, not just labels", () => {
  const doc = load();
  applyI18n(doc, "ja");
  assert.equal(doc.getElementById("pass").placeholder, t("ja", "unlock.placeholder"));
  assert.equal(doc.getElementById("newKey").placeholder, t("ja", "vault.addField"));
  assert.equal(doc.getElementById("newVal").placeholder, t("ja", "vault.addValue"));
});

test("EVERY translatable element changes when the language changes", () => {
  const doc = load();
  applyI18n(doc, "en");
  const english = [...doc.querySelectorAll("[data-i18n]")].map((el) => el.textContent);
  applyI18n(doc, "kn");
  const kannada = [...doc.querySelectorAll("[data-i18n]")].map((el) => el.textContent);
  const unchanged = english
    .map((v, i) => (v === kannada[i] ? doc.querySelectorAll("[data-i18n]")[i].dataset.i18n : null))
    .filter(Boolean)
    .filter((k) => k !== "app.name"); // the product name is the same everywhere by design
  assert.deepEqual(unchanged, [], `these stayed English in Kannada: ${unchanged.join(", ")}`);
});

test("an RTL language flips the document direction", () => {
  const doc = load();
  applyI18n(doc, "ar");
  assert.equal(doc.documentElement.dir, "rtl");
  assert.equal(doc.documentElement.lang, "ar");
  applyI18n(doc, "hi");
  assert.equal(doc.documentElement.dir, "ltr");
});

test("the language list can be built and every entry is selectable", () => {
  const doc = load();
  const sel = doc.getElementById("uiLang");
  assert.ok(sel, "the picker is missing from popup.html");
  for (const [code, label] of Object.entries(UI_LANGS)) {
    const o = doc.createElement("option");
    o.value = code; o.textContent = label;
    sel.appendChild(o);
  }
  assert.equal(sel.options.length, Object.keys(UI_LANGS).length);
  sel.value = "te";
  assert.equal(sel.value, "te", "choosing a language does not stick");
});

test("switching back and forth leaves no residue", () => {
  const doc = load();
  applyI18n(doc, "en");
  const english = doc.getElementById("learnPage").textContent;
  applyI18n(doc, "ru");
  applyI18n(doc, "en");
  assert.equal(doc.getElementById("learnPage").textContent, english);
});
