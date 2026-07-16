# Field-detection worst-case trial (reproducible)

Evidence behind `docs/feasibility/02-worst-case-trial.md`. Renders a bilingual (JA+EN) form,
degrades it to worst-case scans, and measures on-device OCR + field/underline detection.

## Run

```bash
cd prototypes/field-detection-trial
npm init -y && npm i @napi-rs/canvas tesseract.js@5
node trial.mjs    # OCR (eng+jpn) + heuristic field detection at clean/moderate/nasty
node trial2.mjs   # CV underline detection (no deskew)
node trial3.mjs   # CV underline detection WITH deskew sweep
```

First run downloads Tesseract `eng`/`jpn` data. Uses Windows Yu Gothic for the JA render.

## Headline results (2026-07-15)
- Clean: OCR labels 6/6 (JA+EN), field-detect 5/6, underlines 6/6.
- Moderate scan: EN 5/6, **JA 0/6**, detect 2/6.
- Nasty (~60 DPI): EN 3/6, JA 0/6, detect 1/6.

Conclusion: worst-case auto-detection is unreliable (esp. CJK) → the product relies on the
digital-text path + template memoization + human-in-the-loop, not zero-touch scan detection.
Verdict = **conditional GO**. See the feasibility doc.
