# ADR-0011: On-device DOCX/XLSX named-field fill via OOXML editing

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** ProjectPDFs team
- **Related:** RFC-0002, REQ-15.1 (also REQ-02.1 make-fillable, REQ-11.1 multi-source)

## Context
Forms frequently ship as Word (`.docx`) and Excel (`.xlsx`), not only PDF. The product promises to
"fill a form" from the user's reusable vault, so it must handle Office formats — **without breaking the
privacy invariant** (no user content may leave the device). We needed a way to fill Office forms that
is on-device, high-fidelity, and reversible.

## Options considered
1. **Edit OOXML directly (unzip → edit XML → rezip), fill named regions.** OOXML `.docx/.xlsx` are ZIP
   archives of XML; content controls (Word) and named ranges (Excel) are named, mappable targets.
   Pros: fully on-device, no Office runtime, preserves the native editable file, low-risk targeted
   edits. Cons: hand-editing XML risks corruption; flat docs (no named regions) not covered.
2. **Convert DOCX/XLSX → PDF, then reuse the flat-PDF OCR pipeline.** Pros: one downstream path.
   Cons: faithful on-device Office→PDF needs a heavy headless LibreOffice sidecar or lossy HTML→PDF;
   throws away native editability.
3. **Cloud/Office-365 conversion API.** Rejected outright — sends user content up; violates the
   privacy invariant.

## Decision
Adopt **Option 1** for Phase A: fill **named fillable regions** on-device by editing OOXML —
Word content controls (`w:sdt` tag/alias → ontology key) and Excel named ranges (`definedName` → cell).
Implemented in the webview (`apps/app/src/office.ts`) with **fflate** (zip) and **fast-xml-parser**
(order-preserving XML round-trip). Corruption risk is mitigated by minimal targeted edits and unit
tests over real OOXML fixtures. Option 2's Office→PDF is deferred to RFC-0002 Phase C (its own future
decision); Option 3 is forbidden.

## Consequences
- **Positive:** Word/Excel forms fill from the vault on-device; native file stays editable; no server,
  no upload; reuses the existing ontology-key vault join; format-agnostic signing still applies (hash
  the filled bytes).
- **Negative / cost:** two new JS deps (fflate, fast-xml-parser); only *named* fields are covered in
  Phase A — flat/label documents need Phase B; XML editing must stay careful to avoid corruption.
- **Follow-ups / new risks:** Phase B (flat-doc label→target detection); Phase C (optional Office→PDF);
  neutralise macros/external data on `.docm/.xlsm` (prefer refusing macro-enabled formats); revisit
  moving the logic into Rust (`core-extract`) if mobile needs it.

> ADRs are immutable once Accepted. To change a decision, write a new ADR that supersedes this one.
