// Granite-Docling-258M on-device inference (RFC-0010, milestone 2). Loads the cached model (fetched by
// download_granite_model into app-data/models/granite-docling-258M and served via the `ppfmodel` scheme,
// exactly like NLLB), renders a PDF page to an image, and runs the vision-language model to read the
// page's LAYOUT into DocTags. Everything on-device: model + onnxruntime WASM load from the app origin,
// zero egress. This is what lets you SEE Granite do something — it returns the structure it extracted.
import { renderPageWithFields } from "./pdf";

const MODEL_ID = "granite-docling-258M";
const PROMPT = "Convert this page to docling.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _proc: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _model: any = null;
let _loading: Promise<void> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tf: any = null;

async function ensure(onStatus?: (s: string) => void) {
  if (_model && _proc) return;
  if (!_loading) {
    _loading = (async () => {
      _tf = await import("@huggingface/transformers");
      const { env } = _tf;
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = "http://ppfmodel.localhost/"; // served from app-data/models by the ppfmodel scheme
      (env.backends as { onnx: { wasm: { wasmPaths: string } } }).onnx.wasm.wasmPaths = "/ort/";
      onStatus?.("Loading Granite processor…");
      _proc = await _tf.AutoProcessor.from_pretrained(MODEL_ID);
      onStatus?.("Loading Granite model (258M, first run is slow)…");
      // The model is 3 ONNX components; load the *_quantized (q8) shards we downloaded.
      const Cls = _tf.AutoModelForImageTextToText || _tf.AutoModelForVision2Seq;
      _model = await Cls.from_pretrained(MODEL_ID, {
        dtype: { embed_tokens: "q8", vision_encoder: "q8", decoder_model_merged: "q8" },
      });
    })();
  }
  await _loading;
}

/** Render `pageIndex` of the PDF and run Granite over it. Returns the DocTags the model produced. */
export async function graniteReadPage(
  bytes: ArrayBuffer,
  pageIndex: number,
  onStatus?: (s: string) => void,
): Promise<{ doctags: string; ms: number; chars: number }> {
  await ensure(onStatus);
  // Render the page to an offscreen canvas at a legible scale for the vision encoder.
  const canvas = document.createElement("canvas");
  onStatus?.("Rendering the page for Granite…");
  await renderPageWithFields(bytes, pageIndex, canvas, 2.0);
  const image = await _tf.RawImage.fromCanvas(canvas);

  const messages = [{ role: "user", content: [{ type: "image" }, { type: "text", text: PROMPT }] }];
  const text = _proc.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await _proc(text, [image]);

  onStatus?.("Granite is reading the page (on-device)…");
  const t0 = performance.now();
  const generated = await _model.generate({ ...inputs, max_new_tokens: 4096, do_sample: false });
  const ms = Math.round(performance.now() - t0);

  // Decode the FULL sequence (keeping DocTags special tokens), then strip everything up to and including
  // the prompt so we return just the model's answer. (Token-slicing the tensor over-trimmed the output.)
  const outAll = _proc.batch_decode(generated, { skip_special_tokens: false });
  let decoded = Array.isArray(outAll) ? outAll[0] : String(outAll);
  const cut = decoded.lastIndexOf(PROMPT);
  if (cut >= 0) decoded = decoded.slice(cut + PROMPT.length);
  // Trim the chat/end markers around the answer.
  decoded = decoded.replace(/<\|end_of_text\|>|<\|assistant\|>|<end_of_utterance>|<\/s>/g, "").trim();
  return { doctags: decoded, ms, chars: decoded.length };
}
