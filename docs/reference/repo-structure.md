# Repo structure & Phase-0 execution plan (modular + parallel)

Accepted architecture: **native (Tauri v2 + Rust core + React/TS)** — see `docs/rfc/0001` and
`docs/reference/architecture.md`. This file is the file-layout map + how work parallelises.

## Target layout
```
apps/
  app/                 Tauri v2 app (installed)
    src/               React/TS UI (viewer, fill, editor, catalog search, profiles, signing)
    src-tauri/         Rust bridge + wiring; depends on crates/*
crates/                Rust core — independent, separately-buildable modules
  core-store  core-pdf  core-catalog  core-crypto  core-identity
  core-ocr    core-mt   core-extract  core-webform core-fetch  core-txn
services/
  catalog/             public Form Catalog API + index (down only)
  assets/              fonts/models/updates (down only)
  account/             subscription/billing + OIDC broker + role registry (metadata only)
packages/
  shared/              TS types/schemas shared UI <-> core
prototypes/            throwaway spikes (translated-fill, field-detection-trial) — reference only
```
The old `apps/api` + `packages/db` (Express/Drizzle/Postgres) scaffold is **superseded**; removal is
**pending explicit confirmation** (governance §1: no silent deletion).

## Environment prerequisites (NOT present in the current sandbox)
Phase-0/1 build needs a dev box (or CI) with:
- **Rust** (rustup + stable) — not installed here.
- **Tauri v2** system deps (WebView2 on Windows; per-OS webkit on mac/linux).
- **Mobile:** Android SDK + NDK; iOS needs macOS + Xcode. Rust mobile targets.
- Node/pnpm — present.
Until then, Rust/app code can be authored but **cannot be compiled or verified in-sandbox**.

## Parallelisable workstreams (independent, can proceed concurrently)
| # | Workstream | Depends on | Can start now? |
|---|---|---|---|
| A | **Phase-0 spike:** Tauri v2 mobile bindings (pdfium, onnxruntime, WebAuthn, keystore, biometric SDK) | dev env | needs env |
| B | `core-store` (SQLCipher schema, per-Profile repos) + `packages/shared` types | Rust | needs Rust |
| C | `core-pdf` (render + fill + export + annotation) | Rust, pdfium | needs Rust |
| D | `core-catalog` + `services/catalog` (schema, fingerprint, index sync) | — (Node service can start) | catalog service: yes |
| E | UI shell `apps/app/src` (React/TS: viewer, fill overlay, search) | Node | **yes** |
| F | Legal/compliance scoping (e-sign validity, biometric, DPDP/GDPR) | — | **yes** (non-code) |
| G | Catalog content model + first field-maps (curation) | D | partially |

**Sequencing rule:** A gates the full native commit (if Tauri mobile fails → Flutter pivot). B/C/D/E
can be developed in parallel behind stable module interfaces; integrate into the Phase-1 vertical
slice (open catalogued form → match → field-map → autofill from vault → encrypted save → export).

## Phase-1 MVP vertical slice (definition of the first shippable increment)
Single-user; catalogued PDF → field-map → autofill from local encrypted vault → Tier-1 sign →
export; 2–3 languages; on-device only. Each pillar lands behind its own REQ + spec + tests + BRD row.
