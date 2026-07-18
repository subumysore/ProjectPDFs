# RFC-0004: Browser-extension client with built-in security

- **Status:** Accepted — **security core + MV3 scaffold implemented** (2026-07-18);
  companion bridge + passkey enrolment pending
- **Author(s):** ProjectPDFs team (explicit user request)
- **Created:** 2026-07-18
- **Related:** ADR-0002 (native-over-web decision), REQ-11.1 (fill forms wherever they live),
  REQ-01.1 (on-device vault), REQ-09.1 (signing); proposes **REQ-16**. Produced **ADR-0014**.

## Summary
Ship ProjectPDFs as a **browser extension** (Manifest V3) with security built in: an
AES-256-GCM on-device vault whose key is derived on unlock from a **passphrase** (PBKDF2)
or a **passkey** (WebAuthn PRF, hardware-backed) and **never stored**. Because a
store-served extension auto-updates code (the very trust gap ADR-0002 avoided by going
native), the recommended shape is a **companion architecture**: the native app remains
the trust anchor (vault, keys, signing) and the extension is a thin web-form autofill
client over native-messaging. A **secure standalone mode** (passphrase / passkey) is
also supported for users who want extension-only, with the residual trust trade-off
made explicit.

## Motivation
Web-form autofill is the extension's natural strength (content scripts fill the DOM
directly — no in-app browser). Users asked whether the whole product can be an
extension. It mostly can, and the on-device/no-remote-code model maps cleanly to MV3.
The open questions are **key protection at rest** (no OS keystore in a browser) and the
**served-code trust gap** — both addressable, neither ignorable.

## Detailed design

### What maps to an extension
- Web-form autofill (content/injected script) — better than native.
- PDF (pdf-lib/pdf.js), DOCX/XLSX (fflate/fast-xml-parser), OCR (Tesseract.js),
  translation (transformers.js) — all JS/WASM, reusable.
- Cross-origin form download / web search — MV3 background fetch (host permissions).

### Key at rest (the security core — implemented, tested)
`apps/extension/src/vault.js`:
- **Passphrase** → PBKDF2-SHA256 600k → non-extractable AES-GCM key.
- **WebAuthn PRF** → per-credential hardware secret → HKDF → AES-GCM key.
- `seal`/`open` (AES-GCM, random IV, authenticated) — tamper-detecting.
- Key + plaintext exist **only in the service-worker memory** while unlocked; storage
  holds salt + ciphertext only. 5 unit tests (round-trip, wrong-passphrase, tamper,
  PRF path, non-extractable).

### The irreducible served-code gap — mitigations
Ranked, per README / ADR-0014:
1. **WebAuthn-PRF unlock** — a malicious update can't decrypt without the hardware passkey.
2. **Companion mode** — keys/vault/signing stay in the native app; extension holds nothing sensitive.
3. **Reproducible builds + published hashes**; **self-hosted/enterprise distribution**;
   **no egress surface** (no analytics, minimal permissions, CSP `connect-src 'self'`).

### Companion bridge (next)
Native-messaging host in the Rust app exposes read-vault / fill-plan / sign to the
extension; the extension never holds the vault. (Same shape as 1Password/Bitwarden.)

## Alternatives considered
- **Extension-only, key beside data.** Rejected — defeats encryption-at-rest.
- **PWA / website.** Rejected earlier (ADR-0002) — worse served-code trust than an extension.
- **Native-only (today).** Strongest trust, but no in-browser autofill ergonomics.

## Risks & trade-offs
- **Served-code auto-update** — shrunk (above), not eliminated; companion mode removes
  it for sensitive material.
- **Key protection** weaker than OS keystore by default; recovered via passphrase /
  WebAuthn PRF.
- **WebAuthn PRF support** varies by authenticator/browser — passphrase is the fallback.
- **Model bundling** (translation) is heavier in an extension — lazy-load / companion.

## Rollout & migration
- **Phase 1 (done):** vault crypto (tested) + MV3 scaffold (background, popup, page autofill).
- **Phase 2:** passkey enrolment UI; native-messaging companion bridge.
- **Phase 3:** reuse OCR/PDF/Office engines; store/enterprise packaging + reproducible builds.

## Open questions
- Default distribution: public store vs. self-hosted/enterprise for high-assurance users?
- Companion required for signing, or allow standalone WebAuthn signing?
- Argon2id (via WASM) instead of PBKDF2 for the passphrase KDF?

> When accepted, record the outcome as an ADR and link it here. → **ADR-0014**.
