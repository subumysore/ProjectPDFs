# Feasibility — Worst-Case Trial & Go/No-Go Verdict

_Empirical stress test of the risky links flagged during scoping. Run 2026-07-15. Harness preserved
under `prototypes/field-detection-trial/` (reproducible)._

## What was tested and how

A bilingual (Japanese + English) 6-field form was rendered, then **degraded to worst-case scans**
and pushed through the real pipeline (on-device OCR via Tesseract `eng+jpn`, plus two detection
methods). Three quality levels:

| Level | Degradation |
|---|---|
| **clean** | pristine render (baseline) |
| **moderate** | 0.8° skew, 0.6× DPI, noise ±18, JPEG q0.6 |
| **nasty** | 2.0° skew, **0.42× DPI (~60 DPI)**, noise ±34, JPEG q0.4 |

Metrics: OCR label recovery (EN & JA), OCR-heuristic field detection, and CV underline (geometry)
detection — the latter is the script-independent path the architecture actually relies on.

## Results (real numbers)

| Level | OCR labels EN | OCR labels **JA** | Field detect (OCR-heuristic) | Underlines (CV, +deskew) |
|---|---|---|---|---|
| clean | 6/6 | **6/6** | 5/6 | 6/6 |
| moderate | 5/6 | **0/6** | 2/6 | 0/6 |
| nasty | 3/6 | **0/6** | 1/6 | 0/6 (skew found −1.75°, but rule destroyed by ~60 DPI) |

## Findings

1. **CONFIRMED RISK — fully-automatic detection cannot be promised on worst-case scans.** It degrades
   sharply (5→2→1 of 6) and **CJK OCR collapses to 0/6 under even moderate degradation** while Latin
   survives (5/6). Any plan that promises "AI auto-detects every field on any scan" is **NO-GO**.
2. **Thin rules die at very low DPI.** At ~60 DPI a 1.5px underline is obliterated even after correct
   deskew — a real limit, but "nasty" is *below typical* scan quality (real scans are ≥150 DPI).
3. **Good input works well** (all metrics strong on clean), and **digital/editable PDFs bypass this
   entire risk** (no OCR/detection needed) — a large share of real forms.
4. **The naive detectors tested are the *floor*, not the achievable result.** Not tested here (need
   more than a spike): on-device ML layout detection, better CJK OCR engines, and — crucially —
   the two fallbacks below.

## Why this is a GO, not a drop

The flagged risk is **real but not load-bearing**, because viability was never designed to depend on
worst-case auto-detection succeeding:

- **Guaranteed floor is manual + template, and it never fails.** Rendering the PDF and letting the
  user place/confirm fields always works — even at 0/6 automation the app is a *private, data-reusing
  PDF filler*, still better than cloud alternatives and still 100% on-device.
- **Template memoization** makes any one bad form a **one-time** manual cost; the next user of that
  same government form gets it perfect and instant.
- **The common case isn't worst-case.** Editable + digital-text PDFs skip OCR entirely; decent scans
  score well. The 60-DPI-skewed-CJK tail is the exception the fallback absorbs.
- **On-device translation & font embedding are already de-risked** (Bergamot at scale; pdf-lib
  subset-embed demonstrated).

**What would have killed it:** if the *guaranteed floor itself* failed — e.g. we couldn't render
foreign PDFs, couldn't fill/export on-device, or the privacy invariant forced a cloud dependency.
None of those failed. The only thing that failed is *magical zero-touch automation on bad scans*,
which we treat as a progressively-improving assist, not a promise.

## Verdict: **CONDITIONAL GO**

Proceed — but scope and message the product around the **guaranteed private path** (render + reuse
data + assisted/manual placement + template memory, all on-device), with full auto-detection as a
best-effort assist that improves over time. Do **not** market or architect around zero-touch
detection of arbitrary scans.

### Conditions carried into the build
1. Field detection is **best-effort + human-in-the-loop + template memoization** — never assumed 100%.
2. **Prefer the digital-text path**; OCR is the fallback, higher-DPI capture is guided.
3. **CJK/complex-script OCR** needs a better-than-Tesseract on-device engine — evaluate in V1.
4. Still to validate before/early in V1 (not project-killers): on-device translation *quality*, and
   an on-device ML layout detector's real accuracy.
