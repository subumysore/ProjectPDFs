# Guide video — shot list

Record with a normal screen recorder (OBS, Xbox Game Bar `Win+G`, or ScreenToGif for short
clips). **App maximised. Browser maximised. Close every personal tab, sign out of personal
accounts, hide the bookmarks bar, silence notifications.** Read the matching line from
`narration.json` while performing each shot — the numbers below line up with the segments there.

**Before you start:** run the synthetic demo profile setup (`docs/guide/demo-assets/`), so the
vault shows *Alex Kumar / fake data / placeholder photo & signature* and nothing real is ever on
screen. Do a dry run and watch the whole frame once before the real take.

---

### 1 — Hook (greeting)
Show the app on the **language picker / first screen**, or the greeting montage
(`slides/a-greeting.png`) as a title card. 6–8 s.

### 2 — A flat PDF (the problem)
Forms tab → open the **sample flat PDF** (`demo-assets/sample-flat.pdf`). Let it render. Scroll so
the viewer sees it's a plain scan with **no fillable boxes**. Hover/click a spot to show nothing
happens. 6–8 s.

### 3 — Flat → fillable (the headline)
Trigger detection (open/auto-detect). Show the **fields appearing** on the previously flat page —
this is the money shot. Let the boxes light up. 8–10 s.

### 4 — One-click fill
Click **Fill** once. Show **every field populate at once** from the vault, then the finished
document. This is the "10 minutes → 1 second" beat — don't rush it. 8–10 s.

### 5 — Photo + signature onto the form
Show the **photo box** receiving the placeholder passport photo and the **signature box** receiving
the saved signature, dropped into place automatically. 6–8 s.

### 6 — Manual entry, then remembered
Point to a field the fill left **blank**, type a value into it once, save. (Optional: reopen a
second form and show it now auto-fills — "remembered".) 6–8 s.

### 7 — Profiles (the office time-saver)
Show the **profile switcher**: multiple profiles (e.g. *Alex Kumar*, *Priya Kumar (spouse)*, *Acme Corp — Finance*). Switch from one to another and show the **vault contents change** with it. Fill a form with one profile, then switch profile and fill a different form — the point is *right data on the right form, no re-typing, no mix-ups*. Great B2B / office angle. 12–14 s.

### 8 — Signing
Sign tool → **draw a signature by hand** on the pad; change the **ink colour to blue**. Then show
placing a **pre-saved signature image** instead. 10–12 s.

### 9 — Extension on a web form  *(SWITCH TO THE BROWSER — maximised)*
In Chrome/Edge, open the **sample web form** (`demo-assets/sample-webform.html`, or any public
form). Click the extension → **Fill this page** → the page fills in one click. Briefly show the
popup noting the **shared vault**. 10–12 s.

### 10 — Languages
Back in the app: translate a foreign-language form for reading; open the **language picker** and
switch the UI (show **Tamil AND Japanese** on screen, since the narration names both); mention
writing answers in a chosen language. 10–12 s.

### 11 — History + privacy close
Past forms tab → show saved, **versioned** forms and a re-download. End on the app title / logo for
the call to action. 8–10 s.

---

## Editing

- Stitch the clips in this order. Add the audio (see the voice decision in `video-spec.md`) and the
  subtitles (`guide.en.srt`).
- **Final safety pass:** scrub the whole timeline once at full size looking for any real data —
  a stray tab, a filename, a notification, a reflection. If in doubt, blur or recut.
- 1080p (1920×1080) or higher. Keep it under ~3.5 minutes.

## After it's produced

1. Replace `docs/marketing/site/app-assets/guide.mp4` with the final file.
2. `powershell scripts/build-guide-subtitles.ps1` (re-times captions if the pacing changed).
3. Re-pin the new SHA-256 in `apps/app/src-tauri/src/lib.rs` (`GUIDE_SHA256`), bump the version
   (`node scripts/set-version.mjs patch`), rebuild, and publish — the in-app Docs tab verifies the
   hash, so it must match.
4. Upload to YouTube (unlisted), attach `guide.en.srt`, and paste the link into the Chrome Web
   Store listing's Video field.
