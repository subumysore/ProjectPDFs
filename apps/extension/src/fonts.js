// Script-aware font embedding for PDF output. pdf-lib's built-in fonts can't draw
// Devanagari (Hindi) or CJK (Chinese); we embed on-demand Noto fonts (hosted, fetched
// once, subset into the PDF) via fontkit so non-Latin values render correctly. Latin
// text uses the built-in Helvetica. Assets-DOWN only — no user content leaves.
import fontkit from "../vendor/fontkit.bundle.mjs";
import { StandardFonts } from "../vendor/pdf-lib.esm.min.js";

const FONT_BASE =
  "https://objectstorage.us-ashburn-1.oraclecloud.com/p/MeK_72_tOM4xQH7J-bSokMlJ14erObpr5QYjeVFi-Oh7PsQt-jtjyzA4YGyJRSyP/n/idlqdkwlstnb/b/polyglotformfill-dl/o/fonts/";
// Only scripts whose font is actually HOSTED can be embedded. A script we detect but have
// no font for falls back to Latin, which cannot draw it — the caller must treat that as
// "leave blank and report", never write mojibake. Adding a script = upload the Noto file
// to the bucket, add a line here.
const FONT_FILES = {
  hi: "NotoSansDevanagari-Regular.ttf",
  zh: "NotoSansSC-Regular.otf",
};

/** True if some font we can embed is able to draw this text. */
export function canEmbed(text) {
  const s = scriptOf(text);
  return s === "latin" || !!FONT_FILES[s];
}

/** Which embedded font a string needs: 'hi' (Devanagari), 'zh' (CJK/kana), or 'latin'. */
export function scriptOf(text) {
  const t = String(text || "");
  if (/[ऀ-ॿ]/.test(t)) return "hi";
  if (/[㐀-鿿豈-﫿　-ヿ＀-￯]/.test(t)) return "zh";
  return "latin";
}

/**
 * Bind a font picker to a PDFDocument. Returns `pick(text) => font`, lazily embedding
 * (and caching) the right script font. Falls back to Latin if a font can't load.
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
      const res = await fetch(FONT_BASE + FONT_FILES[s]);
      if (!res.ok) throw new Error(`font HTTP ${res.status}`);
      cache[s] = await pdfDoc.embedFont(new Uint8Array(await res.arrayBuffer()), { subset: true });
      return cache[s];
    } catch (_) {
      return latin; // best-effort: Latin can't draw the script, but never crash the fill
    }
  };
}
