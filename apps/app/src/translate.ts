// On-device translation (REQ-03), English <-> Hindi. Uses transformers.js (ONNX
// via onnxruntime-web WASM), configured SELF-HOSTED: models load from the app
// origin (/models), so connect-src stays 'self' — the text never leaves the
// device. Models are fetched to public/models at setup (scripts/fetch-translation-assets.mjs),
// NOT committed to git. transformers.js is dynamically imported so vite code-splits
// it and doesn't eagerly bundle its optional node-only deps.

export { detectLang } from "./fill/lang";

export type Direction = string; // e.g. "en-hi"; any pair among LANGUAGES (pivots via en)

/** All languages we can translate to/from (English is the pivot hub). */
export const LANGUAGES = ["en", "hi", "es", "fr", "de", "zh", "ar", "ru"];

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
  env.localModelPath = "/models/";
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

/** Is a pair reachable (directly or by pivoting through English)? */
export function canTranslate(from: string, to: string): boolean {
  if (from === to) return true;
  return LANGUAGES.includes(from) && LANGUAGES.includes(to);
}

/**
 * Translate between ANY two supported languages, pivoting via English when there is
 * no direct model (e.g. hi→en→fr). On-device. Do NOT pass identity data — only labels
 * and free-text answers (spec: language-aware filling).
 */
export async function translateText(
  text: string,
  from: string,
  to: string,
  onStatus?: (s: string) => void,
): Promise<string> {
  if (!text || !text.trim()) return "";
  if (from === to) return text;
  if (MODELS[`${from}-${to}`]) return translate(text, `${from}-${to}`, onStatus);
  if (from !== "en" && to !== "en" && MODELS[`${from}-en`] && MODELS[`en-${to}`]) {
    onStatus?.(`translating ${from}→en→${to} (on-device)…`);
    const mid = await translate(text, `${from}-en`, onStatus);
    return translate(mid, `en-${to}`, onStatus);
  }
  throw new Error(`no translation path ${from}→${to}`);
}
