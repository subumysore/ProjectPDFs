// PHASE 2 — Granite-Docling-258M engine (experimental, on-device). Same contract as currentEngine:
//   graniteEngine(form) -> [{ id, caption, value }]
// It understands layout STRUCTURALLY (VLM) rather than by pixel proximity, targeting the no-tooltip /
// label-above forms where the proximity engine's recall craters (W-4 20%, W-9 33%).
//
// Pipeline: rasterise each PDF page -> run the VLM (DocTags) -> parse key/value regions with bboxes ->
// bind each printed KEY to the nearest widget rect -> resolve the KEY to a vault value via the shared
// resolver (so the fill semantics stay identical to the current engine; only the LABELLING changes).
//
// HONESTY GUARDS (this environment): running requires (1) a PDF rasteriser to produce the VLM's image
// input — `@napi-rs/canvas` is stubbed here — and (2) the ~260 MB int8 model in a local dir. When either
// is missing we throw a typed `GraniteUnavailable` so the runner records "pending", never fake numbers.
import { resolveFields } from "../../apps/extension/src/resolver.js";
import { VAULT } from "./score.mjs";

export class GraniteUnavailable extends Error {}

const MODEL_ID = "onnx-community/granite-docling-258M-ONNX"; // int8 via transformers.js
const PROMPT = "Convert this form page to structured key-value pairs with their bounding boxes.";

// Lazy singletons so the model loads once per process.
let _model = null, _processor = null, _tf = null;

async function loadTransformers() {
  try {
    _tf = _tf || await import("@huggingface/transformers");
    return _tf;
  } catch {
    throw new GraniteUnavailable("@huggingface/transformers not installed (pnpm add @huggingface/transformers)");
  }
}

// Rasterise a pdf.js page to an ImageData-like {data,width,height}. Requires a real canvas; in Node
// that means @napi-rs/canvas (a stub is shipped here) or node-canvas. Throws GraniteUnavailable if none.
async function makeCanvasFactory() {
  let mod = null;
  try { mod = await import("@napi-rs/canvas"); } catch { /* try next */ }
  if (!mod || !mod.createCanvas) { try { mod = await import("canvas"); } catch { /* none */ } }
  if (!mod || !mod.createCanvas) throw new GraniteUnavailable("no PDF rasteriser (install @napi-rs/canvas or canvas) — VLM needs page images");
  return (w, h) => mod.createCanvas(w, h);
}

async function loadModel(dir) {
  const tf = await loadTransformers();
  if (dir) { tf.env.allowRemoteModels = false; tf.env.localModelPath = dir; }
  try {
    _processor = _processor || await tf.AutoProcessor.from_pretrained(MODEL_ID);
    _model = _model || await tf.AutoModelForVision2Seq.from_pretrained(MODEL_ID, { dtype: "q8" });
  } catch (e) {
    throw new GraniteUnavailable(`model not available (${MODEL_ID}): ${e.message}. Set GRANITE_MODEL_DIR to a local copy or allow remote download.`);
  }
  return { tf, model: _model, processor: _processor };
}

// Parse the VLM's DocTags/markup into [{ key, bbox:{x,y,w,h} }] in PDF user-space per page. This is the
// piece that needs on-device validation against real Granite output; kept isolated + defensive.
function parseDocTags(/* text, page, viewport */) {
  // TODO(validated-on-device): map DocTags <loc_x><loc_y>… + key spans to PDF-space bboxes.
  return [];
}

export async function graniteEngine(form, { modelDir = process.env.GRANITE_MODEL_DIR } = {}) {
  const canvasFor = await makeCanvasFactory();      // throws GraniteUnavailable if no rasteriser
  const { model, processor, tf } = await loadModel(modelDir); // throws GraniteUnavailable if no model

  // For each page: rasterise -> VLM -> parse keys+bboxes.
  const keyRegions = [];
  for (let pi = 0; pi < form.pages; pi++) {
    const img = form.__renderPage ? await form.__renderPage(pi, canvasFor) : null;
    if (!img) continue;
    const inputs = await processor(PROMPT, img);
    const out = await model.generate({ ...inputs, max_new_tokens: 4096 });
    const text = processor.batch_decode(out, { skip_special_tokens: true })[0];
    keyRegions.push(...parseDocTags(text, pi));
  }

  // Bind each printed KEY to the nearest widget, then resolve the key to a vault value.
  const assignments = [];
  for (const f of form.fields) {
    const cx = f.rect.x + f.rect.width / 2, cy = f.rect.y + f.rect.height / 2;
    let best = null, bestD = Infinity;
    for (const k of keyRegions) {
      if (k.page !== f.page) continue;
      const d = Math.hypot(k.bbox.x - cx, k.bbox.y - cy);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (!best) continue;
    const value = resolveFields(VAULT, [{ label: best.key, name: f.id }])[0];
    if (value) assignments.push({ id: f.id, caption: best.key, value });
  }
  return assignments;
}
