import { test } from "node:test";
import assert from "node:assert/strict";
import { detectScript, flores, tessPack, isKnown, allLangs, textLayerLooksBad } from "./langcodes.js";

test("textLayerLooksBad flags empty + legacy-font garbage, passes real English", () => {
  assert.equal(textLayerLooksBad(""), true);
  assert.equal(textLayerLooksBad("2 aea)€Sdd*rdd ct& adJrJ dd ವರ್ಷ".replace(/[^\x00-\x7f]/g, "")), true); // Kannada legacy-font extract (garbage Latin+symbols)
  assert.equal(textLayerLooksBad("Surname Given and middle names Date of birth Place of birth Nationality"), false);
});

test("detects Indic + CJK + other scripts (not just the old 8)", () => {
  assert.equal(detectScript("ನಮೂನೆ ಕರ್ನಾಟಕ ಸ್ಟ್ಯಾಂಪ್").lang, "kn"); // Kannada
  assert.equal(detectScript("தமிழ் படிவம்").lang, "ta");               // Tamil
  assert.equal(detectScript("తెలుగు").lang, "te");                     // Telugu
  assert.equal(detectScript("മലയാളം").lang, "ml");                    // Malayalam
  assert.equal(detectScript("বাংলা").lang, "bn");                      // Bengali
  assert.equal(detectScript("ગુજરાતી").lang, "gu");                    // Gujarati
  assert.equal(detectScript("한국어 양식").lang, "ko");                 // Korean
  assert.equal(detectScript("ไทย").lang, "th");                        // Thai
  assert.equal(detectScript("日本語のかな").lang, "ja");                // Japanese kana
});
test("Latin text returns null (falls back to the word-vote detector)", () => {
  assert.equal(detectScript("Surname Given names Date of birth"), null);
});
test("FLORES + Tesseract codes resolve for translation & OCR routing", () => {
  assert.equal(flores("kn"), "kan_Knda");
  assert.equal(tessPack("kn"), "kan");
  assert.equal(flores("en"), "eng_Latn");
  assert.equal(tessPack("ta"), "tam");
});
test("registry is a broad set, not the legacy 8", () => {
  assert.ok(allLangs().length >= 25);
  for (const l of ["kn", "ta", "te", "ml", "bn", "gu", "pa", "or", "ur", "ja", "ko", "th", "he", "el"]) assert.ok(isKnown(l), `${l} missing`);
});
