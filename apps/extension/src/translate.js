// On-device translation for the extension (RFC-0006 Phase 2). Uses transformers.js
// (vendored, script-src 'self') with the ONNX WASM runtime, loading the opus-mt models
// from OUR self-hosted origin — so the text never leaves the device; only the model
// weights are downloaded (assets down). Mirrors the desktop app's translate.ts.
import { pipeline, env } from "../vendor/transformers/transformers.web.min.js";

// Self-hosted model base (Object Storage). transformers.js fetches
// `${remoteHost}/${model}/resolve/${revision}/<file>`.
const MODELS_BASE =
  "https://objectstorage.us-ashburn-1.oraclecloud.com/p/mVU6krQBQmHQ00Ycw2z9VIEHTVCUNvoxfHbMRWJ47_dtvu1qzK75KlcauXk94YXd/n/idlqdkwlstnb/b/polyglotformfill-dl/o/models";

env.allowRemoteModels = true;
env.allowLocalModels = false;
env.remoteHost = MODELS_BASE;
env.remotePathTemplate = "{model}/resolve/{revision}/";
// Single-threaded WASM (extensions lack cross-origin isolation for threads); load the
// ort WASM from the extension package.
try {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("vendor/transformers/");
} catch (_) {
  /* not in an extension context (e.g. a test) */
}

export const DIRECTIONS = {
  "en-hi": "Xenova/opus-mt-en-hi",
  "hi-en": "Xenova/opus-mt-hi-en",
};

const cache = {};
async function getTranslator(dir, onStatus) {
  if (cache[dir]) return cache[dir];
  onStatus?.("loading model (first run downloads ~110 MB, then cached)…");
  const t = await pipeline("translation", DIRECTIONS[dir]);
  cache[dir] = t;
  return t;
}

/** Translate text in the given direction (e.g. "en-hi"), fully on-device. */
export async function translate(text, dir, onStatus) {
  if (!text.trim()) return "";
  if (!DIRECTIONS[dir]) throw new Error(`no model for ${dir}`);
  const translator = await getTranslator(dir, onStatus);
  const out = await translator(text);
  const first = Array.isArray(out) ? out[0] : out;
  return first?.translation_text ?? "";
}
