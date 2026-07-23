// Cross-script confirmation of the 2026-07-23 language fixes.
//
// The engine must be language-AGNOSTIC (ADR-0018), so verifying two or three scripts is not
// enough: each writing system breaks a different assumption. This file walks a broad set and
// pins the specific trap each one represents.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyFromLabel, isCapturableLabel } from "./vaultkey.js";
import { needsUnicodeFont } from "./pdffill.js";
import { resolveFields } from "./resolver.js";

const ask = (vault, label) => resolveFields(vault, [{ label, maxLength: -1 }])[0];

// label = "full name" written in that language; trap = what this script tests.
const SCRIPTS = [
  { lang: "Hindi",       script: "Devanagari", label: "पूरा नाम",        trap: "vowel signs are Marks, not Letters" },
  { lang: "Marathi",     script: "Devanagari", label: "पूर्ण नाव",        trap: "virama/conjunct" },
  { lang: "Bengali",     script: "Bengali",    label: "পুরো নাম",         trap: "matras" },
  { lang: "Gujarati",    script: "Gujarati",   label: "પૂરું નામ",          trap: "matras" },
  { lang: "Punjabi",     script: "Gurmukhi",   label: "ਪੂਰਾ ਨਾਮ",         trap: "matras" },
  { lang: "Tamil",       script: "Tamil",      label: "முழு பெயர்",       trap: "pulli / long matras" },
  { lang: "Telugu",      script: "Telugu",     label: "పూర్తి పేరు",        trap: "matras" },
  { lang: "Kannada",     script: "Kannada",    label: "ಪೂರ್ಣ ಹೆಸರು",     trap: "matras" },
  { lang: "Malayalam",   script: "Malayalam",  label: "മുഴുവൻ പേര്",      trap: "chillu letters" },
  { lang: "Chinese",     script: "Han",        label: "全名",             trap: "no spaces, no case" },
  { lang: "Japanese",    script: "Kana/Kanji", label: "氏名",             trap: "no spaces, no case" },
  { lang: "Korean",      script: "Hangul",     label: "성명",             trap: "precomposed syllables" },
  { lang: "Arabic",      script: "Arabic",     label: "الاسم الكامل",      trap: "RTL + diacritics" },
  { lang: "Persian",     script: "Arabic",     label: "نام کامل",          trap: "RTL" },
  { lang: "Urdu",        script: "Arabic",     label: "پورا نام",          trap: "RTL" },
  { lang: "Hebrew",      script: "Hebrew",     label: "שם מלא",           trap: "RTL, no case" },
  { lang: "Russian",     script: "Cyrillic",   label: "Полное имя",       trap: "has case" },
  { lang: "Greek",       script: "Greek",      label: "Πλήρες όνομα",     trap: "final sigma + accents" },
  { lang: "Thai",        script: "Thai",       label: "ชื่อเต็ม",           trap: "no word spaces, tone marks" },
  { lang: "Vietnamese",  script: "Latin+",     label: "Họ và tên",        trap: "stacked diacritics" },
  { lang: "Turkish",     script: "Latin+",     label: "Tam İsim",         trap: "dotted capital I case-folds to i+combining dot" },
  { lang: "German",      script: "Latin+",     label: "Vollständiger Name", trap: "umlaut + eszett" },
];

test("every script yields a non-empty, capturable vault key", () => {
  const failures = [];
  for (const s of SCRIPTS) {
    const key = keyFromLabel(s.label);
    if (!key) failures.push(`${s.lang} (${s.script}): empty key — capture would be DROPPED [${s.trap}]`);
    else if (!isCapturableLabel(s.label)) failures.push(`${s.lang}: key "${key}" judged non-capturable`);
  }
  assert.deepEqual(failures, [], "\n" + failures.join("\n"));
});

test("no script loses characters to the separator class", () => {
  // Count letters/digits/marks in the label vs the key: the key may lose only separators.
  const failures = [];
  for (const s of SCRIPTS) {
    const meaningful = (str) => (str.match(/[\p{L}\p{N}\p{M}]/gu) || []).length;
    const before = meaningful(s.label);
    const after = meaningful(keyFromLabel(s.label));
    // Case folding can legitimately ADD a char (Turkish İ -> i + combining dot), never remove.
    if (after < before) {
      failures.push(`${s.lang} (${s.script}): ${before} chars -> ${after} in "${keyFromLabel(s.label)}" [${s.trap}]`);
    }
  }
  assert.deepEqual(failures, [], "\ncharacters lost while building the key:\n" + failures.join("\n"));
});

test("keys are stable and idempotent in every script", () => {
  for (const s of SCRIPTS) {
    const once = keyFromLabel(s.label);
    assert.equal(keyFromLabel(s.label), once, `${s.lang} not deterministic`);
    // Re-keying an existing key must not change it, or a value saved once would never match again.
    assert.equal(keyFromLabel(once), once, `${s.lang}: key "${once}" is not idempotent`);
  }
});

test("distinct labels do not collide onto one key", () => {
  const seen = new Map();
  for (const s of SCRIPTS) {
    const k = keyFromLabel(s.label);
    if (seen.has(k) && seen.get(k) !== s.label) {
      assert.fail(`collision: "${s.label}" (${s.lang}) and "${seen.get(k)}" both -> "${k}"`);
    }
    seen.set(k, s.label);
  }
});

test("non-Latin values are flagged as needing a Unicode font; Latin-1 ones are not", () => {
  for (const s of SCRIPTS) {
    const nonLatin1 = /[^ -ÿ]/.test(s.label);
    assert.equal(
      needsUnicodeFont(s.label), nonLatin1,
      `${s.lang}: needsUnicodeFont disagreed for "${s.label}"`,
    );
  }
  // German/Vietnamese sanity: Latin-1 chars are fine, stacked Vietnamese diacritics are not.
  assert.equal(needsUnicodeFont("Vollständiger Name"), false, "German umlaut is Latin-1");
  assert.equal(needsUnicodeFont("Họ và tên"), true, "Vietnamese needs a Unicode font");
});

// --- script-qualified name fields, across languages ---
const NAME_CASES = [
  { label: "Chinese name",  key: "chinese_name",  value: "陳偉" },
  { label: "Japanese name", key: "japanese_name", value: "山田太郎" },
  { label: "Korean name",   key: "korean_name",   value: "김민준" },
  { label: "Arabic name",   key: "arabic_name",   value: "علي" },
  { label: "Hindi name",    key: "hindi_name",    value: "अमित" },
  { label: "Tamil name",    key: "tamil_name",    value: "அருண்" },
  { label: "Telugu name",   key: "telugu_name",   value: "అరుణ్" },
  { label: "Kannada name",  key: "kannada_name",  value: "ಅರುಣ್" },
  { label: "Bengali name",  key: "bengali_name",  value: "অমিত" },
  { label: "Russian name",  key: "russian_name",  value: "Иван" },
  { label: "Thai name",     key: "thai_name",     value: "สมชาย" },
  { label: "Urdu name",     key: "urdu_name",     value: "علی" },
];

test("a script-qualified name field gets that script's name, in every language", () => {
  for (const c of NAME_CASES) {
    const vault = { full_name: "Li Wei Chen", first_name: "Wei", last_name: "Chen", [c.key]: c.value };
    assert.equal(ask(vault, c.label), c.value, `${c.label} should resolve to ${c.value}`);
  }
});

test("with no stored value, a script-qualified field stays EMPTY in every language", () => {
  const latinOnly = { full_name: "Li Wei Chen", first_name: "Wei", last_name: "Chen" };
  for (const c of NAME_CASES) {
    assert.equal(ask(latinOnly, c.label), null, `${c.label} must not fall back to the Latin name`);
  }
});
