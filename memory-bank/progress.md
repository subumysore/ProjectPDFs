# Progress

_What works, what's left, known issues. The narrative complement to the traceability matrix._

## Done (docs/assets) — 2026-07-25: launch strategy locked, guide video + landing page refreshed
- **ADR-0023** (code signing & platform distribution strategy, zero-cost first) and **ADR-0024**
  (launch distribution & platform roadmap, entity-triggered) written and Accepted. 0024 extends 0023.
- **Owner decisions captured (0024):** all three niches equal (immigration/relocation · freelancers/SMBs
  · privacy/crypto); no per-pair language rollout — packs pre-staged/QA'd by global speaker volume
  (Spanish, Chinese, Arabic, Portuguese, French, Russian, Bengali, …) since NLLB is on-device any-to-any
  and the UI is 26-language already (ADR-0018); desktop + extension presented equally; paid platform work
  deferred + sequenced around registering a business entity (EV cert → Azure Trusted Signing org
  re-check → macOS via Apple Developer Program + build Mac + notarization → Microsoft Store/MSIX).
  Triggers = revenue + entity registered; no dates.
- **Guide video rebuilt** (ADR-0022 pipeline): dynamic animated cards, before/after hero, real
  in-browser extension + live-translation demos, neural narration; stable URL unchanged.
- **Landing page:** hero + three niche sections added (equal-weight positioning).
- Governance: CHANGELOG entry added; REQ-05.2 traceability row extended; activeContext synced. No code,
  video re-publish, or site deploy performed in this closure task.

## Working (verified) — 2026-07-23 (later): fill/OCR/delete fixes + guide video (LOCAL ONLY)
- **Name composition on fill (REQ-02.1):** flat-PDF fill now composes a "Full name" from
  `first_name`+`last_name` via the resolver instead of an exact-key lookup; resolver falls back to a
  field's programmatic NAME when the label is unhelpful (company-name guard preserved). Verified
  live: detect → "Full name: JOHN DOE" fills. Unit-tested (`resolver.test.mjs`), shared with the
  extension.
- **ID-card capture (REQ-10.1):** a driving licence now yields name, DOB, licence no, address, city,
  expiry in one import (was 1 mislabelled field). `apps/app/src/ocr.test.mjs` (4 cases) green.
- **Passphrase-gated profile delete (REQ-01.1):** `delete_profile` verifies the vault passphrase
  server-side (shared `verify_passphrase`); wrong/empty passphrase deletes nothing; localized error
  in all 26 languages. Verified live (wrong blocks, correct deletes).
- **Learn-on-fill reachable after Detect (REQ-02.1/REQ-10.1):** Detect-fields opens the review
  editor; typing Nationality auto-registered it as a vault key (verified live).
- **Guide video (`docs/guide/output/`):** 13/14 segments, Amy narration, English captions, all
  synthetic data, app-window-only capture. **Left:** segment 11 (extension in a real browser).
- **Known gap:** none of this is pushed — local commits only, per the standing "do not push" hold.


## Working (verified) — 2026-07-23 distribution trust without a certificate (REQ-05.2, ADR-0020)
- **The certificate is off the GA critical path.** Budget rules out an OV/EV cert until there is
  revenue, so releases now ship deliberately unsigned, with trust carried by channel choice and
  published hashes rather than by Authenticode. Self-signing is dev-only (invalid chain ⇒ no
  SmartScreen benefit, and worse under some AV/enterprise policy).
- **`scripts/release-manifest.mjs`** generates/verifies per-artifact SHA-256. Deterministic; refuses
  to emit an empty manifest; reports every MISMATCH/MISSING in one pass. **12 unit tests green**,
  now part of `scripts/test-all.mjs` (which discovers `scripts/*.test.mjs`). CLI exercised
  end-to-end: exit 0 on a clean set, exit 1 with `MISMATCH` on a tampered byte.
- **Install page reworked:** extension → winget → direct download, with the SmartScreen warning
  described *before* the download button, plus a hash-verification command. Hashes and the version
  badge are read from `release-manifest.json` at runtime, so the copy cannot drift from reality.
- **Caught and fixed while doing it:** the published installers reported **ProductVersion 0.1.0** —
  the 1.0.0 bump never reached the binaries. Rebuilt: setup `.exe` 29.9 MB + MSI 31.9 MB + extension
  zip 9.0 MB, all at 1.0.0, staged in `site/download/` with the manifest regenerated (3/3 verified).
  Versions confirmed from the artifacts themselves (PE VersionInfo for the exe; the MSI Property
  table for the MSI, which has no PE version), and both confirmed `NotSigned`, matching
  `signed: false`. **Staged, not published.**
- **winget channel made real:** `deploy/winget/` holds the three manifests for
  `SubramanyaMysore.PolyglotFormFill` 1.0.0; `winget validate` passes against the real CLI; a
  5-test drift guard ties `InstallerSha256` to `release-manifest.json` and was proven to fail on a
  corrupted hash. The install page states honestly that winget is not live yet.
- **BLOCKED on one step:** publishing to polyglotformfill.mooo.com. `publish-site.ps1` was attempted
  and denied by the permission classifier (not worked around). The live site therefore still serves
  0.1.0, the page's runtime hash display is unverified against the live host, and the winget PR
  cannot be opened (winget downloads `InstallerUrl` during validation).
- Full suite green: 129 + 8 + 12, typecheck, vite build, traceability (18 requirements).
- **Left (live gate):** the rendered install page in a browser, and one real first-run install to
  confirm the warning matches what the page predicts.

## Working (verified) — 2026-07-22 desktop tabs
- **Desktop app is now tabbed** (Profile → Vault → Forms → Past forms), not a scrolling SPA. Tab
  gating (profile required), four labelled form sources (device / network location / URL / web
  search), and a Past-forms panel. Verified by `npm run typecheck` + `npm run build` (green).
- **Left:** live end-to-end walkthrough capture of the tabs in the running app (blocked on the user
  typing the vault passphrase — WebView2 rejects synthetic keystrokes; to be done together).

## Working (verified) — 2026-07-20 extension/desktop iteration
- **ID capture (extension):** camera/image → OCR → profile fields; **PDF417 back-of-licence
  barcode → exact AAMVA fields** (validated end-to-end in a loaded extension: 11 exact fields).
  Licence OCR fallback parses unlabelled + AAMVA-numbered layouts. OCR preprocessing for glossy IDs.
- **Intelligent PDF fill:** semantic resolver by field label; **form templates** — W-2 (OCR draw),
  W-4/W-9 (AcroForm field-name templates, render-verified 5/5 & 6/6), I-9 (AcroForm); OCR fill for
  XFA/scanned in the persistent viewer; **age derived from DOB**; numbered dependent keys mapped.
- **Image-valued fields:** photo/signature stored as data-URI, drawn fitted+centred into PDF
  photo/signature boxes (render-verified).
- **Interactive filled-PDF viewer** (`<iframe>` blob) — unfilled AcroForm fields stay editable.
- **Language-aware filling:** `native_language` vault field; on-device form-language detection
  (8 langs, unit-verified); any-to-any translate via English pivot; bilingual side panel;
  Devanagari/CJK output fonts (fontkit + hosted Noto, Devanagari render-verified).
- **Desktop parity:** resolver/templates/lang/fonts ported to `apps/app/src/fill/`; `tsc` + `vite
  build` green.
- **Ops:** `deploy/publish-extension.ps1` one-command rebuild+publish (robust OCI upload under PS 5.1).
- **Known gaps:** translate RUNTIME (model load) unvalidated in a real browser; non-en/hi desktop
  translation models not yet in `public/models`; glossy-front OCR is best-effort (barcode is exact).

## Working (verified)
- Governance scaffold (SDD, Memory Bank, ADR/RFC flow, traceability check) — green.
- Feasibility spikes: `prototypes/translated-fill`, `prototypes/field-detection-trial`.
- RFC-0001 accepted; ADR-0002…0010 recorded; full requirements + UML documented.
- **Dev toolchain installed + verified** (Rust 1.97 MSVC + Android targets, VS Build Tools, JDK 17,
  Node/pnpm, WebView2) — `docs/reference/dev-setup.md`.
- **Rust workspace builds:** root `Cargo.toml` + 11 `crates/core-*` stubs; `cargo build`/`cargo test` green.
- **Tauri v2 desktop app builds + links** (`apps/app`): `app.exe` (12.4 MB); frontend build green.
- **Phase-1 vertical slice (catalog-first autofill) WORKING end-to-end + tested:**
  `core-store` (SQLite vault, upsert, tests) + `core-catalog` (field-maps + `autofill`, tests) wired
  through the app command `demo_autofill` and shown in the UI (fills a sample passport form from the
  vault, flags missing keys). `cargo test` green (25 result lines, 0 failures).
- **`services/catalog`** (Node) — public catalog API stub; `/health`, `/v1/catalog`,
  `/v1/catalog/:id` verified serving; typechecks. **`packages/shared`** TS domain types; typechecks.
- **Requirements traced:** 14 pillars → `REQ-01.1…REQ-14.1` in BRD + matrix; `check-traceability` green.
- Old `apps/api`/`packages/db` removed; workspace globs now include `services/*`.

- **Persistent vault manager:** `core-store` CRUD (list/delete) + persistent SQLite at OS app-data
  dir; app commands + a real UI (create profiles, add/edit/delete data points, autofill per profile).
  All tests green; `[profile.test] debug=0` fixes Windows LNK1201 on test builds.

- **Encryption at rest:** `core-crypto` (AES-256-GCM, 6 tests) + `core-store` seals DataPoint values
  before disk (DB holds only ciphertext, verified). App uses a per-install key (OS keystore later).

- **Catalog search + matching:** `core-catalog` search (name+tags) + fingerprint match + 3-form demo
  catalog (tests); app `catalog_search` command + "Find a form" UI; autofill targets the chosen form.

- **Crypto:** `core-crypto` AES-GCM + Ed25519 sign/verify + X25519 sealed bundles + provenance
  manifest (SHA-256 + signed) — 10 tests.
- **Multi-party workflow:** `core-txn` state machine + re-sign-on-edit invariant (6 tests).
- **Form versioning + history:** `core-store` immutable encrypted version chain + save/submit/print
  counters (6 tests, incl. encrypted-at-rest).
- **Save filled form** wired end-to-end (app command + UI).
- **Registered roles:** `core-identity` Role/Capability + Registry; Sign non-delegable structurally (4 tests).

## ALL 14 REQUIREMENTS NOW IN PROGRESS (built + plumbed + build/test-verified)
Full app loop wired: profiles → encrypted vault → catalog search → autofill →
**PDF render/fill/export** → save (immutable encrypted versions + history) →
**on-device device-key signing + provenance** → **submit (open vendor page + HTTP warning)**.
Plus: **self-hosted OCR** (Tesseract, data-source extraction), **self-hosted English↔Hindi
translation** (transformers.js/ONNX), **OS-keystore** vault + sign keys, web-form fill-plan +
URL validation, OIDC identity broker (reused from Hospital Nexus), multi-party FSM, roles.
All self-hosted engines keep `connect-src 'self'` (zero third-party egress); execution-only CSP.

## Runtime-pending (verify during the test pass, not headless-verifiable)
- OCR accuracy, translation quality (run `scripts/fetch-translation-assets.mjs` first),
  PDF fill on real forms, live signing/submit, OIDC live flow (needs Google client creds).
- Biometric Tier-2 (scanner), Android SDK/NDK (mobile), iOS (Mac). Annotation layers, authority-
  scoped provenance encryption, multi-party UI — modeled/foundational, not yet full UI.

## In progress
- **Phase 1 — vault (encrypted) + catalog search/autofill + crypto + multi-party FSM.** Next:
  provenance manifest (sign+hash), FormInstance versioning, OS-keystore key, wire signing into the
  app; translation (`core-mt`) + OCR (`core-ocr`); `pnpm tauri dev`; Android SDK/NDK; iOS on a Mac.

## Not started / backlog
- **Phase 0 spike (GATING): Tauri v2 mobile bindings** — validate pdfium + onnxruntime + WebAuthn +
  secure keystore + (external) biometric SDK on iOS/Android before committing all platforms.
- **Phase 1 MVP:** single-user, catalog-first fill + vault autofill + translated view + Tier-1
  signing + encrypted local store (SQLCipher), 2–3 languages.
- Phase 2: data-source extraction, web-form autofill, OCR fallback, more languages.
- Phase 3: institutions/admin, multi-party documents, encrypted sharing.
- Phase 4: in-person biometric signing, authority-scoped provenance, registered roles/workflows.
- Legal/compliance scoping (e-sign validity, biometric, GDPR/India DPDP) — first-class workstream.
- Native repo restructure (`apps/app`, `crates/*`, `services/*`) — skeleton to be created.
- Retire old `apps/api`/Postgres scaffold — **pending explicit confirmation** (no silent deletion).

## Known issues & residuals
- Tauri v2 mobile maturity is unproven for our native dependency set (the #1 risk; Phase 0 gates it).
- Worst-case CJK OCR/field-detection is weak (mitigated by catalog-first; OCR is fallback only).
- `translated-fill` spike used cloud translation for the demo; production is on-device (invariant).

## Milestones
| Milestone | Target | Status |
|---|---|---|
| RFC-0001 accepted + ADRs recorded | 2026-07-16 | ☑ |
| Phase 0 spike (Tauri v2 mobile bindings) go/no-go | TBD | ☐ |
| Phase 1 MVP vertical slice (catalog-first fill → sign → export) | TBD | ☐ |
