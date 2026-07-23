// @ts-nocheck
// PORTED from the shared engine's `appearances()` in apps/extension/src/pdffill.js — same rule,
// desktop's own pdf-lib instance (the engine's copy is the browser vendor bundle, so the code
// cannot simply be imported; `engine-parity.test.mjs` guards the rule from drifting).
//
// Why this exists: `form.updateFieldAppearances()` regenerates EVERY field with the standard
// WinAnsi font, so ONE CJK/Indic value throws `WinAnsi cannot encode` and — because it happens at
// save time, after every field is set — aborts the ENTIRE export. A user filling a Chinese form
// got no file at all. Each field is now finished individually with the font its own value needs,
// and a field that still refuses is blanked and REPORTED rather than costing the whole document.
//
// The caller must save with `{ updateFieldAppearances: false }`, otherwise pdf-lib redoes the
// whole form with the standard font at save time and the abort comes straight back.
import { StandardFonts, PDFTextField, PDFDropdown } from "pdf-lib";

export function needsUnicodeFont(value) {
  return typeof value === "string" && /[^ -ÿ]/.test(value);
}

/**
 * `makePicker` is injectable and the real one is imported LAZILY, for two reasons: nothing is
 * loaded (and no font is fetched) unless a non-Latin value actually turns up, and the appearance
 * logic can be tested under plain `node --test`, which cannot resolve the `@engine` alias or the
 * Tauri API that the real font picker pulls in.
 */
export async function appearances(pdf, makePicker = null) {
  const noted = [];
  let picker = null;
  return {
    note(field, value) { noted.push({ field, value }); },
    async finish() {
      const latin = await pdf.embedFont(StandardFonts.Helvetica);
      const dropped = [];
      for (const { field, value } of noted) {
        // Only text fields and dropdowns DRAW TEXT and so take a font. Checkboxes and radio
        // groups take an appearance PROVIDER — handing them a font makes generation throw.
        const textual = field instanceof PDFTextField || field instanceof PDFDropdown;
        let font = latin;
        if (textual && needsUnicodeFont(value)) {
          if (!picker) {
            const make = makePicker || (await import("./fonts.ts")).makeFontPicker;
            picker = await make(pdf);
          }
          font = await picker(value);
        }
        try {
          if (textual) field.updateAppearances(font); else field.updateAppearances();
        } catch {
          dropped.push({ field: field.getName(), value });
          try { field.setText(""); field.updateAppearances(latin); } catch { /* leave as-is */ }
        }
      }
      return dropped;
    },
  };
}
