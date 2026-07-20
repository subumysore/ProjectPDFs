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
  "en-hi": "Xenova/opus-mt-en-hi", "hi-en": "Xenova/opus-mt-hi-en",
  "en-es": "Xenova/opus-mt-en-es", "es-en": "Xenova/opus-mt-es-en",
  "en-fr": "Xenova/opus-mt-en-fr", "fr-en": "Xenova/opus-mt-fr-en",
  "en-de": "Xenova/opus-mt-en-de", "de-en": "Xenova/opus-mt-de-en",
  "en-zh": "Xenova/opus-mt-en-zh", "zh-en": "Xenova/opus-mt-zh-en",
  "en-ar": "Xenova/opus-mt-en-ar", "ar-en": "Xenova/opus-mt-ar-en",
  "en-ru": "Xenova/opus-mt-en-ru", "ru-en": "Xenova/opus-mt-ru-en",
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

/** All languages we can translate to/from (English is the pivot hub). */
export const LANGUAGES = ["en", "hi", "es", "fr", "de", "zh", "ar", "ru"];

/** Is a language pair reachable (directly or by pivoting through English)? */
export function canTranslate(from, to) {
  if (from === to) return true;
  return LANGUAGES.includes(from) && LANGUAGES.includes(to);
}

/**
 * Translate between ANY two supported languages, pivoting through English when no
 * direct model exists (e.g. hi→en→fr). All hops are on-device. Identity data should
 * NOT be passed here — only labels/questions and free-text answers (per the spec).
 */
export async function translateText(text, from, to, onStatus) {
  if (!text || !text.trim()) return "";
  if (from === to) return text;
  const direct = `${from}-${to}`;
  if (DIRECTIONS[direct]) return translate(text, direct, onStatus);
  // Pivot via English.
  if (from !== "en" && to !== "en" && DIRECTIONS[`${from}-en`] && DIRECTIONS[`en-${to}`]) {
    onStatus?.(`translating ${from}→en→${to} (on-device)…`);
    const mid = await translate(text, `${from}-en`, onStatus);
    return translate(mid, `en-${to}`, onStatus);
  }
  throw new Error(`no translation path ${from}→${to}`);
}
