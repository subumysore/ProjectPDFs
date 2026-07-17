#!/usr/bin/env node
// Provision SELF-HOSTED on-device translation assets (REQ-03), English <-> Hindi.
// Copies onnxruntime-web's WASM into apps/app/public/ort/ and downloads the opus-mt
// model files directly from Hugging Face into apps/app/public/models/<repo>/ (the
// layout transformers.js loads via localModelPath). Direct HTTP — no Node ONNX
// runtime required (onnxruntime-node is stubbed; the browser uses onnxruntime-web).
// After this, translation runs fully on-device with zero third-party egress.
//
// Run after `pnpm install`:  node scripts/fetch-translation-assets.mjs
import { createRequire } from "node:module";
import { cpSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const publicDir = join(process.cwd(), "apps/app/public");

// 1) onnxruntime-web WASM -> public/ort/
const ortDist = join(dirname(require.resolve("onnxruntime-web/package.json")), "dist");
const ortOut = join(publicDir, "ort");
mkdirSync(ortOut, { recursive: true });
for (const f of readdirSync(ortDist)) {
  if (f.endsWith(".wasm") || f.endsWith(".mjs")) cpSync(join(ortDist, f), join(ortOut, f));
}
console.log("onnxruntime WASM -> apps/app/public/ort/");

// 2) translation models -> public/models/<repo>/ (direct HF download; quantized ONNX only)
const HF = "https://huggingface.co";
for (const repo of ["Xenova/opus-mt-en-hi", "Xenova/opus-mt-hi-en"]) {
  console.log("downloading", repo, "…");
  const info = await (await fetch(`${HF}/api/models/${repo}`)).json();
  for (const s of info.siblings ?? []) {
    const rel = s.rfilename;
    // Keep only the quantized ONNX weights (what transformers.js loads by default).
    if (rel.startsWith("onnx/") && !rel.includes("quantized")) continue;
    const res = await fetch(`${HF}/${repo}/resolve/main/${rel}`);
    if (!res.ok) {
      console.warn("  skip", rel, res.status);
      continue;
    }
    const out = join(publicDir, "models", repo, rel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log("  ", rel);
  }
}
console.log("translation models -> apps/app/public/models/. On-device translation ready.");
