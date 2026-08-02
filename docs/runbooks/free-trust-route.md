# Runbook — the FREE trusted-distribution route (no Store fee, no EV cert)

Goal: get users past the SmartScreen/AV "unrecognized app / virus" reputation prompts at **$0**. These
prompts are reputation-based (new signed app, low download history) — NOT a real detection. Proof on
record: VirusTotal 0/71, Sophos "Likely Clean", Windows Defender clean, Authenticode signature Valid
(publisher shows as "Subramanya Mysore" in the SmartScreen dialog — signing confirmed working).

## 1. winget (Windows Package Manager) — a trusted install path with NO browser download
Users run `winget install SubramanyaMysore.PolyglotFormFill` — winget fetches the signed installer by
hash, so there is **no browser "Virus detected" prompt** at all.

Manifests live in `deploy/winget/1.0.6/` (validated: `winget validate --manifest deploy\winget\1.0.6`).

**Submit (one-time, free — needs a GitHub account):**
- Easiest: install `wingetcreate` (`winget install Microsoft.WingetCreate`), then
  `wingetcreate submit deploy\winget\1.0.6` (it forks microsoft/winget-pkgs and opens the PR).
- Or manual: fork `microsoft/winget-pkgs`, copy the three files to
  `manifests/s/SubramanyaMysore/PolyglotFormFill/1.0.6/`, open a PR. CI validates automatically.
- **On every new desktop release:** bump `PackageVersion` + refresh `InstallerSha256` (SHA changes per
  build), add a new `manifests/.../<version>/` folder, submit again. Keep the installer URL stable.

## 2. Let SmartScreen/AV reputation build (free, automatic, permanent)
- Reputation accrues to the **signing certificate + the exact file hash**. Every install teaches
  SmartScreen the app is safe. **Do NOT rebuild/re-sign needlessly** — a new hash resets the clock.
- Keep the SAME domain + SAME installer object. (Today's domain move + rebuild is what reset it to zero
  on 2026-08-02; from here it only climbs.)
- Timeframe: days to ~2 weeks of real installs before the prompt stops appearing for most users.

## 3. Free false-positive submissions (accelerators — do once per flagged vendor)
Attach the VirusTotal link (…/file/82f98d8afa4cbeabef8c27f3c682b53309a7718ecf9d05b868065d1ac4d14d7c):
- **Microsoft WDSI** (SmartScreen + Defender): https://www.microsoft.com/wdsi/filesubmission → choose
  "Software developer" → upload the signed .exe → note it is a false positive on a signed, low-prevalence
  app. This is the one that most directly reduces the SmartScreen prompt.
- **McAfee**: https://sitelookup.mcafee.com (URL/file dispute).
- **Google Safe Browsing**: already filed 2026-08-02.
- **Sophos**: sample submitted; report shows Likely Clean.

## 4. Keep the Chrome Web Store extension as the primary trusted surface
The extension installs from the Web Store with no reputation prompt at all. The desktop `.exe` is the
secondary channel; winget + reputation cover it.

## What to tell a user who still hits the prompt (both are safe, one click)
- SmartScreen "unrecognized app": **More info → Run anyway** (Publisher shows "Subramanya Mysore").
- Chrome download "Virus detected": **Keep** on the download.
Neither blocks a determined install; both fade as reputation builds.

## The paid escape hatches (only if free isn't fast enough later)
- **Microsoft Store (MSIX)**: one-time $19, users free, instant + permanent (scaffolding already started
  in `deploy/msix/`). — see a future Store runbook.
- **EV code-signing cert**: ~$300/yr, instant SmartScreen trust for the direct .exe.
