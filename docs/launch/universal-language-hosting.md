# Hosting the universal-language assets (NLLB + Tesseract packs)

The universal engine (RFC-0008 / ADR-0018) is wired in code. To make it work **in the browser**,
the model + OCR assets must be uploaded to our object storage — served DOWN to the device only
(privacy invariant: no user content ever goes up). Nothing here contacts a third party at runtime.

## 1. NLLB-200 translation model

`translate.js` requests `Xenova/nllb-200-distilled-600M`. transformers.js resolves each file as
`${MODELS_BASE}/Xenova/nllb-200-distilled-600M/resolve/main/<file>` where `MODELS_BASE` is the
storage prefix already set in `translate.js` (`env.remoteHost`).

Steps:
1. Download the model from Hugging Face: `https://huggingface.co/Xenova/nllb-200-distilled-600M`
   (files: `config.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`,
   `generation_config.json`, and the `onnx/` quantized weights transformers.js loads —
   `encoder_model_quantized.onnx`, `decoder_model_merged_quantized.onnx`).
2. Upload them to object storage under `.../o/models/Xenova/nllb-200-distilled-600M/resolve/main/…`
   preserving the `onnx/` subfolder — matching the existing opus-mt layout.
3. Size: ~300–600 MB (int8). It downloads once per device, then caches. (Desktop app is the ideal
   host; for the extension, consider gating the first download behind a clear one-time prompt.)

VERIFIED (node POC, this session): NLLB-200 runs on-device and translates real Kannada→English
("ಕರ್ನಾಟಕ ಸ್ಟ್ಯಾಂಪ್ ನಿಯಮಗಳು" → "Karnataka stamp rules").

## 2. Tesseract language packs (OCR for any script)

`tess.js` fetches `${TESS_LANG}/<pack>.traineddata.gz`. Upload the packs for the scripts you want
to support first, from `tessdata_fast` (smaller) or `tessdata`:
`https://github.com/tesseract-ocr/tessdata_fast`

Priority packs (map is `langcodes.js tess`):
- `kan` (Kannada), `tam` (Tamil), `tel` (Telugu), `mal` (Malayalam), `hin` (Hindi/Devanagari),
  `ben` (Bengali), `guj` (Gujarati), `pan` (Punjabi), `ori` (Odia), `ara` (Arabic),
  `chi_sim` (Chinese), `jpn` (Japanese), `kor` (Korean), plus `eng` (already hosted).

Upload each `<pack>.traineddata.gz` to `.../o/tesseract/`. Each is ~1–15 MB, downloaded on demand
for the detected/selected script, then cached.

## 3. Remaining code wiring (after assets are up)

- Viewer "source language" picker for scanned / legacy-font forms (whose text layer is garbage):
  render → OCR in the chosen script's pack → NLLB translate → show source ↔ translation.
  (`translateScannedPdf(bytes, { to, from })` is ready; it OCRs in `tessPack(from)`.)
- In-browser validation on the Karnataka Kannada form + a CJK and an RTL sample before marking the
  capability "done" in the traceability matrix.
