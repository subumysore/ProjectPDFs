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

- **Phase-1 vertical slice (catalog-first autofill):** `core-store` (SQLite on-device vault + tests),
  `core-catalog` (field-maps + `autofill` join + tests), app command `demo_autofill`, UI table.
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
