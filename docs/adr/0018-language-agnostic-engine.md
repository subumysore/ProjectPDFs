# ADR-0018 — Language-agnostic engine (NLLB-200 + dynamic OCR packs), not a fixed language set

- Status: Accepted
- Date: 2026-07-21
- Supersedes: the fixed 8-language decision embodied in RFC-0006 / `translate.js DIRECTIONS`
- Context: RFC-0008

## Decision

PolyglotFormFill is language-agnostic. We do **not** maintain an allow-list of supported
languages. Support is defined by capability, backed by broad-coverage components:

- **Detection:** Unicode-range script detection (`langcodes.js`) covering all major world
  scripts, plus a Latin word-vote for en/es/fr/de/…
- **Translation:** NLLB-200 (FLORES-200 codes), one model, any→any, served downward, on-device.
- **OCR:** Tesseract with the language pack for the detected script, loaded on demand from our
  storage; the render→OCR path also handles legacy-font / scanned forms whose text layer is
  unusable (e.g. Karnataka govt Kannada forms).

`langcodes.js` is the single source of truth mapping ISO → FLORES → Tesseract pack. Adding a
language is a one-row data change.

## Consequences

- The `SUPPORTED_LANGS` / `DIRECTIONS` / `LANGUAGES` fixed lists are deprecated; code must route
  through the registry. (Migration is staged — see RFC-0008 rollout.)
- Larger model assets (NLLB) must be hosted and lazily downloaded; the privacy invariant is
  unchanged (assets down only, never user content up).
- UX must be honest: no "translated" claim without an actual translation; unreadable forms are
  reported as such.

## Status of implementation (honest)

- DONE: `langcodes.js` registry + all-script detection (+tests); honest viewer banner/status.
- PENDING (proof-gated): host NLLB + Tesseract packs; wire universal translate + render→OCR
  fallback; in-browser validation on Kannada/CJK/RTL samples before marking the capability done.
