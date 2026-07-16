# ADR-0003: Cross-person data sharing = user-directed E2E-encrypted export/import only

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Team
- **Related:** RFC-0001, ADR-0006 (signing-request bundle)

## Context
Family/institution use needs a person's data to move between devices, but the privacy invariant
forbids user content reaching our servers — "not even ciphertext" (user ruling 2026-07-15).

## Options considered
1. **User-directed E2E-encrypted export/import bundle** (`.pdfxfer`) — no server ever touches data.
2. Direct device-to-device P2P sync (no server) — allowed later, not required for V1.
3. Zero-knowledge encrypted relay — **rejected** (user's encrypted data still transits our servers).

## Decision
Cross-person/cross-device movement uses **only** a user-directed **E2E-encrypted bundle** sealed to
the recipient's public key, transferred by any means the user chooses. **No server, no relay, ever.**

## Consequences
- Positive: invariant stays absolute; simple trust model.
- Negative: less convenient than a relay (manual transfer); key exchange/bundle format to spec.
