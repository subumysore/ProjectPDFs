# ADR-0004: Non-delegable SSO/federated signing

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Team
- **Related:** RFC-0001, ADR-0006, ADR-0007

## Context
Signatures must be authentic and un-delegable. On-behalf-of (admin) may fill, but must never sign
for someone else.

## Options considered
1. **SSO/passkey (WebAuthn/OIDC), signature by the signer's own authenticator** — non-delegable by key.
2. Delegable local key / offline self-signed — **rejected** (allows signing on behalf).

## Decision
The signer **authenticates themselves** (OIDC / passkey / eID) and signs on **their own
authenticator**. **Nobody signs on behalf of another** — on-behalf-of covers fill/translate/save/
submit/share, never sign. Only identity assertions cross to the IdP; never form content.

## Consequences
- Positive: strong non-repudiation; enforced by cryptography, not policy.
- Negative: signing needs network at sign time; no offline delegable fallback (by design).
