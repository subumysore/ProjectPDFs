# 0030 — Fill hybrid-XFA / LiveCycle forms via the pdf.js widget layer

- Status: Accepted
- Date: 2026-08-02
- Deciders: project owner
- Supersedes/relates: complements the proximity fill (ADR n/a) and the shared engine parity rule

## Context

USCIS forms (N-400, I-130, …) and many other government forms are **hybrid-XFA / LiveCycle** PDFs.
`pdf-lib` — our writer for AcroForm fill — **cannot parse them at all**: `getForm().getFields()`
returns 0 and `getPages()` throws `Expected instance of PDFDict, but got undefined`. The app therefore
mis-classified a fully-fillable form (the N-400 has 440 widgets / 237 text fields) as **flat**, offered
no fill, and its OCR-detect fallback found nothing. Users could neither auto-fill nor manually fill.

Constraint: the **privacy invariant** — all processing stays on-device. Constraint: the output must
**stay editable** (a flattened raster would break signing/further edits and reads as "lost my form").

## Decision

When `pdf-lib` reports 0 fields (or cannot parse the form), fall back to **pdf.js**, which already
renders these forms on-device and can also **write** them:

1. Enumerate widget annotations with pdf.js (`getAnnotations()`): name, type, rect, export value.
2. Label each box by its **printed caption** using the shared `planProximityFill` planner (no per-form
   rules) and resolve caption→value with the shared resolver; review-editor values override the plan.
3. Set each widget in `doc.annotationStorage.setValue(id, …)` and emit the filled PDF with
   `doc.saveDocument()`.

`saveDocument()` produces a **valid PDF that keeps every field editable** (verified: a filled N-400
reloads with all 440 widgets intact and the values present). No pdf-lib touch of the source; no raster;
no cloud.

## Consequences

- N-400 / I-130 and similar now fill from the vault and stay editable (see
  `docs/testing/pdf-fill-battery-2026-08.md`).
- The "Fill from my vault" button is promoted to a prominent primary action; auto-fill-on-load and the
  button both use the fallback.
- Desktop-only for now (`apps/app/src/pdf.ts::fillXfaByWidgets`). **Parity TODO:** the extension's PDF
  fill path (pdf-lib based) needs the same pdf.js `saveDocument` fallback to stay on par.
- Known limitation carried forward: tooltip-less AcroForms with labels-above-boxes (IRS W-4/W-9) still
  fill weakly via proximity — documented, not regressed.
