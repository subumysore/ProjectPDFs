# apps/app — native application (Tauri v2)

The installed cross-platform app (Desktop + Tablet + Phone). React/TS UI in the Tauri webview + Rust
core (`crates/*`). **All user data on-device; all processing on-device.**

- `src/` — React/TS UI: viewer, fill overlay, field editor, catalog search, profiles, signing.
- `src-tauri/` — Rust bridge + wiring; composes `crates/*`.

Status: **skeleton pending**. The UI (`src/`) is Node-buildable and can start now; `src-tauri` needs
Rust. Init on a Rust+Tauri-equipped box: `npm create tauri-app@latest` (or `cargo tauri init`) then
wire crates. See `docs/reference/repo-structure.md` for environment prerequisites and the Phase-1
vertical slice.
