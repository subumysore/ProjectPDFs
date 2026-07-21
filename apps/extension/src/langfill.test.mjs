import { test } from "node:test";
import assert from "node:assert/strict";
import { fillValuesInLanguage } from "./langfill.js";

const VAULT = { last_name: "MYSORE", first_name: "SUBRAMANYA", cell_phone: "98450 12345", occupation: "self employed consultant", date_of_birth: "11/30/1968" };
const get = (rows, cap) => rows.find((r) => r && r.caption === cap);

test("names/numbers are TRANSLITERATED to the target script", async () => {
  const rows = await fillValuesInLanguage(["Last name", "Cell phone"], VAULT, "hi");
  assert.equal(get(rows, "Last name").outputValue, "म्य्सोरे");   // MYSORE → Devanagari
  assert.equal(get(rows, "Cell phone").outputValue, "९८४५० १२३४५"); // digits localised
});

test("Cyrillic + Arabic scripts", async () => {
  assert.equal((await fillValuesInLanguage(["Last name"], VAULT, "ru"))[0].outputValue, "мысоре");
  assert.equal((await fillValuesInLanguage(["Last name"], VAULT, "ar"))[0].outputValue, "ميسوري");
});

test("real phrases are TRANSLATED via the injected translator, not transliterated", async () => {
  const tr = async (t, from, to) => `«${t}»@${to}`; // mock on-device translator
  const rows = await fillValuesInLanguage(["Current profession or occupation"], VAULT, "hi", tr);
  assert.equal(rows[0].outputValue, "«self employed consultant»@hi");
});

test("outputLang 'en' leaves values exactly as stored (no change)", async () => {
  const rows = await fillValuesInLanguage(["Last name", "Cell phone"], VAULT, "en");
  assert.equal(get(rows, "Last name").outputValue, "MYSORE");
  assert.equal(get(rows, "Cell phone").outputValue, "98450 12345");
});

test("unresolved captions yield null (nothing invented)", async () => {
  const rows = await fillValuesInLanguage(["Favourite colour"], VAULT, "hi");
  assert.equal(rows[0], null);
});
