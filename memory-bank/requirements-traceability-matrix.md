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
| 14 | 0 | 10 | 4 | 0 | 10 | 0 | 4 |

## Matrix
| REQ | Title | Status | Implementation | Tests | Cov % | Prod-Ready |
|---|---|---|---|---|---|---|
| REQ-01.1 | On-device vault + catalog-first autofill | 🟡 | `core-store` (values AES-GCM sealed), `core-crypto`, `core-catalog` | `core-store` (incl. encrypted-at-rest), `core-catalog`, `core-crypto` unit tests | — | ⚠️ |
| REQ-02.1 | Catalog-first field maps, OCR fallback | 🟡 | `core-catalog` (maps + fingerprint match); `core-ocr` (stub) | catalog autofill + fingerprint tests | — | ⚠️ |
| REQ-03.1 | Translated view + original/chosen output | ☐ | `core-mt` (stub) | `TODO` | — | ❌ |
| REQ-04.1 | Auto-tags + on-device index/search | 🟡 | `core-catalog` search + tags; `services/catalog`; app `catalog_search` + UI | `core-catalog` search tests | — | ⚠️ |
| REQ-05.1 | Native cross-platform app, data on-device | 🟡 | `apps/app` (Tauri v2 + Rust core) builds | frontend build + `cargo build` | — | ⚠️ |
| REQ-06.1 | AI search bar | 🟡 | app "Find a form" search UI + `catalog_search` | core-catalog search tests | — | ⚠️ |
| REQ-07.1 | Save (versioned) & submit | 🟡 | app `save_filled_form` -> instance + immutable version + save counter; online submit pending | core-store versioning tests | — | ⚠️ |
| REQ-08.1 | History, versioning, annotation layers | 🟡 | `core-store` FormInstance + immutable encrypted versions + history counters; annotation layers pending | `core-store` versioning/history tests | — | ⚠️ |
| REQ-09.1 | Non-delegable signing (Tier 1 + Tier 2) | ☐ | `core-identity`, `core-crypto` (stubs) | `TODO` | — | ❌ |
| REQ-10.1 | Data-source extraction + profiles | ☐ | `core-extract` (stub) | `TODO` | — | ❌ |
| REQ-11.1 | Web-hosted download + web-form autofill | ☐ | `core-fetch`, `core-webform` (stubs) | `TODO` | — | ❌ |
| REQ-12.1 | Multi-party documents | 🟡 | `core-txn` state machine (roles, consent, sign, re-sign-on-edit) | `core-txn` workflow tests | — | ⚠️ |
| REQ-13.1 | Verifiable provenance (authority-scoped) | 🟡 | `core-crypto` ProvenanceManifest (SHA-256 + Ed25519 sign/verify); authority-encrypted block pending | provenance sign/tamper tests | — | ⚠️ |
| REQ-14.1 | Registered roles & verifiable workflows | 🟡 | `core-identity` Registry + Role capabilities (Sign non-delegable); workflow binding pending | `core-identity` role/capability tests | — | ⚠️ |
