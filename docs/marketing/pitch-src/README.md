# Sales-pitch video & store screenshots (reproducible)

Everything is generated on-device — no external services, nothing uploaded.

## Assets produced
- **Pitch video:** https://polyglotformfill.mooo.com/pitch/ (embed) ·
  https://polyglotformfill.mooo.com/pitch/PolyglotFormFill-pitch.mp4 (direct, ~1:48)
- **Store screenshots (1280×800, 24-bit no-alpha):** `dist/store-assets/screenshot-1..5.png`

## How to rebuild
1. `node docs/marketing/pitch-src/gen.mjs` → writes 5 scene HTMLs + `vo.json` (narration script)
   next to it. (Edit the scene copy / VO text in `gen.mjs`.)
2. Capture each scene to 1280×800 PNG via headless Chrome:
   `chrome --headless=new --window-size=1280,800 --screenshot=sN.png sN.html`
3. Narration (offline, Windows TTS): `System.Speech.Synthesis.SpeechSynthesizer` (voice
   "Microsoft Zira Desktop", Rate -1) → `sN.wav`.
4. Assemble with ffmpeg: per-scene Ken-Burns `zoompan` clip timed to its WAV + fades,
   then concat. (ffmpeg installed via `winget install Gyan.FFmpeg`.)
5. Stage: copy the mp4 to `docs/marketing/site/pitch/`, convert screenshots to `rgb24`
   for `dist/store-assets/`, then `deploy/k8s/publish-site.ps1`.

## Scenes (answer what / why / how / which / when)
1. WHAT — fill any form, any language, on-device (hero + vault)
2. WHY — data never leaves your device (privacy)
3. HOW — semantic field matching (autofill table)
4. WHICH — read & fill in your language (bilingual panel)
5. WHEN / CTA — passports, taxes, jobs, healthcare → Add to Chrome

## Chrome Web Store promo video
The CWS "Global promo video" field accepts **YouTube URLs only**. Upload
`PolyglotFormFill-pitch.mp4` to YouTube, then paste that watch URL into the listing.
The self-hosted URL above is for the website / direct sharing.
