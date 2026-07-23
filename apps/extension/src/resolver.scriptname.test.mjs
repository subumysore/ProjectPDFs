// Script-qualified name fields (added 2026-07-23).
//
// Found by filling the real HK Civil Service form (GF340): its `ChineseName` field was being
// filled with the Latin given name "Wei" while the vault held 陳偉. For a product whose whole
// claim is language-aware filling, writing the wrong script into a field that names its script
// is worse than leaving it blank - so when there is no matching value we now fill nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFields } from "./resolver.js";

const ask = (vault, label) => resolveFields(vault, [{ label, maxLength: -1 }])[0];

const VAULT = {
  full_name: "Li Wei Chen",
  first_name: "Wei",
  last_name: "Chen",
  chinese_name: "陳偉",
};

test("a Chinese name field gets the CHINESE name, not the Latin one", () => {
  assert.equal(ask(VAULT, "ChineseName"), "陳偉");
  assert.equal(ask(VAULT, "Chinese Name"), "陳偉");
  assert.equal(ask(VAULT, "form1[0].Page2[0].ChineseName[0]"), "陳偉");
});

test("with NO stored Chinese name the field is left EMPTY, never the Latin name", () => {
  const v = { full_name: "Li Wei Chen", first_name: "Wei", last_name: "Chen" };
  assert.equal(ask(v, "Chinese Name"), null, "must not fall back to the Latin name");
});

test("other scripts work the same way", () => {
  assert.equal(ask({ arabic_name: "علي" }, "Arabic name"), "علي");
  assert.equal(ask({ hindi_name: "अमित" }, "Hindi name"), "अमित");
  assert.equal(ask({ tamil_name: "அருண்" }, "Tamil name"), "அருண்");
  assert.equal(ask({ native_name: "தமிழ்" }, "Name in native script"), "தமிழ்");
});

test("alternative vault key phrasings are found", () => {
  assert.equal(ask({ "name in chinese": "陳偉" }, "Chinese name"), "陳偉");
});

test("an ENGLISH name field still gets the ordinary Latin name", () => {
  // "english" is deliberately NOT a script qualifier - it means the normal name.
  assert.equal(ask(VAULT, "English name"), "Li Wei Chen");
});

test("plain name fields are unaffected", () => {
  assert.equal(ask(VAULT, "Full name"), "Li Wei Chen");
  assert.equal(ask(VAULT, "Surname"), "Chen");
  assert.equal(ask(VAULT, "Given name"), "Wei");
});

test("a script word WITHOUT 'name' is not hijacked", () => {
  // e.g. "Chinese nationality" must not be treated as a script-qualified name field.
  assert.notEqual(ask({ ...VAULT, nationality: "Singaporean" }, "Nationality"), "陳偉");
});

test("EXPLICIT full name beats one composed from leftover atoms", () => {
  // Regression for the same session's B3/B8: a Full Name field used to get just "Wei" when
  // another field had already claimed the surname.
  const out = resolveFields(VAULT, [
    { label: "EnglishSurname", maxLength: -1 },
    { label: "FullName", maxLength: -1 },
  ]);
  assert.equal(out[0], "Chen");
  assert.equal(out[1], "Li Wei Chen");
});
