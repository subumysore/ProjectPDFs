// @ts-nocheck
// Desktop script-font embedding. The SCRIPT TABLE and detection are the shared engine's
// (`@engine/fonts.js`) so a form fills identically in the app and the extension; only the
// delivery differs, because the two platforms fetch assets differently.
//
// Fonts are NOT bundled in the installer. Like the Tesseract OCR packs (ADR-0019), a font is
// fetched ONLY when a value in that script is actually about to be written, then kept in
// app-data — so a user who never fills a Tamil form never downloads the Tamil font, and adding
// a script needs no new release. Sizes are per-script and small (Indic ~30–240 KB; the CJK
// fonts are the outliers at ~4.5 MB for Japanese/Korean and ~8 MB for Chinese).
//
// Privacy: the flow is DOWNWARD only — a public font file comes onto the device. The form, its
// values, and any identifier never leave; the Rust side does the fetch and validates the name.
import "regenerator-runtime/runtime.js"; // fontkit's Indic shaper needs it
import fontkit from "@pdf-lib/fontkit";
import { StandardFonts } from "pdf-lib";
import { invoke } from "@tauri-apps/api/core";
import { scriptOf, canEmbed, FONT_FILE_FOR } from "@engine/fonts.js";

export { scriptOf, canEmbed, FONT_FILE_FOR };

export async function makeFontPicker(pdfDoc) {
  pdfDoc.registerFontkit(fontkit);
  const latin = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const cache = { latin };
  return async function pick(text) {
    const s = scriptOf(text);
    if (s === "latin") return latin;
    if (cache[s]) return cache[s];
    const file = FONT_FILE_FOR[s];
    if (!file) return latin; // no font for this script yet — caller reports it, never draws junk
    try {
      // Cached on this device after the first use of the script; only then is anything fetched.
      const bytes = await invoke("script_font", { name: file });
      cache[s] = await pdfDoc.embedFont(new Uint8Array(bytes), { subset: true });
      return cache[s];
    } catch (_) {
      return latin; // offline on first use of a script: the value is reported, not mangled
    }
  };
}
