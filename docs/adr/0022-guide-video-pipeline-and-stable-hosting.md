# ADR-0022 — Guide video: a rebuildable pipeline, PII-safe capture, and self-hosting for a stable URL

- Status: Accepted
- Date: 2026-07-24
- Relates to: ADR-0019 (app-only hosted assets — installers/models fetched, not bundled). Extends the
  same "large objects served from Object Storage, not the tarball" pattern to the guide video.

## Context

The narrated guide/sales video kept being treated as a one-off export, so every content change was a
manual re-record-and-re-edit, and two real problems recurred:

1. **PII leaked into frames.** A screen capture keyed on window *title* twice grabbed the owner's
   Chrome/YouTube session instead of the app; an early cut published a real driving licence, name and
   DOB to YouTube. Capture and vault handling had to make on-camera PII structurally impossible.
2. **YouTube churns the URL.** YouTube cannot replace an existing video's media — any content change
   mints a NEW watch URL. The Chrome Web Store promo field, the website, and any shared link then all
   need re-pasting. That is the pain the owner explicitly called out ("get the new URL again").

The narration also had to be genuinely good, not robotic SAPI.

## Decision

**1. The video is a deterministic, data-driven build — not a manual edit.**
`node scripts/build-guide.mjs` (`make guide`) reads `docs/guide/guide-manifest.json` (ordered
`[{id, caption}]`), muxes each pre-recorded silent clip (`output/raw/<id>.mp4`) with its narration
(`output/audio/<id>.wav`), freezes the last frame to cover the audio, concatenates, and emits the
video + a sentence-level `.srt`. Same inputs → same output.

**2. Narration is on-device Piper "Amy"** (`piper:en_US-amy-medium`, `docs/guide/narration.json`).
Never a cloud voice (privacy invariant) and never robotic SAPI.

**3. Capture is PII-safe by construction.** `scripts/record-app-region.ps1` records ONLY the app's
client rectangle (never the desktop or a browser). Browser/extension segments use a fresh throwaway
Chrome profile. All on-camera data is synthetic, produced by a **demo-vault swap**: the real vault is
moved aside, the app runs on a fresh vault, recording happens, and the real vault is restored
byte-for-byte.

**4. The canonical guide is self-hosted for a permanent URL.** `publish-site.ps1 -WithGuide` uploads
`guide.mp4` + `guide.en.srt` as their own Object Storage objects (excluded from the site tarball,
exactly like the installers under ADR-0019), served forever at
`https://polyglotformfill.com/download/guide.{mp4,en.srt}`. `deploy/k8s/site.yaml` fetches them
**best-effort** (`curl` without `-f`, `|| skip`) so a not-yet-published guide never breaks the pod,
unlike the required installers. Rebuilding the content never changes the URL.

**5. YouTube is a secondary, scripted target — only where Google requires it.**
`scripts/upload-youtube.mjs` (`make guide-upload`) uploads and prints the new watch URL;
`--captions --video-id <id>` (`make guide-captions`) updates captions on an existing video in place.
YouTube is used only for the Chrome Web Store promo field (which mandates a YouTube URL, in the long
`watch?v=` form — it rejects `youtu.be` short links).

## Consequences

- The video is reproducible and cheap to rebuild; only the recorded *clips* still need a human/driven
  pass when the UI changes.
- The website/anywhere-we-control gets a link that never rots. Only the CWS promo field inherits
  YouTube's new-URL-per-content-change limitation, and that is a single scripted step.
- The demo-vault swap and app-region capture must be respected for every future recording; the SendInput
  driving gotchas are recorded in memory (`guide-video-pipeline`).
- Running the publish must use native PowerShell (Windows `bsdtar`); git-bash's GNU tar reads `C:\` as a
  remote host and fails packaging.
