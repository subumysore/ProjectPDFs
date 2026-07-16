#!/usr/bin/env node
// Provision SELF-HOSTED on-device translation assets (REQ-03), English <-> Hindi.
// Downloads the opus-mt ONNX models into apps/app/public/models/ (HF layout the
// browser loads via localModelPath) and copies onnxruntime-web's WASM into
// apps/app/public/ort/. After this, translation runs fully on-device with zero
// third-party egress (connect-src stays 'self').
//
// Run after `pnpm install`:  node scripts/fetch-translation-assets.mjs
import { createRequire } from "node:module";
import { cpSync, mkdirSync, readdirSync } from "node:fs";
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

// 2) translation models -> public/models/ (transformers.js caches in HF layout)
const { pipeline, env } = await import("@huggingface/transformers");
env.cacheDir = join(publicDir, "models");
env.allowRemoteModels = true;
for (const model of ["Xenova/opus-mt-en-hi", "Xenova/opus-mt-hi-en"]) {
  console.log("downloading", model, "…");
  await pipeline("translation", model);
}
console.log("translation models -> apps/app/public/models/. On-device translation ready.");
