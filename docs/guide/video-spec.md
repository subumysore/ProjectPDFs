# Guide video — production spec

The durable record of what the guide/promo video must be, so requirements stop getting lost
between turns. The narration is in `narration.json`; this is everything around it.

## Hard rule (from the 2026-07-23 incident)

**No real data in any frame, ever.** The prior video leaked the owner's driver's licence, name,
DOB and email to a public URL. Every recording uses a **synthetic demo profile** — fake name,
fake DOB, a placeholder photo and signature, a sample form. Before publishing, every second is
reviewed for stray real data (browser tabs, other windows, notifications, file paths).

## Tone

A **sales pitch**, not a UI tour. Lead with the pain — hours lost to repetitive forms — and sell
the **time saved** on mundane tasks. Every feature is stated as a benefit, then shown.

## It must be a real screen recording

Not static screenshots. Show the actual interaction:
- the pointer moving to and **clicking** each button,
- fields **filling** when the one-click button is pressed,
- the user **typing** into fields the fill left empty,
- the signature being **drawn by hand** on the pad, and a **saved signature image** being placed,
- the **photo / profile picture** being placed into a form's photo box.

**Capture at full/maximised window size** — never a small or reduced window. Record the app
maximised (and the browser maximised for the extension segment).

## Feature checklist — all must appear

1. Flat / scanned PDF -> **auto-detected fillable fields** (the headline; show before + after).
2. **One-click fill** of every field from the vault.
3. **Photo and signature placed onto the form** automatically.
4. **Manual entry** of any field the fill left blank — and that it's remembered next time.
5. **Signing**: drawn by hand in a chosen ink colour, AND a pre-saved signature image.
6. **Existing AcroForm** fill, including dropdowns, radio buttons and checkboxes.
7. **Browser extension** filling a real web form in Chrome/Edge — shown IN THE BROWSER, not the
   desktop app — and the **shared vault** between extension and desktop.
8. **Word and Excel** fill.
9. **26-language UI**: at least Tamil AND Japanese actually on screen (the narration names both);
   translating a foreign form; writing answers in a chosen language.
10. **Past forms**: encrypted, versioned, re-downloadable.
11. **Privacy close**: everything on-device; call to action.

## Open production decisions (blockers)

- **Voice.** Only robotic Windows SAPI voices are installed locally; natural narration needs a
  human recording or a paid neural TTS (against the no-budget rule). Selling copy read by SAPI
  sounds worse than a plain tour. DECISION NEEDED: robotic / human voiceover / paid TTS / captions
  only.
- **Who records.** Automated capture (ffmpeg gdigrab works here) can drive clicks and typing, but
  the cursor jumps rather than glides, pacing is mechanical, and the native file-open dialog is
  hard to automate — it will read as an automated screencast, not a polished demo. A human
  recording with the synthetic profile + this script is the professional path.

## Still to confirm

- **Did the leaked PII video get uploaded to YouTube?** If so it must be deleted there — outside
  this repo, only the account owner can do it.

## Assets to prepare (I can own these)

- A seed command that loads a synthetic demo profile (fake identity + placeholder photo/signature)
  into a throwaway vault, so no real data is reachable during recording.
- A sample flat (scanned) PDF and a sample AcroForm PDF for the fill demos.
- The polished narration (`narration.json`) and timed subtitles (`guide.en.srt`).
