# RFC-0002: On-device DOCX / XLSX form fill

- **Status:** Accepted — **Phase A implemented** (2026-07-18); Phases B/C pending
- **Author(s):** ProjectPDFs team
- **Created:** 2026-07-18
- **Related:** REQ-02 (make non-editable forms fillable), REQ-11 (multi-source: device/web),
  proposes **REQ-15** (multi-format forms: DOCX/XLSX). Produced **ADR-0011** on acceptance.

## Summary
Extend the "Fill a Form" flow from PDF/image to **Word (`.docx`) and Excel (`.xlsx`)**, entirely
on-device. The clean, high-fidelity path fills **named fillable regions** (Word content controls /
legacy form fields; Excel named ranges) by editing the OOXML directly and re-saving the native file.
A second phase adds **flat-document detection** (label → adjacent target) for docs with no named
fields, mirroring the flat-PDF OCR path. No rendering-to-server, no cloud — OOXML files are ZIP+XML
and are manipulated in the webview.

## Motivation
Users think in "**forms**", not "PDFs". A huge share of real-world forms — government annexures, bank
KYC sheets, HR/admissions templates, invoices — ship as `.docx`/`.xlsx`. Today we accept only PDF and
images; picking a Word/Excel file shows a "not supported yet" message. Supporting them:
- closes the gap between the product's promise ("fill a form") and its behaviour;
- is achievable **on-device** because OOXML is an open ZIP-of-XML format (no Office/Word needed);
- reuses our existing ontology-key vault + label→key mapping.

Doing nothing keeps a visible, frequently-hit dead end in the core flow.

## Detailed design

### Format facts we rely on
- `.docx` / `.xlsx` are **ZIP archives of XML parts** (OOXML). We can read/rewrite them with a JS zip
  library — no Office runtime, no conversion server.
- Word "fields":
  - **Content controls** — `<w:sdt>` (Structured Document Tags) with a `<w:tag>`/`<w:alias>` we can
    match to an ontology key; value lives in `<w:sdtContent>`.
  - **Legacy form fields** — `FORMTEXT` / `FORMCHECKBOX` via `<w:fldChar>` runs (older templates).
- Excel "fields":
  - **Named ranges** — `<definedName name="full_name">Sheet1!$B$2</definedName>` map cleanly to keys.
  - **Label + adjacent cell** — a cell reading "Full name" with the input in the neighbour cell.

### Pipeline (reuses today's architecture)
```
open .docx/.xlsx  ─►  unzip (fflate)  ─►  parse OOXML (DOMParser)
   ├─ named regions found ─► map name→ontology_key ─► write value into XML ─► rezip ─► filled.docx/xlsx
   └─ none (flat doc)      ─► detect label→target  ─► insert value at target ─► rezip ─► filled.docx/xlsx
                                        (Phase B)
preview: docx-preview → HTML (Word);  SheetJS → HTML table (Excel)
```
The ontology-key mapping (`KEY_HINTS` in `detect.ts`) is shared for label→key matching; the vault join
is identical to PDF autofill.

### New/changed pieces
- **New crate boundary already exists**: `core-extract` (ontology) is the natural home for the OOXML
  read/fill logic if we push it to Rust later; **Phase 1 lands in the webview** (TS) beside `pdf.ts`
  as `office.ts`, to reuse the same in-browser libs and keep the loop tight.
- `office.ts` exports:
  - `detectOfficeFields(bytes, kind): CatalogFieldSpec[]` — named regions (Phase A) / heuristic (Phase B).
  - `fillOffice(bytes, kind, fields, vault): { created, filled, data }` — mirrors `makeFillableAndFill`.
  - `renderOfficePreview(bytes, kind, el)` — mirrors `renderFirstPage`.
- `App.tsx`: route `.docx/.xlsx` in `onOpenForm` into the office pipeline instead of the "not yet"
  message; preview into the same canvas/preview area (HTML for Office).
- **Signing/provenance** is format-agnostic: we hash the filled bytes + sign with the device Ed25519
  key exactly as for PDF — no change to `sign_form`.

### Libraries (self-hosted, on-device; CSP `script-src 'self' 'wasm-unsafe-eval'`)
| Need | Choice | Why |
|---|---|---|
| Zip read/write | **fflate** | Tiny, fast, MIT; no deps. |
| XML parse/edit | **DOMParser/XMLSerializer** (built-in) | Zero-dep, precise minimal edits. |
| Excel read/write | **SheetJS (xlsx)** or **ExcelJS** | Named ranges + cell writes; ExcelJS preserves more styling. |
| Word preview | **docx-preview** | Renders `.docx` → HTML on-device. |
All bundled locally (no CDN, per the execution-only CSP). Lazy-load so they don't bloat first paint.

### Phasing
- **Phase A — named regions (recommended first):** Word content controls / legacy fields; Excel named
  ranges. High fidelity, low risk, purely structural (no layout guessing). Fill by minimal XML edit,
  re-save native `.docx/.xlsx`.
- **Phase B — flat docs:** label→adjacent target (Word: run/cell after the label; Excel: neighbour
  cell). Heuristic, like flat-PDF; ships behind clear "detected N fields" status.
- **Phase C — optional PDF export:** convert filled `.docx/.xlsx` → PDF for uniform signing/submission.
  Hard on-device (see Alternatives); **deferred to its own decision**.

## Alternatives considered
- **Convert DOCX/XLSX → PDF, then reuse the flat-PDF OCR path.** Rejected as the primary approach:
  faithful on-device Office→PDF needs either a headless LibreOffice **sidecar** (large binary, heavier
  install, still on-device but a big dependency) or lossy HTML→PDF rendering. It also throws away the
  document's native editability. Kept only as optional Phase C for users who want a PDF artifact.
- **Cloud/Office 365 conversion API.** **Forbidden** — sends user content up; breaks the privacy
  invariant. Not an option.
- **Only support named fields, never flat docs.** Simpler, but leaves many real templates unfillable;
  Phase B addresses them incrementally.

## Risks & trade-offs
- **OOXML corruption:** hand-editing XML can break part relationships / content-types. Mitigate with
  minimal targeted edits, vetted libs for Excel, and a **re-open validation** (parse the output back
  before offering download).
- **Macros / external data (security):** `.docm`/`.xlsm` macros and external data connections must be
  **neutralised** — never execute VBA, strip/ignore external links, mirroring how we render PDFs with
  scripting disabled and external-resource loading blocked. Prefer refusing macro-enabled formats.
- **Flat-doc detection accuracy (Phase B):** flow layout has no coordinates, so mapping is heuristic;
  surface a clear "created N fields" status and let the user correct.
- **Bundle size:** SheetJS/docx-preview add weight — lazy-load them only when an Office file is opened.
- **Reversibility:** additive; PDF/image paths unchanged. Phase A can ship alone.

## Rollout & migration
- Ship **Phase A behind the existing "Fill a Form" entry**; `.docx/.xlsx` simply start working for
  named-field templates. No data migration (stateless transform).
- Add acceptance specs: a `.docx` with content controls and an `.xlsx` with named ranges → filled
  from a seeded vault; assert values land and the file re-opens valid.
- Update the traceability matrix (new REQ-15) and `check-traceability.mjs`.

## Open questions
- Default **output**: keep native `.docx/.xlsx` (preserves editability) vs. also emit a PDF copy? (Lean:
  native by default, PDF optional via Phase C.)
- **ExcelJS vs SheetJS** — fidelity (styles, merged cells) vs. bundle size. Prototype both on a real KYC sheet.
- For Word flat docs, insert value **inline after the label run** vs. into the **next table cell** —
  pick per-detected-context; needs samples of real templates.
- Do we ever want the OOXML logic in **Rust (`core-extract`)** for reuse on mobile, or keep it in the
  webview? (Lean: webview for Phase A; revisit if mobile needs it.)

> When accepted, record the outcome as an ADR and link it here.
