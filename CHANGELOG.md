# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]
### Added
- Initial SDD + Memory Bank + governance scaffold.
- Product vision & full requirements (projectBrief pillars #1–#14): privacy-first on-device PDF/form
  autofill, translated-fill, Form Catalog, data-source extraction, profiles/subscriptions,
  non-delegable + in-person biometric signing, multi-party documents, authority-scoped provenance,
  registered roles & verifiable workflows.
- Feasibility trials (`docs/feasibility/`): worst-case OCR/field-detection (conditional GO) +
  market/tech reassessment.
- **RFC-0001 accepted**; **ADR-0002…0010 recorded** (native stack, encrypted sharing, non-delegable
  signing, Form Catalog, signing hand-off, biometric signing, multi-party, provenance, roles).
- UML model (use-case, component, domain class, sequences, lifecycle) published.

- **Persistent vault + CRUD:** `core-store` gains `list_profiles`/`data_points`/`delete_data_point`
  (+ tests); app manages a persistent SQLite store under the OS app-data dir with commands
  `create_profile`/`list_profiles`/`list_data_points`/`upsert_data_point`/`delete_data_point`/`autofill_for`.
- **Vault manager UI:** create profiles, add/edit/delete data points, and catalog-first autofill per
  selected profile (`apps/app/src/App.tsx`).
- **Phase-1 vertical slice (catalog-first autofill):** `core-store` (SQLite on-device vault + tests),
  `core-catalog` (field-maps + `autofill` join + tests), app command `demo_autofill`, UI table.

- **Catalog search + matching:** `core-catalog` gains tags, on-device `search` (name+tags, ranked),
  `match_by_fingerprint`, and a 3-form demo catalog (+ tests). App: `catalog_search` command and a
  "Find a form" search UI; `autofill_for` now targets the chosen form.
- **On-device OCR data-source extraction (REQ-10):** app imports a passport/licence image, runs Tesseract.js OCR in the webview (image never leaves the device), extracts key-values via patterns, and saves to the vault after review. Build-verified; runtime needs the live app.
- **On-device translation (REQ-03):** app translates field labels English↔Hindi via transformers.js (ONNX/onnxruntime-web WASM), fully SELF-HOSTED — models + ort WASM load from the app origin (connect-src stays self), text never leaves the device. Lazy dynamic import; models provisioned by scripts/fetch-translation-assets.mjs (not committed).
- **Submit online (REQ-07):** `open_submit_url` opens the vendor/gov submission page in the default browser (user submits there directly — never proxied); warns on insecure HTTP. Filled PDF exports locally. + URL input UI.
- **PDF render + fill/export (REQ-02):** app opens a PDF, renders page 1 with pdf.js, fills AcroForm text fields from the vault via pdf-lib (matched by field name), and exports the filled PDF — all on-device (bundled worker, no egress).
- **Device signing (REQ-09 Tier-1 functional):** app `sign_form` — a device Ed25519 key (OS keystore) signs the latest saved versions hash inside a provenance manifest; signature stored (signatures table) + UI Sign button. Non-delegable (device+profile key). `form_signatures` lists them.
- **Web features (REQ-11):** `core-fetch` validates form URLs (http/https only, blocks private/loopback/link-local/metadata hosts) and `core-webform` builds a DOM fill-plan from the vault. Native download + webview injection wire to these. 6 tests.
- **OIDC identity broker (signing Tier 1 foundation):** `services/account` OIDC service — PKCE,
  SSRF-guarded discovery, and JWKS ID-token verification returning an identity assertion only
  (never content). **Adapted/reused from the Hospital Nexus SSO** and re-scoped to our local-first,
  content-free model; bound to on-device Ed25519 for non-delegable signing. 5 unit tests.
- **Registered roles:** `core-identity` Role/Capability model + Registry (role asserted on sign-in,
  scopes capabilities). Encodes the **non-delegable-signing rule structurally** — no role, not even
  InstitutionAdmin, holds a delegated `Sign` capability. 4 tests. (REQ-14; REQ-06 search bar marked.)
- **Save filled form:** app `save_filled_form` command + UI Save button — autofills, appends an immutable encrypted version, and records a save event (shows version + count). REQ-07 (save).
- **Form versioning & history:** `core-store` gains `FormInstance`, an **immutable encrypted version chain** (`add_version`/`list_versions`/`version_values`), and save/submit/print history counters. 6 tests. (REQ-08; annotation layers pending.)
- **Multi-party workflow:** `core-txn` state machine (Draft→Gathering→Assembled→Circulating→PartiallySigned→FullyExecuted, with Withdrawn + ChangesRequested), per-party consent + signatures, and the re-sign-on-edit invariant (editing clears signatures). 6 tests.
- **Verifiable provenance:** `core-crypto` `ProvenanceManifest` (SHA-256 doc hash + Ed25519 sign/verify, tamper-detecting) — the public/verifiable part of ADR-0009. 10 tests total.
- **Signing + E2E sealed bundles:** `core-crypto` adds **Ed25519** sign/verify (signatures +
  provenance foundation) and **X25519 ECIES sealed bundles** (`seal_to`/`open_from`, the basis for
  user-directed E2E export/import per ADR-0003). 8 tests total.
- **Encryption at rest:** `core-crypto` AES-256-GCM seal/open (random nonce, tamper-detecting).
  `core-store` now **seals DataPoint values before they touch disk** (DB holds only
  ciphertext; verified by `values_are_encrypted_at_rest`). App loads/creates a per-install key
  (OS keystore in production).

- **Fill Word/Excel forms (.docx/.xlsx), on-device (RFC-0002 Phase A):** named fillable regions are filled from the vault — Word **content controls** (w:sdt tag/alias → ontology key) and Excel **named ranges** (definedName → cell). OOXML is unzipped (fflate), edited (fast-xml-parser, order-preserving), re-zipped, and downloaded as a filled file. No Office runtime, no server, no upload. Unit-tested; verified end-to-end in the UI.
- **Fill a form from the web (URL):** paste a form URL; the app downloads it **on-device** (new `core-fetch::fetch_form` via reqwest/rustls + `download_form` command) and runs the same auto-detect → fill pipeline. SSRF-guarded (http/https only, private/loopback/link-local blocked, every redirect hop re-validated), 30s timeout, 25 MB cap. Inbound-only download — no user content goes up. PDF or image; Word/Excel from URL not yet.
- **Windows code signing (Authenticode):** opt-in, secret-free signing hook (`sign-windows.ps1`) wired via `bundle.windows.signCommand`. Signs the app exe, MSI, and NSIS setup + RFC-3161 timestamps them when a cert is provided via env (`WINDOWS_CERT_THUMBPRINT` or `WINDOWS_CERT_PFX`); skips gracefully (unsigned) with none set, so dev builds still work. Self-signed dev-cert generator + docs (`docs/reference/code-signing.md`). Verified end-to-end: signed build produces signed MSI + setup.exe.
- **Image of a form → editable PDF (REQ-02):** a PNG/JPG photo or scan is wrapped into a PDF page on-device (`imageToPdf`, pdf-lib embedPng/embedJpg), then the OCR-detect → make-fillable → fill pipeline turns it into an editable, filled form. Section-5 file picker now accepts images; nothing is uploaded.
- **OCR/CV field detection for UNCATALOGUED PDFs (REQ-02 fallback):** `detect.ts` renders the page (pdf.js), OCRs it on-device (self-hosted Tesseract, with bounding boxes), maps label-like lines to ontology keys, converts canvas px → PDF points, and feeds the create-fields code — so a scanned/flat PDF we have no catalog map for gets fields auto-placed + filled. "Detect fields (OCR) & fill" UI.
- **Make a non-editable PDF fillable (REQ-02, the core gap):** catalog field-maps now carry per-field **coordinates + kind**; the app CREATES AcroForm widgets on a FLAT PDF (no form fields) at those coordinates via pdf-lib, fills them from the vault, and exports a new fillable+filled PDF. Verified end-to-end (flat PDF 0 fields -> 3 created + filled + persisted). "Generate flat sample PDF" + "Make fillable & fill" UI.

### Fixed
- Windows `LNK1201` (.pdb write/lock contention under AV/Drive) on test builds — `[profile.test] debug = 0`.
- Repo bloat: gitignored + removed Google Drive sync artifacts; `git gc` reclaimed accidental blob bloat.
- `services/catalog` (Node) public catalog API stub + `packages/shared` TS domain types (both typecheck).
- Requirements: 14 pillars written as `REQ-01.1…REQ-14.1` (BRD + traceability matrix; check green).
- **Tauri v2 desktop app** (`apps/app`): React/TS UI + Rust `src-tauri` wired to the core crates —
  `cargo build` links and produces `app.exe`; frontend builds; icon set generated.
- Rust workspace (`Cargo.toml` + 11 `crates/core-*` stubs) — builds + tests green.
- Dev-environment setup + toolchain install (`docs/reference/dev-setup.md`): Rust 1.97 (MSVC) +
  Android targets, VS 2022 C++ Build Tools, JDK 17, WebView2 verified.
- Modular repo skeleton (`apps/app`, `crates/`, `services/`, `packages/shared`) + `repo-structure.md`.

### Changed
- Architecture direction finalized: **native (Tauri v2 + Rust + React/TS)**.

### Removed
- Old server-centric scaffold `apps/api` (Express) + `packages/db` (Drizzle/Postgres) — superseded by
  the native, local-first architecture (RFC-0001 / ADR-0002).

<!--
Release template:

## [1.0.0] - YYYY-MM-DD
### Added / Changed / Deprecated / Removed / Fixed / Security
- ...
A release tag MUST correspond to a reproducible build/commit (tag == deployed image).
-->
