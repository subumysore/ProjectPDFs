# ADR-0015: Offline, signed licensing (no activation server)

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** ProjectPDFs team
- **Related:** REQ-17.1; privacy invariant (CLAUDE.md); ADR-0002.

## Context
We want to monetize (freemium: Free / Pro / Team) without breaking the privacy invariant.
A conventional license server "phones home" to activate/validate — that would introduce a
network call tied to the user and contradict "nothing leaves your device."

## Options considered
1. **Offline signed license token (chosen).** The vendor signs a small license (tier, features,
   expiry) with an Ed25519 private key; the app embeds only the vendor **public** key and
   verifies the token **on-device**. No activation server, no phone-home.
2. **Online activation / periodic validation server.** Rejected — network calls tied to the
   user; violates the invariant and adds infrastructure + an outage surface.
3. **No licensing (donation/honor).** Rejected — no durable revenue for Pro/Team.

## Decision
Adopt **Option 1** (`core-license`): tokens are `PPDF1.<base64(json)>.<base64(sig)>`, verified
locally against the embedded vendor public key; expiry (0 = perpetual) checked against local
time; features gated by flags. The private key stays with the vendor and is never shipped. This
keeps paid features while sending nothing.

## Consequences
- **Positive:** monetization with zero telemetry; works fully offline; simple to distribute
  (a token the user pastes/imports); marketable as "paid but still zero-telemetry".
- **Negative / cost:** offline tokens can't be remotely revoked mid-term (mitigate with
  reasonable expiries + reissue); local clock can be rolled back (low value to attacker; bound
  by expiry windows); key management is the vendor's responsibility (protect the signing key,
  e.g. HSM).
- **Follow-ups:** wire a `verify_license` command + a Settings import UI; embed the real vendor
  public key at build; consider short-lived tokens with an optional (user-initiated) refresh.

> ADRs are immutable once Accepted. To change a decision, write a new ADR that supersedes this one.
