#!/usr/bin/env node
// Reproduce the self-hosted OCR assets into apps/app/public/tesseract/.
// Copies the Tesseract worker + LSTM cores from node_modules and downloads the
// English model. Run after `pnpm install`:  node scripts/fetch-ocr-assets.mjs
import { createRequire } from "node:module";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const coreDir = dirname(require.resolve("tesseract.js-core/package.json"));
const tessDir = dirname(require.resolve("tesseract.js/package.json"));
const out = join(process.cwd(), "apps/app/public/tesseract");
mkdirSync(out, { recursive: true });

const coreFiles = [
  "tesseract-core-simd-lstm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-lstm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-lstm.wasm.js",
];
for (const f of coreFiles) cpSync(join(coreDir, f), join(out, f));
cpSync(join(tessDir, "dist/worker.min.js"), join(out, "worker.min.js"));

const MODEL = "https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz";
const res = await fetch(MODEL);
if (!res.ok) throw new Error(`download ${MODEL} -> ${res.status}`);
writeFileSync(join(out, "eng.traineddata.gz"), Buffer.from(await res.arrayBuffer()));

console.log("OCR assets ready in apps/app/public/tesseract/");
