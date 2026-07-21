// Universal language registry — the single source of truth that makes PolyglotFormFill
// language-AGNOSTIC (any script in, any language out). No fixed allow-list: a language is
// supported if we can (a) detect its script, (b) OCR it (Tesseract pack), and (c) translate
// it (NLLB-200 covers 200 languages). Each entry maps an ISO-639 code to the FLORES-200 code
// NLLB uses and the Tesseract traineddata pack name.
//
// Pure & deterministic (unit-tested). Adding a language = one row here, not a code change.

// ISO → { name, flores (NLLB), tess (Tesseract pack), script (detection key) }
export const LANGS = {
  en: { name: "English",   flores: "eng_Latn", tess: "eng",     script: "Latin" },
  es: { name: "Spanish",   flores: "spa_Latn", tess: "spa",     script: "Latin" },
  fr: { name: "French",    flores: "fra_Latn", tess: "fra",     script: "Latin" },
  de: { name: "German",    flores: "deu_Latn", tess: "deu",     script: "Latin" },
  pt: { name: "Portuguese",flores: "por_Latn", tess: "por",     script: "Latin" },
  it: { name: "Italian",   flores: "ita_Latn", tess: "ita",     script: "Latin" },
  nl: { name: "Dutch",     flores: "nld_Latn", tess: "nld",     script: "Latin" },
  vi: { name: "Vietnamese",flores: "vie_Latn", tess: "vie",     script: "Latin" },
  id: { name: "Indonesian",flores: "ind_Latn", tess: "ind",     script: "Latin" },
  tr: { name: "Turkish",   flores: "tur_Latn", tess: "tur",     script: "Latin" },
  // Indic
  hi: { name: "Hindi",     flores: "hin_Deva", tess: "hin",     script: "Devanagari" },
  mr: { name: "Marathi",   flores: "mar_Deva", tess: "mar",     script: "Devanagari" },
  ne: { name: "Nepali",    flores: "npi_Deva", tess: "nep",     script: "Devanagari" },
  kn: { name: "Kannada",   flores: "kan_Knda", tess: "kan",     script: "Kannada" },
  ta: { name: "Tamil",     flores: "tam_Taml", tess: "tam",     script: "Tamil" },
  te: { name: "Telugu",    flores: "tel_Telu", tess: "tel",     script: "Telugu" },
  ml: { name: "Malayalam", flores: "mal_Mlym", tess: "mal",     script: "Malayalam" },
  bn: { name: "Bengali",   flores: "ben_Beng", tess: "ben",     script: "Bengali" },
  gu: { name: "Gujarati",  flores: "guj_Gujr", tess: "guj",     script: "Gujarati" },
  pa: { name: "Punjabi",   flores: "pan_Guru", tess: "pan",     script: "Gurmukhi" },
  or: { name: "Odia",      flores: "ory_Orya", tess: "ori",     script: "Odia" },
  si: { name: "Sinhala",   flores: "sin_Sinh", tess: "sin",     script: "Sinhala" },
  ur: { name: "Urdu",      flores: "urd_Arab", tess: "urd",     script: "Arabic" },
  // Other scripts
  ar: { name: "Arabic",    flores: "arb_Arab", tess: "ara",     script: "Arabic" },
  fa: { name: "Persian",   flores: "pes_Arab", tess: "fas",     script: "Arabic" },
  ru: { name: "Russian",   flores: "rus_Cyrl", tess: "rus",     script: "Cyrillic" },
  uk: { name: "Ukrainian", flores: "ukr_Cyrl", tess: "ukr",     script: "Cyrillic" },
  zh: { name: "Chinese",   flores: "zho_Hans", tess: "chi_sim", script: "Han" },
  ja: { name: "Japanese",  flores: "jpn_Jpan", tess: "jpn",     script: "Kana" },
  ko: { name: "Korean",    flores: "kor_Hang", tess: "kor",     script: "Hangul" },
  th: { name: "Thai",      flores: "tha_Thai", tess: "tha",     script: "Thai" },
  he: { name: "Hebrew",    flores: "heb_Hebr", tess: "heb",     script: "Hebrew" },
  el: { name: "Greek",     flores: "ell_Grek", tess: "ell",     script: "Greek" },
};

// Script → Unicode test. Order matters only for disjoint ranges (they don't overlap).
// Each maps to the DEFAULT language for that script (the most common); detection can be
// refined later per-language, but the script alone already picks the right OCR pack + a
// valid FLORES code, which is what "translate anything" needs.
const SCRIPT_RANGES = [
  ["Kannada",    /[ಀ-೿]/g, "kn"],
  ["Tamil",      /[஀-௿]/g, "ta"],
  ["Telugu",     /[ఀ-౿]/g, "te"],
  ["Malayalam",  /[ഀ-ൿ]/g, "ml"],
  ["Bengali",    /[ঀ-৿]/g, "bn"],
  ["Gujarati",   /[઀-૿]/g, "gu"],
  ["Gurmukhi",   /[਀-੿]/g, "pa"],
  ["Odia",       /[଀-୿]/g, "or"],
  ["Sinhala",    /[඀-෿]/g, "si"],
  ["Devanagari", /[ऀ-ॿ]/g, "hi"],
  ["Kana",       /[぀-ヿ]/g, "ja"], // hira/kata → Japanese (check before Han)
  ["Hangul",     /[가-힯]/g, "ko"],
  ["Han",        /[一-鿿]/g, "zh"],
  ["Thai",       /[฀-๿]/g, "th"],
  ["Hebrew",     /[֐-׿]/g, "he"],
  ["Greek",      /[Ͱ-Ͽ]/g, "el"],
  ["Arabic",     /[؀-ۿ]/g, "ar"],
  ["Cyrillic",   /[Ѐ-ӿ]/g, "ru"],
];

export const flores = (iso) => (LANGS[iso] || LANGS.en).flores;
export const tessPack = (iso) => (LANGS[iso] || LANGS.en).tess;
export const langName = (iso) => (LANGS[iso] || {}).name || iso;
export const isKnown = (iso) => !!LANGS[iso];
export const allLangs = () => Object.keys(LANGS);

/**
 * Detect the dominant NON-Latin script of `text` and return its language + share.
 * Returns { lang, script, share } or null when the text is Latin/undetermined (the
 * caller then falls back to a Latin word-vote for en/es/fr/de/…).
 */
// Does an extracted text layer look UNUSABLE — empty (scanned image) or garbage (a legacy
// non-Unicode font, e.g. Kannada Nudi/Baraha, which extracts as symbol-heavy pseudo-Latin)?
// When true, the viewer auto-suggests the render→OCR path instead of text-layer translation.
export function textLayerLooksBad(text) {
  const t = (text || "").trim();
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (letters < 8) return true; // (near-)empty text layer → scanned
  const nonSpace = t.replace(/\s/g, "");
  const symbols = (nonSpace.match(/[^\p{L}\p{N}]/gu) || []).length;
  const symbolRatio = symbols / (nonSpace.length || 1);
  const toks = t.toLowerCase().split(/[^a-zà-ɏ]+/).filter((x) => x.length >= 2);
  const wordish = toks.filter((x) => /[aeiou]/.test(x)).length / (toks.length || 1);
  return symbolRatio > 0.18 || wordish < 0.45; // lots of symbols, or few vowel-bearing words
}

export function detectScript(text) {
  const t = (text || "");
  const letters = (t.match(/\p{L}/gu) || []).length || 1;
  let best = null, bestN = 0;
  for (const [script, re, lang] of SCRIPT_RANGES) {
    const n = (t.match(re) || []).length;
    if (n > bestN) { bestN = n; best = { lang, script, share: n / letters }; }
  }
  return best && best.share > 0.12 ? best : null;
}
