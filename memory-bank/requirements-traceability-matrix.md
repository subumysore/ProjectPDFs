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
| REQ-02.1 | Make fillable: CREATE fields on flat PDFs + fill/export | 🟡 | `core-catalog` field-maps WITH coordinates; app creates AcroForm widgets on FLAT PDFs + fills + exports (pdf-lib), fills existing fields + pdf.js render. **Extension/desktop intelligent fill (2026-07-20):** layered — AcroForm field-NAME templates (W-4/W-9), semantic resolver by field label (tooltip→name; compose name, middle initial, **age from DOB**, split SSN, combine/split address), OCR-draw for XFA/scanned (W-2), form recognition (`pdfforms.js`); **image-valued fields** (photo/signature drawn into PDF boxes); **interactive filled-PDF viewer** (`<iframe>`, unfilled fields stay editable). See ADR-0016 | catalog tests; W-4/W-9 render-verified (5/5, 6/6); W-2 OCR + image-field render-verified; resolver/age unit-tested | — | ⚠️ |
| REQ-03.1 | Language-aware filling (native lang; view + write-back) | 🟡 | on-device NMT (transformers.js/ONNX, self-hosted, zero egress). **2026-07-20:** spec ETCHED (`docs/specs/language-aware-filling.md`, ADR-0016) — **native_language is a VAULT PROFILE field**; form-language AUTO-DETECT (`lang.js`, 8 langs); any-to-any via **English pivot**; **bilingual side panel**; output ALWAYS in the form's original language; **Devanagari/CJK output fonts** (fontkit + hosted Noto). Desktop `translate.ts` + `App.tsx` brought to parity (8 langs, pivot, persisted native_language). | `lang.js` detect unit-verified (8/8); Devanagari font render-verified; desktop tsc+build green. **Translate RUNTIME (model load) unvalidated in a real browser; non-en/hi desktop models need provisioning into public/models** | — | ❌ |
| REQ-04.1 | Auto-tags + on-device index/search | 🟡 | `core-catalog` search + tags; `services/catalog`; app `catalog_search` + UI | `core-catalog` search tests | — | ⚠️ |
| REQ-05.1 | Native cross-platform app, data on-device | 🟡 | `apps/app` (Tauri v2 + Rust core) builds | frontend build + `cargo build` | — | ⚠️ |
| REQ-06.1 | AI search bar | 🟡 | app "Find a form" search UI + `catalog_search` | core-catalog search tests | — | ⚠️ |
| REQ-07.1 | Save (versioned) & submit | 🟡 | `save_filled_form` (versions) + PDF export (pdf-lib) + `open_submit_url` (opens vendor page, HTTP warning, never proxied) | core-store versioning tests; builds | — | ⚠️ |
| REQ-08.1 | History, versioning, annotation layers | 🟡 | `core-store` FormInstance + immutable encrypted versions + history counters; annotation layers pending | `core-store` versioning/history tests | — | ⚠️ |
| REQ-09.1 | Non-delegable signing (Tier 1) | 🟡 | app `sign_form`: device Ed25519 key (OS keystore) signs the version hash + provenance -> signatures table + UI. OIDC broker for federated identity (reused). Tier-2 biometric + live OIDC pending | core-store signatures + core-crypto + account OIDC tests | — | ⚠️ |
| REQ-10.1 | Data-source extraction + profiles | 🟡 | app on-device OCR (tesseract.js) + heuristic extractor -> vault; profiles/subscriptions modeled. **Extension (2026-07-20):** camera/image capture → OCR (`tess.js`/`parse.js`) with glossy-ID preprocessing + driver's-licence heuristics (unlabelled + AAMVA field numbers); **PDF417 back-of-licence barcode → exact AAMVA fields** (`@zxing` vendored + `parseAamva`), LIVE continuous scan + continuous-autofocus (blur-tolerant); review-and-save UI. See ADR-0016 | ext: barcode+OCR validated end-to-end in a loaded extension (11 exact fields); `parseAamva`/`parseFields` unit-tested; live-camera wiring needs on-device test | — | ⚠️ |
| REQ-11.1 | Web-hosted download + web-form autofill | 🟡 | `core-fetch` URL validation (SSRF guard) + `core-webform` fill-plan; webview DOM injection pending | core-fetch + core-webform tests | — | ⚠️ |
| REQ-12.1 | Multi-party documents | 🟡 | `core-txn` state machine (roles, consent, sign, re-sign-on-edit) | `core-txn` workflow tests | — | ⚠️ |
| REQ-13.1 | Verifiable provenance (authority-scoped) | 🟡 | `core-crypto` ProvenanceManifest (SHA-256 + Ed25519 sign/verify); authority-encrypted block pending | provenance sign/tamper tests | — | ⚠️ |
| REQ-14.1 | Registered roles & verifiable workflows | 🟡 | `core-identity` Registry + Role capabilities (Sign non-delegable); workflow binding pending | `core-identity` role/capability tests | — | ⚠️ |
| REQ-17.1 | Offline monetization (licensing) | 🟡 | `core-license`: Ed25519-signed license tokens (tier/features/expiry) verified on-device against the embedded vendor public key; no activation server, nothing sent. Verify command + import UI pending. See RFC-0005 / ADR-0015 | `core-license` tests (5: issue↔verify+gating, wrong-key, tamper, expiry/perpetual, malformed) | — | ⚠️ |
| REQ-16.1 | Browser-extension client (secure) | 🟡 | `apps/extension` MV3: `vault.js` (AES-256-GCM; key derived on unlock via PBKDF2 passphrase or WebAuthn-PRF, never stored, non-extractable, memory-only) + background SW + popup (passphrase/passkey unlock, fill/lock) + page autofill + **passkey enrolment** (options). **Companion bridge:** `crates/native-host` (`projectpdfs-host`) native-messaging binary reads the app's on-device vault (same keystore key/DB); extension pulls the vault over the bridge so keys/vault stay in the native trust anchor; app **auto-registers** the companion (`register_companion` command + winreg; host bundled via `beforeBundleCommand` + `resources`); **passphrase→passkey migration** (re-seal under WebAuthn key). Engine reuse + reproducible builds pending. See RFC-0004 / ADR-0014 | `vault.test.mjs` (6, incl. migration) + `native-host` framing (2) + app compiles + JS syntax-checked | — | ⚠️ |
| REQ-15.1 | Multi-format forms (Word/Excel) | 🟡 | app `office.ts`: on-device fill of Word content controls + Excel named ranges (Phase A) AND flat docs — table label→next cell, "Label:" paragraphs, Excel label→neighbour cell (Phase B); fflate + fast-xml-parser round-trip; `.docx/.xlsx` routed in "Fill a Form". Office→PDF content export on-device (Phase C Tier-1, pdf-lib) via "Export as PDF". Tier-2 (LibreOffice)/vector print pending. See RFC-0002/0003, ADR-0011/0012 | `office.test.mjs` (7 tests incl. officeToPdf) + acceptance `features/office-form-fill.feature` (8 scenarios) + frontend build + headless UI run (fill + Export-as-PDF) | — | ⚠️ |
