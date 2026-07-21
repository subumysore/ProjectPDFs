// Regression suite for dropdown/checkbox option matching (optmatch.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzyOptionMatch, pickOption } from "./optmatch.js";

test("nationality: 'Indian' selects an 'India' or 'Indian' option", () => {
  assert.equal(pickOption(["United States", "India", "Canada"], "Indian"), "India");
  assert.equal(pickOption(["Indian", "American"], "Indian"), "Indian");
});

test("case/spacing/punctuation are ignored", () => {
  assert.equal(pickOption(["United States", "United Kingdom"], "united-kingdom"), "United Kingdom");
});

test("gender: 'Male' matches 'M' (and does not match 'Married')", () => {
  assert.equal(fuzzyOptionMatch("Male", "male"), true);
  assert.equal(fuzzyOptionMatch("Married", "M"), false); // single letter can't prefix-match
  assert.equal(fuzzyOptionMatch("Male", "F"), false);
});

test("no false positives on unrelated options", () => {
  assert.equal(pickOption(["Email", "Phone", "Fax"], "Indian"), null);
  assert.equal(fuzzyOptionMatch("Canada", "India"), false);
});

test("empty value yields no match", () => {
  assert.equal(pickOption(["A", "B"], ""), null);
  assert.equal(pickOption(["A", "B"], null), null);
});
