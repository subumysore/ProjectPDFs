// Tests for label -> vault key. The ASCII-only predecessor dropped EVERY non-Latin label,
// so new key/value capture silently did nothing on Hindi/Tamil/Telugu/Chinese forms.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyFromLabel, isCapturableLabel } from "./vaultkey.js";

test("plain English labels behave as before", () => {
  assert.equal(keyFromLabel("Date of expiry"), "date_of_expiry");
  assert.equal(keyFromLabel("Full Name"), "full_name");
  assert.equal(keyFromLabel("  Email address  "), "email_address");
});

test("parenthesised asides are dropped", () => {
  assert.equal(keyFromLabel("Name (as shown in passport)"), "name");
  assert.equal(keyFromLabel("Phone (mobile)"), "phone");
});

test("NON-LATIN labels produce real keys instead of being dropped", () => {
  // The whole point: each of these used to yield "" and the captured value was discarded.
  assert.equal(keyFromLabel("पूरा नाम"), "पूरा_नाम");            // Hindi
  assert.equal(keyFromLabel("முழு பெயர்"), "முழு_பெயர்");        // Tamil
  assert.equal(keyFromLabel("పూర్తి పేరు"), "పూర్తి_పేరు");        // Telugu
  assert.equal(keyFromLabel("全名"), "全名");                     // Chinese
  assert.equal(keyFromLabel("الاسم الكامل"), "الاسم_الكامل");    // Arabic
  assert.equal(keyFromLabel("Полное имя"), "полное_имя");        // Russian (has case)
});

test("mixed-script labels keep both parts, aside dropped", () => {
  assert.equal(keyFromLabel("全名 (Full Name)"), "全名");
  assert.equal(keyFromLabel("पूरा नाम / Full Name"), "पूरा_नाम_full_name");
});

test("keys are bounded and never end in a separator", () => {
  const k = keyFromLabel("a".repeat(80));
  assert.equal(k.length, 60);
  const long = keyFromLabel("word ".repeat(30));
  assert.ok(!long.endsWith("_"), "a truncated key must not end with a separator");
  assert.ok(long.length <= 60);
});

test("labels with no letters or digits yield no key", () => {
  assert.equal(keyFromLabel("   "), "");
  assert.equal(keyFromLabel("---"), "");
  assert.equal(keyFromLabel("(   )"), "");
  assert.equal(keyFromLabel(null), "");
  assert.equal(keyFromLabel(undefined), "");
});

test("capturability: real labels yes, numbering no", () => {
  assert.equal(isCapturableLabel("Full Name"), true);
  assert.equal(isCapturableLabel("पूरा नाम"), true);
  assert.equal(isCapturableLabel("全名"), true);
  assert.equal(isCapturableLabel("1"), false, "a row number is not a field name");
  assert.equal(isCapturableLabel("12"), false);
  assert.equal(isCapturableLabel("   "), false);
});

test("the same label always yields the same key (stability)", () => {
  for (const l of ["Date of expiry", "पूरा नाम", "全名"]) {
    assert.equal(keyFromLabel(l), keyFromLabel(l));
  }
});
