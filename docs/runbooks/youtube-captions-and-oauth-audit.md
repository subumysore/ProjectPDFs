# Runbook — YouTube captions automation & OAuth audit (steps #10–12)

Everything the automation needs, pre-filled. The console/browser clicks can only be done by the
owner (their Google account); the scripts and answers are ready so each step is trivial.

Context: the guide video is self-hosted at the STABLE url
`https://polyglotformfill.mooo.com/download/guide.mp4` (updated by `publish-site.ps1 -WithGuide`).
YouTube is needed ONLY if you keep a public YouTube copy (e.g. for the Chrome Web Store promo field,
which is otherwise best left blank — see `docs/launch/chrome-web-store-listing.md`).

---

## A. Automate captions on a YouTube video you own  (#12 — works today, no audit)

Updating captions via the API does NOT hit the private-video lock, so this is genuinely one command
once the OAuth is set up.

**One-time setup (owner, ~3 min):**
1. https://console.cloud.google.com → pick the SAME project as the Chrome Web Store OAuth client.
2. APIs & Services → **Enable APIs** → enable **"YouTube Data API v3"**.
3. OAuth consent screen → add scopes `youtube.upload` and `youtube.force-ssl` → add yourself as a
   **Test user** (an unverified app allows test users; you'll click past an "unverified" warning).
4. In a terminal (scripts reuse your `WEBSTORE_CLIENT_ID/SECRET`, so no new client needed):
   `node scripts/youtube-auth.mjs`  → click **Allow** → it stores `YT_REFRESH_TOKEN`. Open a NEW terminal.

**Then, every time captions change (one command):**
```
make guide-captions VID=oTBaEK1-mXk        # or: node scripts/upload-youtube.mjs --captions docs/guide/output/captions/PolyglotFormFill-guide.en.srt --video-id oTBaEK1-mXk
```
This replaces the English caption track on that video in place — same URL, no re-upload.

---

## B. New YouTube upload  (#10 — manual until the audit in section C is done)

Until the project is OAuth-verified, `make guide-upload` uploads but YouTube forces the video to
PRIVATE. So for a PUBLIC promo, do it manually (2 min):

1. https://studio.youtube.com → **Create → Upload video** → pick
   `docs/guide/output/video/PolyglotFormFill-guide.mp4`.
2. Title / description: see `docs/launch/chrome-web-store-listing.md`. Visibility **Public** (or Unlisted).
3. Subtitles → **Upload file → With timing** → `docs/guide/output/captions/PolyglotFormFill-guide.en.srt`.
4. Copy the new id and, IF you use the CWS promo field, paste the **long** form
   `https://www.youtube.com/watch?v=<id>` (never `youtu.be/…`).

After the audit (C), this whole section collapses to `make guide-upload` (prints the public URL).

---

## C. OAuth verification ("audit") — so #10 becomes one command  (#11 stays manual forever)

Submit the Google Cloud project for OAuth verification to unlock PUBLIC API uploads. Answer sheet,
pre-filled (Google's OAuth consent screen → "Publish app" → verification):

- **App name:** PolyglotFormFill
- **App homepage:** https://polyglotformfill.mooo.com
- **Privacy policy:** https://polyglotformfill.mooo.com/privacy   (live, HTTP 200)
- **Authorized domain:** polyglotformfill.mooo.com
- **Scopes requested & justification:**
  - `.../auth/youtube.upload` — "Publish our own product's guide/marketing videos to our own YouTube
    channel from a release script. Used only by the developer, on our own videos; no access to any
    user's YouTube data."
  - `.../auth/youtube.force-ssl` — "Update the caption (subtitle) track on our own uploaded videos."
- **Who uses it:** internal/developer only (not end users). State this — internal-only apps often
  need lighter review.
- **Demo video Google asks for:** a screen recording showing the OAuth consent → the script uploading
  a video. (Record with `scripts/record-app-region.ps1` if needed.)
- **Reality:** review takes days–weeks and Google may push back on YouTube scopes for a small app.
  Only pursue if you'll re-upload often; otherwise section B (manual, 2 min) is cheaper.

**#11 (Chrome Web Store promo-link update) is NEVER automatable** — the CWS API only handles the
extension package, not store-listing assets. It's a dashboard paste, or (recommended) leave the promo
field blank per `docs/launch/chrome-web-store-listing.md`.
