// The vault's signature pad drew in black and nothing else. That is a real-world problem, not a
// cosmetic one: many authorities require BLUE ink and will reject a form signed in black (and a
// few require a specific colour). The pad now offers the common inks in one click plus a full
// colour picker, and remembers the choice.
//
// The Sign tool (sign.js) and the desktop SignPad already had a colour control — this closes the
// gap on the one pad that did not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STRINGS } from "./i18n.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "popup.html"), "utf8");
const js = readFileSync(join(here, "popup.js"), "utf8");

test("the signature pad offers the whole spectrum, not just black", () => {
  assert.ok(/<input id="sigColor"[^>]*type="color"/.test(html),
    "there is no colour input — the user cannot reach an arbitrary colour");
  assert.ok(html.includes('id="sigSwatches"'), "there are no one-click ink swatches");
});

test("blue is among the quick inks (the colour authorities most often demand)", () => {
  const inks = js.match(/const INKS = \[[\s\S]*?\];/);
  assert.ok(inks, "the ink list is missing");
  assert.ok(/"Blue"/.test(inks[0]), "blue must be a one-click choice");
  assert.ok(/"Black"/.test(inks[0]) && /"Red"/.test(inks[0]), "black and red should be there too");
});

test("the chosen ink and thickness are applied to the canvas and remembered", () => {
  assert.ok(js.includes("ctx.strokeStyle = hex"), "choosing a colour does not change the ink");
  assert.ok(js.includes("chrome.storage.local.set({ sigInk"), "the ink choice is not remembered");
  assert.ok(js.includes("chrome.storage.local.set({ sigWidth"), "the thickness is not remembered");
  assert.ok(js.includes('chrome.storage.local.get(["sigInk", "sigWidth"])'), "the choice is never restored");
});

test("changing the ink does not wipe what is already drawn", () => {
  // applyInk must not clear the canvas — a two-colour signature has to be possible, and losing a
  // half-drawn signature to a colour click would be infuriating.
  const fn = js.match(/const applyInk = [^;]*;/);
  assert.ok(fn, "applyInk is missing");
  assert.ok(!/clearRect/.test(fn[0]), "changing colour must not clear the pad");
});

test("the ink controls are labelled in the user's language", () => {
  assert.ok(html.includes('data-i18n="sig.ink"'), "the ink label is hard-coded English");
  assert.ok(html.includes('data-i18n="sig.thickness"'), "the thickness label is hard-coded English");
  assert.ok("sig.ink" in STRINGS.en && "sig.thickness" in STRINGS.en, "the labels are not in the catalogue");
});
