# Tutorial videos (modular)

Short silent screen-demo clips shown on `/tutorials/`. Each clip is its own editable scene.

## Structure
- `lib.mjs` — shared CSS (brand look) + `recordScene()` + `helpers()` (wait/badge/show/set).
- `scenes/<name>.mjs` — one file per video, exports `{ name, width, height, html, drive(page, h) }`.
  - `fill` — auto-filling a web form from the vault
  - `pdf` — a non-fillable PDF becomes fillable, then fills
  - `camera` — scan an ID → OCR → profile fields
  - `vault` — type a value in the popup; it saves
  - `backup` — export encrypted → import on another device
- `record.mjs` — runner. Outputs `.webm` into `../site/tutorials/vid/`.

## Re-record
Playwright must be resolvable (it lives in the scratch `uitest` project). From a place that can
import `playwright`:

```
node docs/marketing/videos/record.mjs            # all scenes
node docs/marketing/videos/record.mjs camera pdf # only these
```

## Edit a video
Change that scene's `html` (the on-screen mock) or `drive()` (the timed animation), then re-record
just that scene. The tutorials page (`site/tutorials/index.html`) references `vid/<name>.webm` and
lists them in its `VIDEOS` array — add a scene + one array entry to add a new clip.

Sample data uses **John Doe / USA**. Clips are silent; on-screen badges narrate each step.
