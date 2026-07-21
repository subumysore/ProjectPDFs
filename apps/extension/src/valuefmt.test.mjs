// Regression suite for value-translation gating (valuefmt.js). Guards the bug where a
// person's name was machine-translated into a wrong word ("Mexico") in the side panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTranslatableValue } from "./valuefmt.js";

test("names are NOT translated (shown verbatim)", () => {
  assert.equal(isTranslatableValue("Pranav Subramanya"), false);
  assert.equal(isTranslatableValue("SUBRAMANYA VISHWANATHAN MYSORE"), false);
  assert.equal(isTranslatableValue("Jane"), false);
});

test("numbers, dates, phones, IDs are NOT translated", () => {
  assert.equal(isTranslatableValue("12"), false);
  assert.equal(isTranslatableValue("05/06/2015"), false);
  assert.equal(isTranslatableValue("(217) 555-0143"), false);
  assert.equal(isTranslatableValue("D1234567"), false);
  assert.equal(isTranslatableValue("62704-0000"), false);
});

test("emails and URLs are NOT translated", () => {
  assert.equal(isTranslatableValue("asha@example.com"), false);
  assert.equal(isTranslatableValue("https://example.com"), false);
});

test("genuine word-phrases ARE translated", () => {
  assert.equal(isTranslatableValue("married"), true);
  assert.equal(isTranslatableValue("self employed"), true);
  assert.equal(isTranslatableValue("prefer not to say"), true);
});

test("empty / whitespace is not translatable", () => {
  assert.equal(isTranslatableValue(""), false);
  assert.equal(isTranslatableValue("   "), false);
  assert.equal(isTranslatableValue(null), false);
});
