// Regression suite for on-device transliteration (translit.js) — writing a value's
// SOUND in the reader's script instead of (mis)translating a name into another word.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toScript } from "./translit.js";

test("Latin-script targets keep the original spelling (a name is written the same)", () => {
  assert.equal(toScript("Pranav Subramanya", "es"), "Pranav Subramanya");
  assert.equal(toScript("Pranav Subramanya", "fr"), "Pranav Subramanya");
  assert.equal(toScript("Pranav Subramanya", "en"), "Pranav Subramanya");
});

test("Chinese passes through (no phonetic letter script)", () => {
  assert.equal(toScript("Pranav", "zh"), "Pranav");
});

test("Hindi: names transliterate into Devanagari, not English", () => {
  const out = toScript("Pranav Subramanya", "hi");
  assert.match(out, /^[ऀ-ॿ\s]+$/); // all Devanagari + spaces, no Latin
  assert.ok(!/[A-Za-z]/.test(out));
});

test("Hindi/Arabic: digits are localised", () => {
  assert.equal(toScript("12", "hi"), "१२");
  assert.equal(toScript("12", "ar"), "١٢");
});

test("Russian: names transliterate into Cyrillic", () => {
  assert.equal(toScript("Ivan", "ru"), "иван");
  assert.ok(!/[A-Za-z]/.test(toScript("Pranav", "ru")));
});

test("empty / whitespace is returned unchanged", () => {
  assert.equal(toScript("", "hi"), "");
  assert.equal(toScript("   ", "hi"), "   ");
});
