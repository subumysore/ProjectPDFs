# Fill-engine accuracy benchmark (RFC-0010)

Measures the form-fill engine on **precision / recall / blank-correctness** against per-form ground
truth — real accuracy, not just coverage — over 15 real government forms.

## Layout
- `forms/` — 15 source PDFs (`01`–`15`; USCIS + IRS, 1–24 pages). Re-fetch with the URLs in git history.
- `ground-truth/NN-*.json` — assertions: locate a field (by `id`/`idRe`/`tipRe`/`capRe`) → `expect` a
  vault value (optionally `"mode":"contains"`) or `""` for a field that must stay BLANK (the negatives).
- `results/` — generated: `catalog.json`, `baseline-current.{json,md}`, `granite.json`.
- Harness + engines: `scripts/engine-benchmark/`.

## Run the current engine (baseline)
```
node scripts/engine-benchmark/catalog.mjs                       # per-form structure
node scripts/engine-benchmark/run-current.mjs                   # score every form
node scripts/engine-benchmark/report.mjs baseline-current.json  # -> results/baseline-current.md + rollup
```
Latest: **P=90% R=73% blank-correctness=77%** over 7 labeled forms (shipped proximity+tooltip engine).

## Metrics
- **Precision** — of labeled fields we filled, how many correct.
- **Recall** — of fields that should be filled, how many we got.
- **Blank-correctness** — of fields that should stay BLANK, how many we correctly left blank (over-fill guard).

## Add / extend ground truth
Dump a form's fields to pick locators, then write assertions:
```
node scripts/engine-benchmark/dump.mjs 10-irs-w4.pdf "name|address|ssn"
```

## Complete the Granite-Docling comparison (Phase 3, currently PENDING)
`run-granite.mjs` records `results/granite.json` = **PENDING** here because this environment lacks a PDF
rasteriser (`@napi-rs/canvas` is stubbed) to make the VLM's page images, and the model isn't fetched.
To produce real numbers:
1. Provide a rasteriser: `pnpm add @napi-rs/canvas` (real build) — feeds `form.__renderPage`.
2. Provide the model: fetch `onnx-community/granite-docling-258M-ONNX` (int8) into a dir and set
   `GRANITE_MODEL_DIR`, or allow remote download in `granite.mjs`.
3. `node scripts/engine-benchmark/run-granite.mjs && node scripts/engine-benchmark/report.mjs granite.json "Granite-Docling"`.

No Granite accuracy number is reported until this runs — by design.
