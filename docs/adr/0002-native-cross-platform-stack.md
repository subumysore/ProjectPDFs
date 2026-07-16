# ADR-0002: Native cross-platform stack (Tauri v2 + Rust + React/TS)

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Team
- **Related:** RFC-0001, ADR-0003..0010

## Context
ProjectPDFs must run on Desktop + Tablet + Phone, keep **all user data on-device**, and run **all
processing on-device** (OCR, translation, embeddings, PDF, crypto). A web app re-downloads its code
each visit (served-code trust gap) and is CORS-bound (can't auto-download third-party forms).

## Options considered
1. **Native, Tauri v2 + Rust core + React/TS UI** — one installed codebase all platforms; auditable;
   native storage/keystore/camera; Rust for crypto/perf; reuses the JS document ecosystem.
2. **Web/PWA** — easiest distribution, but served-code trust + evictable storage + CORS limits.
3. **Flutter** — strong mobile UX, but weaker on-device OCR/NMT/PDF ecosystem, larger rewrite.

## Decision
Adopt **Tauri v2 + Rust core (`crates/*`) + React/TypeScript UI**. Web/PWA rejected as primary
(served-code trust); Flutter is the fallback if the Tauri-v2 mobile spike fails.

## Consequences
- Positive: strongest privacy posture; native capabilities; code reuse; low server footprint.
- Negative: Rust+TS dual-language build; **Tauri v2 mobile maturity is the #1 risk** (pdfium, ONNX,
  biometric SDKs, WebAuthn, keystore) → **Phase 0 spike gates full commit**.
