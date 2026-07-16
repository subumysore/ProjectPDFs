# Spike: Translated-Fill (ProjectPDFs requirement #3)

A throwaway browser prototype to **de-risk the single most differentiating + riskiest requirement**:
take a **scanned / non-editable foreign-language PDF**, OCR it, translate the field labels into the
user's language, let them fill in their language, and **export with values in the original OR the
chosen language**.

> This is a SPIKE, not production. It lives **outside** the pnpm workspace (its own
> `pnpm-workspace.yaml`) so its heavy deps never touch the app or CI gates. Governance (SDD, BRD,
> traceability) is intentionally skipped here — the goal is learning, not shipping.

## Run it

```bash
cd prototypes/translated-fill
pnpm install
pnpm dev          # open the printed http://localhost:5173
```

Then in the browser:
1. Click **Generate sample Japanese form** (or upload your own scanned PDF).
2. Set **Source = Japanese**, **Your language = English**.
3. Click **Run OCR + detect fields + translate** — first run downloads the Tesseract `jpn` data
   (~a few MB) and calls the translation API, so give it a few seconds.
4. Fill the overlaid inputs (labels show in English).
5. Choose **Write values in → My language** or **Original form language** and click **Fill & download**.

## What it exercises (the real pipeline)

| Stage | Library | Notes |
|---|---|---|
| Render page | `pdfjs-dist` | page → canvas at 2× |
| OCR (text + boxes) | `tesseract.js` | `jpn`/`deu`/`fra`/`spa`; downloads lang data at runtime |
| Field detection | heuristic (`fields.ts`) | **deliberately simplified** — see limitations |
| Translate labels | MyMemory API (default) or Google (with key) | real cloud call |
| Overlay + fill | DOM inputs over the canvas | positions from OCR boxes |
| Export | `pdf-lib` + `@pdf-lib/fontkit` | stamps text; embeds a CJK font when writing Japanese |

## Findings to confirm when you run it (this is the point of the spike)

1. **OCR quality on real scans** is the make-or-break input. The sample is clean/synthetic; try a
   genuinely scanned, skewed, low-DPI form to see where it breaks.
2. **Field detection is the hardest unsolved piece.** The heuristic ("short line → put an input to
   its right") will mis-detect on real layouts (tables, checkboxes, multi-column). This is where a
   production build needs real layout analysis and/or a vision model. Expect to spend budget here.
3. **CJK font embedding is a real gotcha.** To *write Japanese values back*, `pdf-lib` needs a
   CJK-capable TTF embedded (we fetch NotoSansJP and subset). Standard PDF fonts render Japanese as
   tofu. **Hindi/Devanagari and other scripts need their own fonts** — the current font won't cover
   them, so those values are skipped on export (surfaced, not silently dropped).
4. **Privacy tension is now concrete.** Both translation and (optionally) OCR data leave the device.
   This directly conflicts with the local-first rule (brief §5). Production must move to on-device
   translation + OCR; this spike proves the *flow*, not the *privacy posture*.
5. **Bundle weight**: ~3.6 MB (Tesseract + pdf.js). Fine for a spike; a real app should lazy-load
   the OCR engine only when a non-editable PDF is opened.

## Deliberately NOT done here
- Multi-page PDFs (page 1 only).
- Editable/AcroForm PDFs (this spike targets the non-editable path on purpose).
- Word/XLS (different fill model — see brief; belongs in the architecture RFC).
- Persisting anything, versioning, annotation layers, on-device model.
