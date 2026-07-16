// On-device translation (REQ-03), English <-> Hindi. Uses transformers.js (ONNX
// via onnxruntime-web WASM), configured SELF-HOSTED: models load from the app
// origin (/models), so connect-src stays 'self' — the text never leaves the
// device. Models are fetched to public/models at setup (scripts/fetch-translation-assets.mjs),
// NOT committed to git. transformers.js is dynamically imported so vite code-splits
// it and doesn't eagerly bundle its optional node-only deps.

export type Direction = "en-hi" | "hi-en";

const MODELS: Record<Direction, string> = {
  "en-hi": "Xenova/opus-mt-en-hi",
  "hi-en": "Xenova/opus-mt-hi-en",
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
