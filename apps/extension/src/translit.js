// On-device TRANSLITERATION — render a value's SOUND in the target language's script,
// without changing its meaning. A person's name or a number is not "translated" (that
// hallucinates, e.g. a name → "Mexico"); it is written in the reader's script instead:
//   "Pranav Subramanya" → प्रणव सुब्रमन्य   ·   "12" → १२
// Latin-script targets (es/fr/de/en) keep the original spelling — a name is written the
// same way — so those pass through unchanged. Chinese (zh) has no phonetic letter script,
// so it also passes through. Pure + unit-tested. Phonetic and therefore approximate.

const LATIN_TARGETS = new Set(["en", "es", "fr", "de"]);

// Localised digit sets (the column claims the target language, so digits follow suit).
const DIGITS = {
  hi: "०१२३४५६७८९",
  ar: "٠١٢٣٤٥٦٧٨٩",
};
function localiseDigits(s, lang) {
  const set = DIGITS[lang];
  if (!set) return s;
  return s.replace(/[0-9]/g, (d) => set[+d]);
}

// ---- Devanagari (Hindi) ---------------------------------------------------------
const DEV_CONS = {
  ksh: "क्ष", chh: "छ", shh: "ष",
  kh: "ख", gh: "घ", ng: "ङ", ch: "च", jh: "झ", th: "थ", dh: "ध",
  ph: "फ", bh: "भ", sh: "श", gy: "ज्ञ",
  k: "क", g: "ग", c: "क", j: "ज", t: "त", d: "द", n: "न", p: "प",
  f: "फ़", b: "ब", m: "म", y: "य", r: "र", l: "ल", v: "व", w: "व",
  s: "स", h: "ह", z: "ज़", x: "क्स", q: "क",
};
const DEV_VOWEL = { aa: "आ", ai: "ऐ", au: "औ", ee: "ई", ii: "ई", oo: "ऊ", uu: "ऊ", a: "अ", e: "ए", i: "इ", o: "ओ", u: "उ" };
const DEV_MATRA = { aa: "ा", ai: "ै", au: "ौ", ee: "ी", ii: "ी", oo: "ू", uu: "ू", a: "", e: "े", i: "ि", o: "ो", u: "ु" };
const DEV_CONS_KEYS = Object.keys(DEV_CONS).sort((a, b) => b.length - a.length);
const DEV_VOWEL_KEYS = Object.keys(DEV_VOWEL).sort((a, b) => b.length - a.length);

function devanagariWord(w) {
  const s = w.toLowerCase();
  let out = "", i = 0, lastWasCons = false;
  while (i < s.length) {
    const c = DEV_CONS_KEYS.find((k) => s.startsWith(k, i));
    if (c) {
      if (lastWasCons) out += "्";           // consonant cluster → halant conjunct
      out += DEV_CONS[c];
      i += c.length; lastWasCons = true; continue;
    }
    const v = DEV_VOWEL_KEYS.find((k) => s.startsWith(k, i));
    if (v) {
      out += lastWasCons ? DEV_MATRA[v] : DEV_VOWEL[v];
      i += v.length; lastWasCons = false; continue;
    }
    out += s[i]; i++; lastWasCons = false;    // space / punctuation / other
  }
  return out;
}

// ---- Cyrillic (Russian) ---------------------------------------------------------
const CYR = {
  shch: "щ", sh: "ш", ch: "ч", zh: "ж", kh: "х", ts: "ц", yu: "ю", ya: "я", yo: "ё",
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "й",
  k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р", s: "с", t: "т",
  u: "у", v: "в", w: "в", x: "кс", y: "ы", z: "з",
};
const CYR_KEYS = Object.keys(CYR).sort((a, b) => b.length - a.length);

// ---- Arabic (consonantal, rough) ------------------------------------------------
const ARA = {
  kh: "خ", sh: "ش", th: "ث", dh: "ذ", gh: "غ",
  a: "ا", b: "ب", c: "ك", d: "د", e: "ي", f: "ف", g: "ج", h: "ه", i: "ي", j: "ج",
  k: "ك", l: "ل", m: "م", n: "ن", o: "و", p: "ب", q: "ق", r: "ر", s: "س", t: "ت",
  u: "و", v: "ف", w: "و", x: "كس", y: "ي", z: "ز",
};
const ARA_KEYS = Object.keys(ARA).sort((a, b) => b.length - a.length);

function mapWord(s, table, keys) {
  const low = s.toLowerCase();
  let out = "", i = 0;
  while (i < low.length) {
    const k = keys.find((kk) => low.startsWith(kk, i));
    if (k) { out += table[k]; i += k.length; } else { out += low[i]; i++; }
  }
  return out;
}

/**
 * Write `text` in `lang`'s script (transliteration). Returns `text` unchanged for
 * Latin-script targets and Chinese; otherwise transliterates letters and localises
 * digits. Preserves spaces and punctuation.
 */
export function toScript(text, lang) {
  const s = String(text == null ? "" : text);
  if (!s.trim()) return s;
  if (LATIN_TARGETS.has(lang) || lang === "zh") return s;  // same spelling / no letter script
  let body = s;
  if (lang === "hi") body = s.replace(/[A-Za-z]+/g, devanagariWord);
  else if (lang === "ru") body = s.replace(/[A-Za-z]+/g, (w) => mapWord(w, CYR, CYR_KEYS));
  else if (lang === "ar") body = s.replace(/[A-Za-z]+/g, (w) => mapWord(w, ARA, ARA_KEYS));
  return localiseDigits(body, lang);
}
