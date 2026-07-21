// Language-aware FILL (shared engine — used by both the extension and the desktop).
// Given a form's field captions + the user's vault + a chosen OUTPUT language, produce each
// field's value rendered in that language: names / numbers / IDs are TRANSLITERATED to the target
// script, real phrases are TRANSLATED (via an injected async translateFn). The form's LABELS are
// never changed here — the caller keeps them in the form's original language (per the save-language
// spec: the saved form stays in its own language; only the VALUES take the chosen language).
import { resolveFields } from "./resolver.js";
import { isTranslatableValue } from "./valuefmt.js";
import { toScript } from "./translit.js";

/**
 * @param {string[]} captions  the form's field captions (already in a language the resolver reads)
 * @param {object}   vault     the user's on-device values
 * @param {string}   outputLang ISO code the VALUES should be written in ("en" = as stored)
 * @param {(text:string,from:string,to:string)=>Promise<string>} [translateFn] on-device translator
 * @returns {Promise<Array<{caption,value,outputValue}|null>>} one entry per caption (null = no value)
 */
export async function fillValuesInLanguage(captions, vault, outputLang, translateFn) {
  const values = resolveFields(vault, captions.map((c) => ({ label: c })));
  const out = [];
  for (let i = 0; i < captions.length; i++) {
    const v = values[i];
    if (v == null || v === "") { out.push(null); continue; }
    const s = String(v);
    let rendered = s;
    if (outputLang && outputLang !== "en") {
      rendered = (isTranslatableValue(v) && typeof translateFn === "function")
        ? await translateFn(s, "en", outputLang)   // a real phrase → translate
        : toScript(s, outputLang);                  // a name / number / ID → transliterate
    }
    out.push({ caption: captions[i], value: s, outputValue: rendered });
  }
  return out;
}
