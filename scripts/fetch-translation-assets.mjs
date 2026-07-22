#!/usr/bin/env node
// Provision SELF-HOSTED on-device translation assets. Copies onnxruntime WASM into
// apps/app/public/ort/ and downloads the model files directly from Hugging Face into
// apps/app/public/models/<repo>/ (the layout transformers.js loads via localModelPath).
// UNIVERSAL: NLLB-200 covers ~200 languages (any→any); opus-mt en↔hi is kept as a small
// fast-path for the most common pair. Direct HTTP — no Node ONNX runtime required.
// After this, translation runs fully on-device with zero third-party egress.
//
// Run after install:  node scripts/fetch-translation-assets.mjs
// NOTE: NLLB is large (~0.5 GB quantized); the first run downloads it once.
import { createRequire } from "node:module";
import { cpSync, mkdirSync, createWriteStream, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const require = createRequire(import.meta.url);
const publicDir = join(process.cwd(), "apps/app/public");

// 1) onnxruntime WASM -> public/ort/. transformers.js v3 BUNDLES the ort runtime in its
// own dist (there is no separate onnxruntime-web package), so source it from there.
const ortDist = join(process.cwd(), "apps/app/node_modules/@huggingface/transformers/dist");
const ortOut = join(publicDir, "ort");
mkdirSync(ortOut, { recursive: true });
for (const f of readdirSync(ortDist)) {
  if (f.endsWith(".wasm") || f.endsWith(".mjs")) cpSync(join(ortDist, f), join(ortOut, f));
}
console.log("onnxruntime WASM -> apps/app/public/ort/");

// 2) translation models -> public/models/<repo>/ (direct HF download). STREAM to disk so large
// ONNX weights (hundreds of MB) don't get loaded into memory (that was silently killing the fetch).
const HF = "https://huggingface.co";
async function dl(repo, rel) {
  const url = `${HF}/${repo}/resolve/main/${rel}`;
  const out = join(publicDir, "models", repo, rel);
  mkdirSync(dirname(out), { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url);
    if (!res.ok || !res.body) { console.warn("  skip", rel, res.status); return false; }
    const expected = Number(res.headers.get("content-length") || 0);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
    const got = statSync(out).size;
    if (!expected || got === expected) { console.log("  ", rel, `(${(got / 1048576).toFixed(0)}MB)`); return true; }
    console.warn(`  retry ${rel}: got ${got} of ${expected} bytes (attempt ${attempt})`);
  }
  throw new Error(`incomplete download after retries: ${rel}`);
}

// NLLB-200 — the universal model. Download ONLY the q8 (quantized) weights the browser uses,
// plus the tokenizer/config (the fp32 weights are ~3.4 GB; the quantized pair is ~0.5 GB).
console.log("downloading Xenova/nllb-200-distilled-600M (quantized) …");
const NLLB = "Xenova/nllb-200-distilled-600M";
for (const rel of [
  "config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
  "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx",
]) await dl(NLLB, rel);

// opus-mt en<->hi fast-path (small).
for (const repo of ["Xenova/opus-mt-en-hi", "Xenova/opus-mt-hi-en"]) {
  console.log("downloading", repo, "…");
  const info = await (await fetch(`${HF}/api/models/${repo}`)).json();
  for (const s of info.siblings ?? []) {
    const rel = s.rfilename;
    if (rel.startsWith("onnx/") && !rel.includes("quantized")) continue; // quantized ONNX only
    await dl(repo, rel);
  }
}
console.log("translation models -> apps/app/public/models/. On-device translation ready.");
