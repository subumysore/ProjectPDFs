# ADR-0006: Signing-request/response bundle (signing hand-off)

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Team
- **Related:** RFC-0001, ADR-0003, ADR-0004

## Context
A signee must **review** a form (WYSIWYS) and sign it themselves, even when it was prepared
on-behalf — without any server holding content.

## Options considered
1. **Same-device ceremony** (signee authenticates with their own phone via cross-device WebAuthn).
2. **Routed E2E-encrypted signing request** to the signee's device; they review, sign, return sealed.
3. Server-mediated signing — **rejected** (content path).

## Decision
Support both (1) and (2). The signing request is a **distinct bundle type** from ADR-0003 sharing —
it carries a **review+sign+return intent, preparer provenance, and the bound canonical document
hash**. Signee reviews the exact rendered document, approves/rejects, and signs on their own key.

## Consequences
- Positive: preserves non-delegable signing + WYSIWYS with no server.
- Negative: distinct bundle format + consent/authorization + revocation to spec.
