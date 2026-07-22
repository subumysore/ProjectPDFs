// On-device translation (REQ-03), English <-> Hindi. Uses transformers.js (ONNX
// via onnxruntime-web WASM), configured SELF-HOSTED: models load from the app
// origin (/models), so connect-src stays 'self' — the text never leaves the
// device. Models are fetched to public/models at setup (scripts/fetch-translation-assets.mjs),
// NOT committed to git. transformers.js is dynamically imported so vite code-splits
// it and doesn't eagerly bundle its optional node-only deps.

export { detectLang } from "./fill/lang";
// SHARED ENGINE: FLORES-200 codes + the language registry (same source as the extension).
import { flores, isKnown, allLangs } from "@engine/langcodes.js";

export type Direction = string; // e.g. "en-hi" (opus fast-path) or any pair via NLLB

/** Every language the engine can handle (the registry — not a fixed 8). */
export const LANGUAGES = allLangs();

// Universal many-to-many model (FLORES codes) — covers ~200 languages, any→any. The small
// opus-mt models below are an OPTIONAL fast-path for common pairs, never a cap.
const NLLB_MODEL = "Xenova/nllb-200-distilled-600M";

const MODELS: Record<string, string> = {
  "en-hi": "Xenova/opus-mt-en-hi", "hi-en": "Xenova/opus-mt-hi-en",
  "en-es": "Xenova/opus-mt-en-es", "es-en": "Xenova/opus-mt-es-en",
  "en-fr": "Xenova/opus-mt-en-fr", "fr-en": "Xenova/opus-mt-fr-en",
  "en-de": "Xenova/opus-mt-en-de", "de-en": "Xenova/opus-mt-de-en",
  "en-zh": "Xenova/opus-mt-en-zh", "zh-en": "Xenova/opus-mt-zh-en",
  "en-ar": "Xenova/opus-mt-en-ar", "ar-en": "Xenova/opus-mt-ar-en",
  "en-ru": "Xenova/opus-mt-en-ru", "ru-en": "Xenova/opus-mt-ru-en",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache: Partial<Record<Direction, any>> = {};

async function getTranslator(dir: Direction, onStatus?: (s: string) => void) {
  if (cache[dir]) return cache[dir];
  const { pipeline, env } = await import("@huggingface/transformers");
  // Self-hosted only: models AND the onnxruntime WASM load from the app origin,
  // never a third-party CDN — connect-src stays 'self', zero egress.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = "http://ppfmodel.localhost/"; // served by the Rust ppfmodel scheme from app-data/models
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (env.backends as any).onnx.wasm.wasmPaths = "/ort/";
  onStatus?.("loading translation model…");
  const t = await pipeline("translation", MODELS[dir]);
  cache[dir] = t;
  return t;
}

/** Translate text in the given direction, on-device. */
export async function translate(
  text: string,
  dir: Direction,
  onStatus?: (s: string) => void,
): Promise<string> {
  if (!text.trim()) return "";
  const translator = await getTranslator(dir, onStatus);
  const out = await translator(text);
  const first = Array.isArray(out) ? out[0] : out;
  return (first as { translation_text?: string }).translation_text ?? "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getNllb(onStatus?: (s: string) => void): Promise<any> {
  if (cache.__nllb) return cache.__nllb;
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = "http://ppfmodel.localhost/"; // served by the Rust ppfmodel scheme from app-data/models
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (env.backends as any).onnx.wasm.wasmPaths = "/ort/";
  onStatus?.("loading the universal translation model (first run)…");
  cache.__nllb = await pipeline("translation", NLLB_MODEL);
  return cache.__nllb;
}

/** Any pair of known languages is reachable (NLLB is many-to-many). */
export function canTranslate(from: string, to: string): boolean {
  if (from === to) return true;
  return isKnown(from) && isKnown(to);
}

/**
 * Translate between ANY two languages, on-device. Uses a small direct opus-mt model when one
 * exists (fast), otherwise the universal NLLB-200 model via FLORES codes. Do NOT pass identity
 * data — only labels and free-text answers (spec: language-aware filling).
 */
export async function translateText(
  text: string,
  from: string,
  to: string,
  onStatus?: (s: string) => void,
): Promise<string> {
  if (!text || !text.trim()) return "";
  if (from === to) return text;
  if (MODELS[`${from}-${to}`]) return translate(text, `${from}-${to}`, onStatus); // fast-path
  if (isKnown(from) && isKnown(to)) {
    const t = await getNllb(onStatus);
    const out = await t(text, { src_lang: flores(from), tgt_lang: flores(to) });
    const first = Array.isArray(out) ? out[0] : out;
    return (first as { translation_text?: string }).translation_text ?? "";
  }
  throw new Error(`no translation path ${from}→${to}`);
}
