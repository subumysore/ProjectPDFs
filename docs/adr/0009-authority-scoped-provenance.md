# ADR-0009: Authority-scoped verifiable provenance (no vendor backdoor)

- **Status:** Accepted (principle) — details pending
- **Date:** 2026-07-16
- **Deciders:** Team
- **Related:** RFC-0001, ADR-0010

## Context
A governing authority needs document traceability. A vendor-decryptable, IP-logging, hidden QR was
**requested and rejected** — it is a surveillance backdoor and breaks the privacy invariant.

## Options considered
1. **Public verifiable provenance** — signed manifest, anyone verifies, no secrets.
2. **Authority-scoped** — sensitive block encrypted to a **named authority's** key (chosen).
3. Vendor-decryptable / IP-logging / covert beacon — **rejected** (backdoor + surveillance + covert).

## Decision
Embed a **disclosed, signed ProvenanceManifest** (doc hash, signer identities + roles, attestations,
trusted timestamps) as metadata + a **printable QR**. Public part is verifiable by anyone; a
**sensitive block is encrypted to a NAMED governing authority's public key** — **we never hold that
key**. Timestamping sends only a **one-way hash**. **No vendor key, no IP surveillance, no covert
beacon.** Reinforces the **no-vendor-backdoor** rule in the privacy invariant.

## Consequences
- Positive: authority-grade, independently verifiable traceability with zero vendor access.
- Negative: authority key distribution/registry + disclosure/consent UX to spec (see ADR-0010).
