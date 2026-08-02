# ADR-0028 — Desktop auto-update (Tauri updater) + SEO/social surface

- Status: Accepted
- Date: 2026-07-28
- Complements ADR-0026 (Authenticode signing) and ADR-0027 (trial). Brings the desktop to parity with the
  extension's silent auto-update, so a gated/fixed build actually reaches installed users.

## Context
The extension auto-updates via the Chrome Web Store; the desktop had no update path, so an installed
copy (e.g. an ungated pre-trial build, or one with a bug) stayed stale until a manual reinstall. We need
the desktop to check for, notify about, and install updates — without weakening the privacy invariant.

## Decision
Adopt the **Tauri v2 updater** with our **own signed update feed**.

- **Plugins**: `tauri-plugin-updater` + `tauri-plugin-process` (for relaunch); capabilities add
  `updater:default` + `process:allow-restart`.
- **Feed**: `plugins.updater.endpoints = ["https://polyglotformfill.com/download/latest.json"]`,
  a static JSON served DOWNWARD from our asset host (inbound download only — no user content leaves; the
  update check sends just the current version, which is not user data). `bundle.createUpdaterArtifacts`
  makes the build emit a per-installer `.sig`; `latest.json` carries `{version, notes, platforms:
  {windows-x86_64: {signature, url}}}` pointing at the same stable `/download/PolyglotFormFill-Setup.exe`.
- **Update signing**: a dedicated **minisign keypair** (separate from Authenticode + the license vendor
  key). The **public** key is embedded in `tauri.conf.json`; the **private** key + password sign the
  build via `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` env (kept in the build machine / a secret store, never
  in git). The updater verifies the download against the embedded public key before installing — so a
  compromised host cannot push a malicious update.
- **UX**: on launch the app checks the feed; if newer, a non-blocking banner offers **Update now** (one
  click → download + verify + install + relaunch) or **Later**. Silent on offline/failure.

## Bootstrap reality
The updater only works from the version that ships it (**1.0.4+**). Installs of 1.0.3 and earlier must be
updated manually **once** to 1.0.4; from there they auto-update. This is inherent to introducing an
updater and is acceptable at launch scale.

## Also in this change — SEO/social surface (free traction)
`build-site.mjs` now emits, for every page × language: canonical, Open Graph + Twitter cards (share image
= the before/after asset), and **hreflang** alternates (so the 26 localised pages aren't treated as
duplicate content and Google serves the right locale). Plus a full **sitemap.xml** (78 URLs) and
**robots.txt**. A ready-to-post **launch kit** (`docs/marketing/launch-kit.md`) holds Product Hunt / Show
HN / Reddit / store-listing copy — the maker posts them (platforms forbid automated posting-as-you).

## Consequences
- (+) Desktop reaches parity with the extension: fixes/gates propagate without a manual hunt.
- (+) Update integrity is cryptographic (minisign), independent of transport/host trust.
- (+) SEO/social cards make every share render a rich card and every locale index correctly.
- (−) A third signing key to safeguard (updater private key) — documented in the signing runbook.
- (−) 1.0.3-and-earlier need one manual update to gain the updater.

## Follow-ups
- Back up the updater private key alongside the license vendor key.
- Optional: staged rollout / release notes surfaced in the banner.
