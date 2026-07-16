# crates/ — Rust core (modular)

Independent, separately-buildable modules behind stable interfaces. The UI (`apps/app/src-tauri`)
composes them; crates do not reach around `core-store` for persistence, and only `services/*` are
network-facing (down only). Status: **specified, not yet implemented** (Rust toolchain not in the
current sandbox — see `docs/reference/repo-structure.md`).

| Crate | Responsibility | Phase |
|---|---|---|
| `core-store` | SQLCipher DB, per-Profile repos, encrypted blob store | 1 |
| `core-pdf` | render (pdfium), edit/export (lopdf, fontkit), annotation layers | 1 |
| `core-catalog` | local catalog index sync, on-device search, fingerprint match | 1 |
| `core-crypto` | OS keystore, at-rest encryption, Ed25519 signing, E2E bundles, provenance | 1–4 |
| `core-identity` | WebAuthn/OIDC signer auth, registered roles | 1,4 |
| `core-ocr` | OCR (ONNX/Tesseract) + CV field detection — fallback | 2 |
| `core-mt` | on-device translation (NMT) | 2 |
| `core-extract` | data-source doc extraction + ontology | 2 |
| `core-webform` | in-app webview autofill (DOM injection) | 2 |
| `core-fetch` | native HTTP download of web-hosted files (no CORS) | 2 |
| `core-txn` | multi-party document orchestration + role-scoped workflows | 3 |

Each crate: `Cargo.toml` + `src/lib.rs` with a documented public interface + unit tests. Added as a
Cargo workspace member when the workspace is initialised on a Rust-equipped box.
