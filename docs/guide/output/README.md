# Guide video — output assets

All rendered assets for the PolyglotFormFill guide/sales video, in one place.

Recorded 2026-07-23. **PII-safe:** every frame uses a synthetic demo profile ("John Doe" with a
fake SPECIMEN driving licence); capture is locked to the app's own window region, never the desktop
or a browser. Narration is the on-device Piper "Amy" neural voice — nothing was sent to any server.

## Folders

- `video/PolyglotFormFill-guide.mp4` — the finished guide, 3:54, 1280-wide, H.264 + AAC.
- `captions/PolyglotFormFill-guide.en.srt` — English closed captions, sentence-level, timed to the
  narration. Load it alongside the MP4 (same basename) or upload with the video.
- `audio/NN.wav` — the Amy narration for each segment (source of truth: `../narration.json`).
  `11.wav` exists but has no matching video yet (see below).
- `segments/NN.final.mp4` — each segment as its own muxed clip (video + narration), for re-editing
  or re-ordering without re-recording.
- `screenshots/NN-name.png` — one representative still per segment (multilingual UI, ID capture,
  one-click fill, signature, profiles, etc.).

## Segments (index = narration order)

| # | Segment | # | Segment |
|---|---------|---|---------|
| 00 | Greeting — 26-language flip | 07 | Photo + signature placed on the form |
| 01 | Licence & device | 08 | Manual entry → auto-saved to vault |
| 02 | Create a profile | 09 | Profiles (family + corporate) |
| 03 | ID capture → vault (7 fields) | 10 | Handwritten signature (blue ink) |
| 04 | Flat PDF (no fields) | 12 | Languages |
| 05 | Detect fields (OCR) | 13 | Past forms |
| 06 | One-click fill | | |

## Known gap

**Segment 11 — the browser extension** is not yet recorded. It must be captured in a real browser
window (clean profile, only the sample web form + the extension loaded) so no personal tabs appear.
`audio/11.wav` is ready; drop the recorded clip in as `segments/11.final.mp4` and re-run the
assembly to fold it into the final video.
