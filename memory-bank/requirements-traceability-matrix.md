# Requirements Traceability Matrix

_The SINGLE source of truth for requirement status. Every `REQ-NN.M` in the BRD appears here exactly
once. `node scripts/check-traceability.mjs` reconciles this against the BRD._

## Legend
- **Status:** ☐ Not started · 🟡 In progress · ✅ Completed
- **Prod-Ready:** ✅ yes (tests + coverage meet bar) · ⚠️ coded, manual-verified, no full automated test ·
  🟠 tested with gaps · ❌ no
- **Coverage %** from the coverage report.

## Executive rollup
| Total | ✅ | 🟡 | ☐ | Prod-Ready ✅ | ⚠️ | 🟠 | ❌ |
|---|---|---|---|---|---|---|---|
| 17 | 0 | 17 | 0 | 0 | 15 | 0 | 2 |

## Matrix
| REQ | Title | Status | Implementation | Tests | Cov % | Prod-Ready |
|---|---|---|---|---|---|---|
| REQ-01.1 | On-device vault + catalog-first autofill | 🟡 | `core-store` (values AES-GCM sealed), `core-crypto`, `core-catalog` | `core-store` (incl. encrypted-at-rest), `core-catalog`, `core-crypto` unit tests | — | ⚠️ |
| REQ-02.1 | Make fillable: CREATE fields on flat PDFs + fill/export | 🟡 | `core-catalog` field-maps WITH coordinates; app creates AcroForm widgets on FLAT PDFs at coords + fills + exports (pdf-lib), also fills existing fields + pdf.js render; OCR-detected coords for uncatalogued forms pending | catalog tests + verified flat->3 fields created+filled | — | ⚠️ |
| REQ-03.1 | Base-language view + write-back (En↔Hi) | 🟡 | base-language selector; `translateForViewing` (form→base, view-only) + `captureAnswer` back-translation (base→form's original language) before fill/store; on-device NMT (transformers.js/ONNX, self-hosted, zero egress) | frontend build (runtime needs model download) | — | ❌ |
| REQ-04.1 | Auto-tags + on-device index/search | 🟡 | `core-catalog` search + tags; `services/catalog`; app `catalog_search` + UI | `core-catalog` search tests | — | ⚠️ |
| REQ-05.1 | Native cross-platform app, data on-device | 🟡 | `apps/app` (Tauri v2 + Rust core) builds | frontend build + `cargo build` | — | ⚠️ |
| REQ-06.1 | AI search bar | 🟡 | app "Find a form" search UI + `catalog_search` | core-catalog search tests | — | ⚠️ |
| REQ-07.1 | Save (versioned) & submit | 🟡 | `save_filled_form` (versions) + PDF export (pdf-lib) + `open_submit_url` (opens vendor page, HTTP warning, never proxied) | core-store versioning tests; builds | — | ⚠️ |
| REQ-08.1 | History, versioning, annotation layers | 🟡 | `core-store` FormInstance + immutable encrypted versions + history counters; annotation layers pending | `core-store` versioning/history tests | — | ⚠️ |
| REQ-09.1 | Non-delegable signing (Tier 1) | 🟡 | app `sign_form`: device Ed25519 key (OS keystore) signs the version hash + provenance -> signatures table + UI. OIDC broker for federated identity (reused). Tier-2 biometric + live OIDC pending | core-store signatures + core-crypto + account OIDC tests | — | ⚠️ |
| REQ-10.1 | Data-source extraction + profiles | 🟡 | app on-device OCR (tesseract.js) + heuristic extractor -> vault; profiles/subscriptions modeled | frontend build (runtime needs live app) | — | ❌ |
| REQ-11.1 | Web-hosted download + web-form autofill | 🟡 | `core-fetch` URL validation (SSRF guard) + `core-webform` fill-plan; webview DOM injection pending | core-fetch + core-webform tests | — | ⚠️ |
| REQ-12.1 | Multi-party documents | 🟡 | `core-txn` state machine (roles, consent, sign, re-sign-on-edit) | `core-txn` workflow tests | — | ⚠️ |
| REQ-13.1 | Verifiable provenance (authority-scoped) | 🟡 | `core-crypto` ProvenanceManifest (SHA-256 + Ed25519 sign/verify); authority-encrypted block pending | provenance sign/tamper tests | — | ⚠️ |
| REQ-14.1 | Registered roles & verifiable workflows | 🟡 | `core-identity` Registry + Role capabilities (Sign non-delegable); workflow binding pending | `core-identity` role/capability tests | — | ⚠️ |
| REQ-17.1 | Offline monetization (licensing) | 🟡 | `core-license`: Ed25519-signed license tokens (tier/features/expiry) verified on-device against the embedded vendor public key; no activation server, nothing sent. Verify command + import UI pending. See RFC-0005 / ADR-0015 | `core-license` tests (5: issue↔verify+gating, wrong-key, tamper, expiry/perpetual, malformed) | — | ⚠️ |
| REQ-16.1 | Browser-extension client (secure) | 🟡 | `apps/extension` MV3: `vault.js` (AES-256-GCM; key derived on unlock via PBKDF2 passphrase or WebAuthn-PRF, never stored, non-extractable, memory-only) + background SW + popup (passphrase/passkey unlock, fill/lock) + page autofill + **passkey enrolment** (options). **Companion bridge:** `crates/native-host` (`projectpdfs-host`) native-messaging binary reads the app's on-device vault (same keystore key/DB); extension pulls the vault over the bridge so keys/vault stay in the native trust anchor; app **auto-registers** the companion (`register_companion` command + winreg; host bundled via `beforeBundleCommand` + `resources`); **passphrase→passkey migration** (re-seal under WebAuthn key). Engine reuse + reproducible builds pending. See RFC-0004 / ADR-0014 | `vault.test.mjs` (6, incl. migration) + `native-host` framing (2) + app compiles + JS syntax-checked | — | ⚠️ |
| REQ-15.1 | Multi-format forms (Word/Excel) | 🟡 | app `office.ts`: on-device fill of Word content controls + Excel named ranges (Phase A) AND flat docs — table label→next cell, "Label:" paragraphs, Excel label→neighbour cell (Phase B); fflate + fast-xml-parser round-trip; `.docx/.xlsx` routed in "Fill a Form". Office→PDF content export on-device (Phase C Tier-1, pdf-lib) via "Export as PDF". Tier-2 (LibreOffice)/vector print pending. See RFC-0002/0003, ADR-0011/0012 | `office.test.mjs` (7 tests incl. officeToPdf) + acceptance `features/office-form-fill.feature` (8 scenarios) + frontend build + headless UI run (fill + Export-as-PDF) | — | ⚠️ |
