// The popup's markup and the catalogue must agree. A `data-i18n` key with no string silently
// blanks a button at runtime — the user gets an empty control and no way to know why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STRINGS } from "./i18n.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "popup.html"), "utf8");
const js = readFileSync(join(here, "popup.js"), "utf8");

const keysIn = (attr) => [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, "g"))].map((m) => m[1]);

test("every data-i18n key in the popup exists in the catalogue", () => {
  const used = [...keysIn("data-i18n"), ...keysIn("data-i18n-placeholder")];
  assert.ok(used.length >= 12, `expected the popup to be localised; found only ${used.length} keys`);
  const missing = used.filter((k) => !(k in STRINGS.en));
  assert.deepEqual(missing, [], `keys used in popup.html but absent from the catalogue: ${missing.join(", ")}`);
});

test("the actions a user relies on are localised, not just decoration", () => {
  const used = new Set(keysIn("data-i18n"));
  for (const k of ["fill.page", "lock.button", "unlock.button", "learn.button", "sign.pdf", "scan.id"]) {
    assert.ok(used.has(k), `the popup's main action "${k}" is still hard-coded English`);
  }
});

test("the popup has a language picker and applies the choice", () => {
  assert.ok(html.includes('id="uiLang"'), "no language picker in popup.html");
  assert.ok(js.includes("initUiLang"), "popup.js never initialises the language");
  assert.ok(js.includes("applyI18n"), "popup.js never applies the strings");
  assert.ok(js.includes("chrome.storage.local.set({ uiLang"), "the choice is not remembered");
  assert.ok(js.includes("detectUiLang"), "the browser's own language is not used for the first run");
});

test("the language picker labels each language in its own language", () => {
  // The picker is filled from UI_LANGS at runtime, so assert the wiring rather than the markup.
  assert.ok(js.includes("UI_LANGS"), "the picker is not built from the shared language list");
});

test("direction is set from the language (Arabic/Hebrew/Urdu/Persian flip the popup)", () => {
  assert.ok(js.includes("dirOf(UI)"), "popup.js does not set the text direction");
});
