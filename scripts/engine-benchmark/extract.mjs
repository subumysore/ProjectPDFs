// Shared extraction layer for the engine benchmark. Loads a PDF headless via pdf.js (legacy
// Node build), and returns, per form: page count, printed text runs (with geometry), and the
// form's widget annotations grouped by field name — plus whether the form ships field tooltips
// (/TU), which is what makes the "AcroForm-with-tooltips" path (e.g. USCIS I-9) easy.
//
// This is deliberately the SAME shape the app's pdf.js widget filler builds, so the benchmark
// exercises the real shared engine (planProximityFill), not a toy.
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

// Resolve the legacy pdf.js build (Node-capable: text + annotations, no canvas needed). It's a
// workspace dep of apps/app, hoisted into the pnpm store, so locate it there rather than via bare
// specifier (which only resolves from the owning package).
function findPdfjs() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const direct = join(root, "apps/app/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
  if (existsSync(direct)) return direct;
  const store = join(root, "node_modules/.pnpm");
  for (const d of readdirSync(store).filter((n) => n.startsWith("pdfjs-dist@"))) {
    const p = join(store, d, "node_modules/pdfjs-dist/legacy/build/pdf.mjs");
    if (existsSync(p)) return p;
  }
  throw new Error("pdfjs-dist legacy build not found (run pnpm install)");
}
export const pdfjsLib = await import(pathToFileURL(findPdfjs()).href);
import { captionFor } from "../../apps/extension/src/pdfproximity.js";

export async function extractForm(bytes) {
  // pdf.js rejects Node Buffer specifically; force a plain Uint8Array copy.
  const data = new Uint8Array(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
  const doc = await pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;

  const texts = [];
  const groups = new Map(); // fieldName -> [widget,...]
  let tooltipCount = 0;

  for (let pi = 0; pi < doc.numPages; pi++) {
    const page = await doc.getPage(pi + 1);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      const s = (it.str || "").trim();
      if (s) texts.push({ page: pi, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || 10, s });
    }
    const anns = await page.getAnnotations().catch(() => []);
    for (const a of anns) {
      if (a.subtype !== "Widget" || !a.fieldName || a.hidden || a.readOnly) continue;
      const R = a.rect;
      const rect = { x: Math.min(R[0], R[2]), y: Math.min(R[1], R[3]), width: Math.abs(R[2] - R[0]), height: Math.abs(R[3] - R[1]) };
      if (rect.width < 2 || rect.height < 2) continue;
      // pdf.js surfaces the /TU tooltip as `alternativeText`.
      const tip = (a.alternativeText || "").trim();
      if (tip) tooltipCount++;
      const w = { id: a.fieldName, page: pi, kind: a.fieldType === "Tx" ? "text" : "choice",
                  rect, isButton: a.fieldType === "Btn", exportValue: a.buttonValue ?? null, tooltip: tip };
      const g = groups.get(a.fieldName) || []; g.push(w); groups.set(a.fieldName, g);
    }
  }

  // Collapse widget groups into the fields[] shape planProximityFill consumes; attach the printed
  // proximity caption (__caption) so ground-truth can also locate a field by its visible label.
  const textsByPage = new Map();
  for (const t of texts) { const a = textsByPage.get(t.page) || []; a.push(t); textsByPage.set(t.page, a); }
  const fields = [];
  for (const [name, ws] of groups) {
    const w0 = ws[0];
    const kind = w0.kind === "text" && !w0.isButton ? "text" : "choice";
    const options = ws.map((w) => w.exportValue).filter(Boolean);
    let cap = ""; try { cap = captionFor(textsByPage.get(w0.page) || [], w0.rect); } catch { /* none */ }
    fields.push({ id: name, kind, page: w0.page, rect: w0.rect, options, tooltip: w0.tooltip,
                  __caption: cap, widgets: ws.map((w) => ({ page: w.page, rect: w.rect })) });
  }

  return { pages: doc.numPages, texts, fields, widgetCount: [...groups.values()].reduce((n, g) => n + g.length, 0), tooltipCount };
}
