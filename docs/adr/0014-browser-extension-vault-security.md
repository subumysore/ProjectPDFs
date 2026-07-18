# ADR-0014: Browser-extension vault security (passphrase / WebAuthn) + companion trust anchor

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** PolyglotFormFill team (explicit user request)
- **Related:** RFC-0004, ADR-0002 (native-over-web), REQ-16.1, REQ-01.1, REQ-09.1.

## Context
We are adding a **browser-extension** client. A browser gives an extension no OS keystore,
and a store-served extension **auto-updates code** — the served-code trust gap that
ADR-0002 avoided by choosing native. We must protect the vault key at rest and shrink the
update-trust gap without abandoning the extension form factor the user asked for.

## Options considered
1. **Key derived on unlock, never stored (chosen).** Passphrase → PBKDF2 → AES-GCM, or
   WebAuthn PRF (hardware-backed) → HKDF → AES-GCM. Key + plaintext only in
   service-worker memory. Storage holds salt + ciphertext.
2. **Key stored in `chrome.storage` beside the data.** Rejected — anything with profile/
   filesystem access can read both; defeats encryption-at-rest.
3. **No encryption, rely on the OS user account.** Rejected — the vault is sensitive PII.

For the served-code gap:
- **Companion mode** (native app = trust anchor; extension = thin autofill client) —
  keeps keys/vault/signing out of store-served code entirely. Recommended.
- **WebAuthn-PRF unlock** — a malicious update can't decrypt without the hardware passkey.
- Reproducible builds + published hashes; self-hosted/enterprise distribution; no egress
  surface.

## Decision
Adopt **Option 1** for key-at-rest, with **both** passphrase (PBKDF2, fallback) and
**WebAuthn-PRF** (hardware-backed, preferred) unlock. Recommend the **companion
architecture** as the primary secure topology (native app holds the sensitive material),
while supporting a **secure standalone mode** whose residual served-code trust trade-off
is documented and mitigated (WebAuthn PRF, reproducible builds, self-hosted distribution).
The privacy invariant is unchanged: no user content leaves the device; the vault is
encrypted with a key that is never stored.

## Consequences
- **Positive:** on-device encrypted vault in a browser with hardware-backed unlock;
  web-form autofill gains the extension's native ergonomics; MV3's no-remote-code + strict
  CSP align with our execution-only model.
- **Negative / cost:** key protection is weaker than the native OS keystore unless the
  user uses a passkey; the store auto-update gap is shrunk, not eliminated (companion mode
  removes it for sensitive material); WebAuthn PRF support varies (passphrase fallback).
- **Follow-ups:** passkey enrolment UI; native-messaging companion bridge; consider
  Argon2id KDF; reproducible-build + hash publication pipeline.

> ADRs are immutable once Accepted. To change a decision, write a new ADR that supersedes this one.
