// @ts-nocheck
// PORTED from apps/extension/src/fonts.js — desktop variant (self-hosted /fonts/,
// npm fontkit). Script-aware font embedding so non-Latin values (Devanagari/CJK)
// render in drawn PDF text; Latin uses the built-in Helvetica. Assets served from the
// app origin (connect-src 'self') — nothing leaves the device.
import "regenerator-runtime/runtime.js"; // fontkit's Indic shaper needs it
import fontkit from "@pdf-lib/fontkit";
import { StandardFonts } from "pdf-lib";

const FONT_BASE = "/fonts/";
const FONT_FILES = {
  hi: "NotoSansDevanagari-Regular.ttf",
  zh: "NotoSansSC-Regular.otf",
};

export function scriptOf(text) {
  const t = String(text || "");
  if (/[ऀ-ॿ]/.test(t)) return "hi";
  if (/[㐀-鿿豈-﫿　-ヿ＀-￯]/.test(t)) return "zh";
  return "latin";
}

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
      return latin;
    }
  };
}
