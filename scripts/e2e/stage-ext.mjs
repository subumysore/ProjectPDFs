// Stage the extension's RUNTIME file set into a space-free directory.
//
// Two reasons this exists: Chrome refuses a --load-extension path containing a space (this repo lives
// under "C:\Users\Subramanya Mysore\…"), and a hand-copied folder has bitten us before by missing
// vendor/ (the popup then 404s at the passphrase screen). The list below mirrors
// deploy/build-extension-zip.ps1 — the ONE place that knows what the extension actually loads.
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const src = resolve("apps/extension");
const out = process.argv[2] || join(process.env.TEMP || "/tmp", "ppf-ext-smoke");
rmSync(out, { recursive: true, force: true });
for (const d of ["src", "vendor/pdfjs", "vendor/transformers", "vendor/tesseract"]) mkdirSync(join(out, d), { recursive: true });

for (const f of ["manifest.json", "popup.html", "options.html", "viewer.html", "capture.html", "sign.html",
  "icon16.png", "icon48.png", "icon128.png"]) cpSync(join(src, f), join(out, f));
cpSync(join(src, "src"), join(out, "src"), { recursive: true, filter: (p) => !/\.test\./.test(p) });
for (const f of ["pdf-lib.esm.min.js", "fontkit.bundle.mjs", "zxing.bundle.mjs"]) cpSync(join(src, "vendor", f), join(out, "vendor", f));
for (const [d, files] of [["pdfjs", ["pdf.min.mjs", "pdf.worker.min.mjs"]],
  ["transformers", ["transformers.bundle.mjs", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]],
  ["tesseract", ["worker.min.js", "tesseract.esm.min.js", "tesseract-core-simd-lstm.wasm", "tesseract-core-simd-lstm.wasm.js"]]]) {
  for (const f of files) { const p = join(src, "vendor", d, f); if (existsSync(p)) cpSync(p, join(out, "vendor", d, f)); }
}
console.log(out);
