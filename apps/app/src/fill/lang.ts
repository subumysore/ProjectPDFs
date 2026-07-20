// @ts-nocheck
// PORTED from apps/extension/src/lang.js — keep in sync (shared fill logic).
// On-device language detection for a form's extracted text. Script ranges settle the
// non-Latin languages outright; a small stop-word/diacritic vote separates the Latin
// ones (en/es/fr/de). Pure and deterministic — unit-tested. Returns an ISO code from
// the set we can translate (en/hi/es/fr/de/zh/ar/ru), defaulting to "en".
export const SUPPORTED_LANGS = ["en", "hi", "es", "fr", "de", "zh", "ar", "ru"];

const SCRIPTS = [
  [/[ऀ-ॿ]/g, "hi"], // Devanagari
  [/[一-鿿]/g, "zh"], // CJK unified
  [/[؀-ۿ]/g, "ar"], // Arabic
  [/[Ѐ-ӿ]/g, "ru"], // Cyrillic
];

// Frequent function words per Latin language (accent-stripped forms included).
const WORDS = {
  es: ["el", "la", "los", "las", "de", "y", "para", "por", "con", "usted", "nombre", "apellido", "direccion", "fecha", "correo", "numero", "pais", "ciudad", "codigo"],
  fr: ["le", "la", "les", "de", "et", "pour", "vous", "votre", "avec", "nom", "prenom", "adresse", "date", "naissance", "courriel", "numero", "pays", "ville", "code"],
  de: ["der", "die", "das", "und", "für", "fur", "mit", "sie", "ihre", "name", "vorname", "nachname", "adresse", "geburtsdatum", "strasse", "stadt", "land", "nummer"],
  en: ["the", "and", "for", "your", "with", "name", "first", "last", "address", "date", "birth", "email", "number", "country", "city", "state", "zip", "please"],
};
const DIACRITIC = { es: /[ñ¿¡]/i, fr: /[çœàèùâêîôû]/i, de: /[ßäöü]/i };

/** Detect the language of `text`. Returns { lang, confidence } (0–1). */
export function detectLang(text) {
  const t = (text || "").trim();
  if (!t) return { lang: "en", confidence: 0 };

  // Non-Latin scripts: whichever script has the most characters wins if it's a
  // meaningful share of the letters.
  let bestScript = null;
  let bestCount = 0;
  for (const [re, lang] of SCRIPTS) {
    const n = (t.match(re) || []).length;
    if (n > bestCount) { bestCount = n; bestScript = lang; }
  }
  const letters = (t.match(/\p{L}/gu) || []).length || 1;
  if (bestScript && bestCount / letters > 0.15) {
    return { lang: bestScript, confidence: Math.min(1, bestCount / letters) };
  }

  // Latin: stop-word vote + diacritic tie-breaks.
  const tokens = t.toLowerCase().replace(/[^a-zäöüßçñàèùâêîôûœ¿¡'\s]/g, " ").split(/\s+/).filter(Boolean);
  const set = new Set(tokens);
  const score = { en: 0, es: 0, fr: 0, de: 0 };
  for (const lang of Object.keys(WORDS)) {
    for (const w of WORDS[lang]) if (set.has(w)) score[lang]++;
    if (DIACRITIC[lang] && DIACRITIC[lang].test(t)) score[lang] += 2;
  }
  let best = "en";
  let top = 0;
  let total = 0;
  for (const [lang, s] of Object.entries(score)) { total += s; if (s > top) { top = s; best = lang; } }
  return { lang: best, confidence: total ? top / total : 0 };
}
