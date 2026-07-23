// Script-aware font embedding for PDF output. pdf-lib's built-in fonts are WinAnsi — they can
// draw Latin-1 and nothing else — so any value in another script needs a real font embedded
// (subset) into the PDF via fontkit. We fetch the right Noto font on demand from our asset host,
// which serves assets DOWNWARD only: nothing about the user, the form, or the value is sent.
//
// The script table is data, not logic: adding a script is uploading its Noto file to the bucket
// and adding one line here. Detection uses Unicode Script properties rather than hand-written
// codepoint ranges, so it stays honest about what a string actually contains.
import fontkit from "../vendor/fontkit.bundle.mjs";
import { StandardFonts } from "../vendor/pdf-lib.esm.min.js";

const FONT_BASE =
  "https://objectstorage.us-ashburn-1.oraclecloud.com/p/MeK_72_tOM4xQH7J-bSokMlJ14erObpr5QYjeVFi-Oh7PsQt-jtjyzA4YGyJRSyP/n/idlqdkwlstnb/b/polyglotformfill-dl/o/fonts/";

/**
 * Script id -> { test, file }. ORDER MATTERS for CJK: Japanese and Korean text contains Han
 * characters too, so kana and Hangul are tested BEFORE Han — otherwise Japanese would be drawn
 * with the Simplified-Chinese font, which has no kana and would silently drop half the value.
 *
 * Every file listed here must actually exist on the host; `canEmbed` is what stops the engine
 * writing a box it cannot draw, and it trusts this table.
 */
const SCRIPTS = [
  { id: "ja", test: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, file: "NotoSansJP-Regular.otf" },
  { id: "ko", test: /\p{Script=Hangul}/u, file: "NotoSansKR-Regular.otf" },
  { id: "zh", test: /\p{Script=Han}/u, file: "NotoSansSC-Regular.otf" },
  { id: "hi", test: /\p{Script=Devanagari}/u, file: "NotoSansDevanagari-Regular.ttf" },
  { id: "bn", test: /\p{Script=Bengali}/u, file: "NotoSansBengali-Regular.ttf" },
  { id: "gu", test: /\p{Script=Gujarati}/u, file: "NotoSansGujarati-Regular.ttf" },
  { id: "pa", test: /\p{Script=Gurmukhi}/u, file: "NotoSansGurmukhi-Regular.ttf" },
  { id: "kn", test: /\p{Script=Kannada}/u, file: "NotoSansKannada-Regular.ttf" },
  { id: "ml", test: /\p{Script=Malayalam}/u, file: "NotoSansMalayalam-Regular.ttf" },
  { id: "ta", test: /\p{Script=Tamil}/u, file: "NotoSansTamil-Regular.ttf" },
  { id: "te", test: /\p{Script=Telugu}/u, file: "NotoSansTelugu-Regular.ttf" },
  { id: "ar", test: /\p{Script=Arabic}/u, file: "NotoSansArabic-Regular.ttf" },
  { id: "he", test: /\p{Script=Hebrew}/u, file: "NotoSansHebrew-Regular.ttf" },
  { id: "th", test: /\p{Script=Thai}/u, file: "NotoSansThai-Regular.ttf" },
  // Cyrillic and Greek are NOT in WinAnsi, so Russian and Greek names need a font too. Noto Sans
  // core carries Latin, Cyrillic and Greek together, so one file serves both.
  { id: "cyrl", test: /\p{Script=Cyrillic}/u, file: "NotoSans-Regular.ttf" },
  { id: "grek", test: /\p{Script=Greek}/u, file: "NotoSans-Regular.ttf" },
];

/** The font FILE a script id needs (exported so the desktop can share the same table). */
export const FONT_FILE_FOR = Object.fromEntries(SCRIPTS.map((s) => [s.id, s.file]));

/** Which embedded font a string needs: a script id from the table above, or 'latin'. */
export function scriptOf(text) {
  const t = String(text || "");
  for (const s of SCRIPTS) if (s.test.test(t)) return s.id;
  return "latin";
}

/** True if some font we can embed is able to draw this text. */
export function canEmbed(text) {
  const s = scriptOf(text);
  return s === "latin" || !!FONT_FILE_FOR[s];
}

/**
 * Bind a font picker to a PDFDocument. Returns `pick(text) => font`, lazily fetching and
 * embedding (and caching per document) the right script font. Falls back to Latin if the font
 * cannot be loaded — the caller detects that the value is then undrawable and reports it rather
 * than writing junk (see `appearances()` in pdffill.js).
 */
export async function makeFontPicker(pdfDoc) {
  pdfDoc.registerFontkit(fontkit);
  const latin = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const cache = { latin };
  return async function pick(text) {
    const s = scriptOf(text);
    if (s === "latin") return latin;
    if (cache[s]) return cache[s];
    try {
      const res = await fetch(FONT_BASE + FONT_FILE_FOR[s]);
      if (!res.ok) throw new Error(`font HTTP ${res.status}`);
      cache[s] = await pdfDoc.embedFont(new Uint8Array(await res.arrayBuffer()), { subset: true });
      return cache[s];
    } catch (_) {
      return latin; // best-effort: Latin can't draw the script, but never crash the fill
    }
  };
}
