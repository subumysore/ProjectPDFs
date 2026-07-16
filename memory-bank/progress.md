# Progress

_What works, what's left, known issues. The narrative complement to the traceability matrix._

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
