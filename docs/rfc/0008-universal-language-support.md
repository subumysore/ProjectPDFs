# RFC-0008 — Universal on-device language support (any language, not a fixed set)

- Status: Proposed
- Date: 2026-07-21
- Supersedes: RFC-0006 (extension language packs — the fixed 8-language opus-mt design)
- Related: ADR-0017 (user-selectable fill language), the PRIVACY INVARIANT (on-device only)

## Problem

The product is **PolyglotFormFill** — polyglot means *any* language. But the implementation
hard-codes a set of eight: `en, hi, es, fr, de, zh, ar, ru` (`lang.js SUPPORTED_LANGS`,
`translate.js DIRECTIONS/LANGUAGES`). Anything outside that set — Kannada, Tamil, Telugu,
Malayalam, Bengali, Gujarati, Punjabi, Odia, Japanese, Korean, Thai, Hebrew, Greek, … — cannot
be detected, OCR'd, or translated. A real Karnataka government form (Kannada) produced **nothing**
on "View in my language", and the banner still claimed success. This is a fundamental gap, not a
missing feature: the fixed list contradicts the product's core promise.

Two compounding issues surfaced on the Kannada form:
1. **Language cap** — no Kannada model exists in the fixed set.
2. **Legacy-font text layer** — many Indian govt PDFs store text in a non-Unicode ASCII-mapped
   font (Nudi/Baraha). The extractable text is garbage Latin; the real script only exists as
   rendered glyphs. Text-layer MT is impossible; the page must be **rendered and OCR'd**.

## Proposal

Make the engine **language-agnostic**. A language is supported if we can detect its script, OCR
it, and translate it — and the chosen components already cover ~200 languages.

1. **Registry (`langcodes.js`, done):** one row per language → `{ flores (NLLB code), tess
   (Tesseract pack), script }`. Adding a language is a data row, not code. Script detection by
   Unicode range covers all major scripts (Indic, CJK, Arabic, Thai, Hebrew, Greek, Cyrillic…).
2. **Translation — NLLB-200:** replace the 14 fixed opus-mt models with one many-to-many model
   (`nllb-200-distilled-600M`, FLORES-200 codes, direct any→any, no English pivot). Served from
   our object storage (assets DOWN only; user text never leaves the device).
3. **OCR — dynamic Tesseract packs:** load the pack for the detected script on demand
   (`kan`, `tam`, `tel`, `hin`, `ara`, `chi_sim`, `jpn`, …), hosted on our storage.
4. **Garbage/scanned text layer → OCR fallback:** when a page has no usable Unicode text
   (empty, or a low-confidence/garbage layer while the render clearly has script), render the
   page and OCR it to recover real Unicode, then translate.
5. **Honest UX:** never claim "viewing in your language" unless text was actually translated;
   when a form can't be read, say so and why.

## Privacy

Unchanged and central: **only model/OCR assets are downloaded (server→device); no user content
is ever uploaded.** NLLB weights and Tesseract packs are static assets served downward, cached
on-device, and run locally — identical trust model to the current opus-mt packs.

## Trade-offs / risks

- **Model size.** NLLB-200-distilled-600M is ~600 MB–1.2 GB (quantized). Heavy for a browser
  extension; acceptable for the desktop app. Mitigations: int8 quantization, lazy first-use
  download + cache, and possibly keeping small fast opus-mt models as an *optimization* for the
  most common pairs (never as a cap). Evaluate a smaller distilled model if quality holds.
- **Per-language OCR quality** varies; complex Indic conjuncts are hardest. Acceptable as a
  first pass; users still see the original alongside.
- **Validation.** Must be proven in-browser (render→OCR→NLLB) before claiming support.

## Rollout (proof-gated)

1. Registry + all-script detection + honest UX. **(this change)**
2. Host NLLB + priority Tesseract packs (kn, ta, te, hi, …) on object storage.
3. Wire universal `translateText(any→any)` via NLLB; keep opus-mt fast-path optional.
4. Wire render→OCR fallback for garbage/scanned layers.
5. In-browser proof on the Kannada form (and a CJK + RTL sample) before marking done.
