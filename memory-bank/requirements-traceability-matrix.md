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
| 14 | 0 | 2 | 12 | 0 | 2 | 0 | 12 |

## Matrix
| REQ | Title | Status | Implementation | Tests | Cov % | Prod-Ready |
|---|---|---|---|---|---|---|
| REQ-01.1 | On-device vault + catalog-first autofill | 🟡 | `core-store`, `core-catalog`, `demo_autofill` | `core-store`, `core-catalog` unit tests | — | ⚠️ |
| REQ-02.1 | Catalog-first field maps, OCR fallback | 🟡 | `core-catalog` (maps); `core-ocr` (stub) | catalog autofill test | — | ⚠️ |
| REQ-03.1 | Translated view + original/chosen output | ☐ | `core-mt` (stub) | `TODO` | — | ❌ |
| REQ-04.1 | Auto-tags + on-device index | ☐ | `services/catalog`, `core-catalog` | `TODO` | — | ❌ |
| REQ-05.1 | Native cross-platform app, data on-device | 🟡 | `apps/app` (Tauri v2 + Rust core) builds | frontend build + `cargo build` | — | ⚠️ |
| REQ-06.1 | AI search bar | ☐ | `TODO` | `TODO` | — | ❌ |
| REQ-07.1 | Save & submit (no proxy) | ☐ | `TODO` | `TODO` | — | ❌ |
| REQ-08.1 | History, versioning, annotation layers | ☐ | `TODO` | `TODO` | — | ❌ |
| REQ-09.1 | Non-delegable signing (Tier 1 + Tier 2) | ☐ | `core-identity`, `core-crypto` (stubs) | `TODO` | — | ❌ |
| REQ-10.1 | Data-source extraction + profiles | ☐ | `core-extract` (stub) | `TODO` | — | ❌ |
| REQ-11.1 | Web-hosted download + web-form autofill | ☐ | `core-fetch`, `core-webform` (stubs) | `TODO` | — | ❌ |
| REQ-12.1 | Multi-party documents | ☐ | `core-txn` (stub) | `TODO` | — | ❌ |
| REQ-13.1 | Verifiable provenance (authority-scoped) | ☐ | `core-crypto` (stub) | `TODO` | — | ❌ |
| REQ-14.1 | Registered roles & verifiable workflows | ☐ | `services/account`, `core-txn` (stubs) | `TODO` | — | ❌ |
