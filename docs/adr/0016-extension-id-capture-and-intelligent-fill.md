# 0016 — On-device ID capture & intelligent form fill (extension + desktop parity)

- Status: accepted
- Date: 2026-07-20
- Deciders: owner + engineering
- Requirements: REQ-02 (make-fillable/fill), REQ-03 (language), REQ-10 (data-source extraction), REQ-16 (extension)

## Context

The extension needed to (a) capture identity data from IDs/documents, (b) fill real-world
forms whose fields don't literally match vault keys (incl. XFA/LiveCycle like the IRS W-2),
and (c) do it all on-device per the privacy invariant. Front-of-card OCR of glossy,
holographic driver's licences proved unreliable (name OCR'd to garbage on angled/glary
photos). The desktop app had diverged (simple `matchKey`, en/hi only).

## Decision

1. **ID capture is barcode-first, OCR-fallback.** US/Canada licences carry all data in a
   **PDF417 barcode on the back**; decode it (`@zxing`, vendored self-contained ESM) and parse
   the **AAMVA** payload → exact structured fields. Only when no barcode is found do we OCR the
   printed text (Tesseract, shared worker) with grayscale/contrast/upscale preprocessing and
   licence-aware heuristics (unlabelled name/address lines + AAMVA field-number anchors).
2. **Fill is layered, strongest-first:** AcroForm field-NAME templates for known forms
   (W-4/W-9) → semantic resolver by each field's label (tooltip→name) → generic OCR-draw for
   XFA/scanned (W-2) in the persistent viewer tab. Values flow through one shared resolver, so
   vault-key naming is irrelevant; derivations are inherent (compose full name, middle initial,
   **age from DOB**, split SSN, combine/split address).
3. **Image-valued fields:** a photo/signature is stored as a `data:` URI value and DRAWN into
   the matching PDF box (fitted+centred; the covering widget is removed).
4. **Interactive result:** the filled PDF is shown in Chrome's native viewer via `<iframe>`
   (blob) — `object-src` stays `'self'` (MV3 forbids `blob:` there) — so unfilled fields remain
   editable.
5. **Language-aware filling:** `native_language` is a vault PROFILE field; the form's language
   is auto-detected; translation is any-to-any via an English pivot; output stays in the form's
   original language; non-Latin output uses embedded Noto fonts. (See `docs/specs/language-aware-filling.md`.)
6. **Desktop parity via ported shared logic:** the resolver, form templates, language detection,
   and fonts are ported into `apps/app/src/fill/` (kept in sync with the extension), replacing
   `matchKey` and en/hi-only translation.

## Consequences

- **Positive:** licence data is exact (not OCR-guessed); XFA/W-2 and unlabelled forms fill
  on-device; one resolver serves both apps; privacy invariant preserved (only models/fonts are
  fetched — assets-down, no user content leaves).
- **Negative / follow-ups:** glossy-front OCR remains best-effort; the transformers.js translate
  RUNTIME needs a real-browser smoke test; desktop needs non-en/hi models provisioned into
  `public/models`; the ported `apps/app/src/fill/*` currently duplicates the extension source
  (unify into a shared package later).
- **Superseded/refined:** extends ADR-0014 (extension vault security) and the REQ-10 OCR
  extraction; the extension's `object-src blob:` attempt was reverted (invalid under MV3).
