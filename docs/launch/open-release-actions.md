# Open release actions — what you can do next

Your standing menu of pending releases. Reply to me with the **trigger** and I run it (or, for the
runbook, I build it). 🔧 = I run it, needs your go (outward-facing). Updated 2026-07-24.

## Current live-vs-code gap
- **Website installer:** serving **1.0.0** — BEHIND this session's fixes (name-fill, OCR ID capture,
  passphrase-protected delete, review-after-detect, trimmed Forms copy).
- **Chrome Web Store extension:** BEHIND — the shared-engine fill fix isn't shipped.
- **Guide video (site):** ✅ current & live at `…/download/guide.mp4`.

---

## #7 — Release the DESKTOP app   🔧  (trigger: **"release desktop"**)
Ships this session's fixes to users via the stable installer link. What I run:
1. `node scripts/set-version.mjs patch`  (1.0.0 → 1.0.1)
2. `cd apps/app && pnpm tauri build`  (rebuild the installer)
3. stage the installer → `docs/marketing/site/download/PolyglotFormFill-Setup.exe`
4. `node scripts/release-manifest.mjs`  (refresh SHA-256 hashes)
5. `.\deploy\k8s\publish-site.ps1 -WithBinaries`  (upload → same stable link)
→ `https://polyglotformfill.mooo.com/download/PolyglotFormFill-Setup.exe` now serves the new build.
Time: ~5–10 min (Rust build + 25 MB upload).

## #8/#9 — Release the EXTENSION   🔧  (trigger: **"release extension"**)
> ⛔ **BLOCKED until v1.0.2 clears review.** The Chrome Web Store locks the listing (and blocks new
> uploads) while a version is *Pending review*. As of 2026-07-24, **1.0.2 is pending** — so the promo-video
> update AND this release must wait until it PUBLISHES or FAILS. Check with `items.get?projection=DRAFT`
> (or say "check the store"). Do not attempt store edits while pending.

Required by CLAUDE.md §10 whenever `apps/extension/**` (incl. shared `@engine` files) changes. What I run (once unblocked):
1. `node scripts/set-version.mjs patch`  (bump — the store rejects a re-uploaded version)
2. `.\deploy\publish-extension.ps1`  → rebuilds the zip, updates the site `/download/` copy,
   and calls `.\deploy\publish-webstore.ps1` to submit to the Chrome Web Store.
→ Google reviews before it reaches users (hours–days). "pending review" = success.

## Both at once   🔧  (trigger: **"release both"**)
#7 then #8/#9, one version bump covering both (versions are unified by `set-version.mjs`).

## #13 — Build the turnkey release RUNBOOK + orchestrator   (trigger: **"build the runbook"**)
A single `deploy/release.ps1 -Desktop -Extension` that chains the above with checks, plus a
`docs/runbooks/release.md`, so a future release is truly one command. (Plumbing only; still needs your
go to actually publish.)

---

## Not a release, but on the menu
- **YouTube copy of the video** (optional): manual 2-min upload, then captions via
  `make guide-captions VID=<id>`. See `docs/runbooks/youtube-captions-and-oauth-audit.md`. The Chrome
  Web Store promo field is best left blank (self-hosted video is in the store description).
