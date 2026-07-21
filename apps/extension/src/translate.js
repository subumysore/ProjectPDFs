// On-device translation for the extension (RFC-0006 Phase 2). Uses transformers.js
// (vendored, script-src 'self') with the ONNX WASM runtime, loading the opus-mt models
// from OUR self-hosted origin — so the text never leaves the device; only the model
// weights are downloaded (assets down). Mirrors the desktop app's translate.ts.
// Self-contained bundle (esbuild — resolves onnxruntime internally; the pre-min build
// had an unresolved bare `onnxruntime-common` import that broke translation entirely).
import { pipeline, env } from "../vendor/transformers/transformers.bundle.mjs";
import { flores, isKnown, allLangs } from "./langcodes.js";

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

// Universal many-to-many model (FLORES-200 codes) — covers ~200 languages, any→any, no English
// pivot. This is what makes the engine language-AGNOSTIC (RFC-0008 / ADR-0018). The small opus-mt
// models above are kept only as an OPTIONAL fast-path for the most common pairs; they are NOT a
// cap — anything they don't cover falls through to NLLB. Weights are served from OUR storage.
const NLLB_MODEL = "Xenova/nllb-200-distilled-600M";

const cache = {};
async function getOpus(dir, onStatus) {
  if (cache[dir]) return cache[dir];
  onStatus?.("loading model (first run downloads, then cached)…");
  cache[dir] = await pipeline("translation", DIRECTIONS[dir]);
  return cache[dir];
}
async function getNllb(onStatus) {
  if (cache.__nllb) return cache.__nllb;
  onStatus?.("loading the universal translation model on-device (first run downloads it)…");
  cache.__nllb = await pipeline("translation", NLLB_MODEL);
  return cache.__nllb;
}

/** Translate text in a fixed opus-mt direction (e.g. "en-hi"). Back-compat fast-path. */
export async function translate(text, dir, onStatus) {
  if (!text.trim()) return "";
  if (!DIRECTIONS[dir]) throw new Error(`no model for ${dir}`);
  const translator = await getOpus(dir, onStatus);
  const out = await translator(text);
  return (Array.isArray(out) ? out[0] : out)?.translation_text ?? "";
}

/** Every language the engine can handle (the registry — not a hard-coded 8). */
export const LANGUAGES = allLangs();

/** Any pair of known languages is reachable (NLLB is many-to-many). */
export function canTranslate(from, to) {
  if (from === to) return true;
  return isKnown(from) && isKnown(to);
}

/**
 * Translate between ANY two languages, fully on-device. Uses a small direct opus-mt model when
 * one exists (fast), otherwise the universal NLLB-200 model via FLORES codes. Identity data must
 * NOT be passed here — only labels/questions and free-text answers (per the spec).
 */
export async function translateText(text, from, to, onStatus) {
  if (!text || !text.trim()) return "";
  if (from === to) return text;
  const direct = `${from}-${to}`;
  if (DIRECTIONS[direct]) return translate(text, direct, onStatus); // fast-path for common pairs
  if (isKnown(from) && isKnown(to)) {
    const t = await getNllb(onStatus);
    const out = await t(text, { src_lang: flores(from), tgt_lang: flores(to) });
    return (Array.isArray(out) ? out[0] : out)?.translation_text ?? "";
  }
  throw new Error(`no translation path ${from}→${to}`);
}
