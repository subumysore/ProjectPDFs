# RFC-0010 — Fill-engine accuracy benchmark + IBM Granite-Docling evaluation

- Status: Proposed (Phase 0/1 landed; Phase 2/3 experimental)
- Date: 2026-08-05
- Related: RFC-0008 (universal language), ADR-0018/0030 (XFA widget fill), CLAUDE.md §2 (SDD), §8b (dual-surface)

## Problem

We could not answer "how accurate is form-fill?" with a number. We tracked *coverage* (widgets filled)
which conflates fields that *should* stay blank with real correctness. The owner also hit concrete
over-fills on the N-400 (name in the street box; occupation in the children/employment columns; the
spouse/interpreter/preparer name boxes filled with the applicant's identity). We need (a) a repeatable
**accuracy** metric, and (b) an evidence-based decision on whether an on-device document VLM
(**IBM Granite-Docling-258M**) is worth adopting.

## Decision framework (measure, don't guess)

Ground truth = per-form assertions locating a field (by fieldName / tooltip / caption regex) and its
EXPECTED value — a vault value, or **blank** for the critical negatives. Three metrics:

- **Precision** — of the labeled fields we filled, how many are correct.
- **Recall** — of the fields that *should* be filled, how many we got.
- **Blank-correctness** — of the fields that *should* stay blank, how many we correctly left blank
  (the over-fill guard — this is where the owner's bugs live).

Corpus: 15 real gov forms (`docs/testing/engine-benchmark/forms/`, 1–24 pages): 9 USCIS (tooltipped
XFA) + 6 IRS (no-tooltip, labels-above — the hard cases). Harness: `scripts/engine-benchmark/`
(headless pdf.js extraction → pluggable engine → scoring). Reproduce: `node scripts/engine-benchmark/run-current.mjs`.

## Phase 1 result — shipped proximity engine (baseline)

| | Precision | Recall | Blank-correctness |
|---|--:|--:|--:|
| Before this RFC | 86% | 73% | 65% |
| After tooltip/section precision fix (this RFC) | **90%** | 73% | **77%** |

The precision fix (tooltip-driven section detection, camelCase id tokenisation, applicant-name-in-address
suppression) is landed in the shared engine (both surfaces), regression-guarded by the benchmark + the
348-test suite. It directly closes the owner's N-400 over-fills (N-400: P=100%, blank-correctness=100%).

**Remaining weakness the fix does NOT solve** — recall on no-tooltip, label-above forms:
IRS W-4 recall **20%**, W-9 **33%**. Geometry cannot reliably bind a label that sits *above* its box.
This is precisely Granite-Docling's target.

## Phase 2/3 — Granite-Docling evaluation (experimental)

Granite-Docling-258M is a document VLM that understands layout structurally (which caption governs which
box) rather than by pixel distance. Fit constraints from RFC-0001/CLAUDE.md:

- **On-device only** (privacy invariant) — served DOWNWARD via the existing `ppfmodel.localhost` cache,
  like NLLB-200. Int8 ONNX ≈ 260 MB; NOT bundled in the installer (stays ~27 MB).
- **Desktop-first** — a 258M VLM is not viable in an MV3 extension content script; that is an explicit,
  documented parity gap, not a silent one.
- **Additive** — Granite feeds field→label associations into the *existing* `planProximityFill`
  contract; pdf.js/pdf-lib remain the write engine. It is selected via a UI toggle, default off.

**Honest status:** the Granite engine module + the app UI toggle are built (`scripts/engine-benchmark/
granite.mjs`, engine seam in `pdf.ts`, radio in the form toolbar). Full head-to-head numbers are
**pending a real model run**: (1) the Node harness has no PDF rasteriser (`@napi-rs/canvas` is stubbed
here) to produce the VLM's page-image input, and (2) the ~260 MB model must be fetched to
`app-data/models`. The comparison is wired to run the moment those two are present; we will NOT publish
Granite accuracy numbers until measured. Repro steps in `docs/testing/engine-benchmark/README.md`.

## Consequences

- We now have a durable accuracy metric and a regression guard for every future engine change.
- A shippable precision win (P +4, blank-correctness +12) landed tonight, fixing real user-visible bugs.
- The Granite decision is deferred to measured data, not adopted on faith. If measured lift on the
  IRS/label-above set is large and desktop-only cost is acceptable → promote via an ADR.
