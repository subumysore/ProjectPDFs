# ADR-0008: Multi-party document workflow

- **Status:** Accepted (principle) — details pending
- **Date:** 2026-07-16
- **Deciders:** Team
- **Related:** RFC-0001, ADR-0003, ADR-0004, ADR-0006

## Context
Some documents are assembled from several parties (Seller/Buyer, Plaintiff/Defendant, +witnesses),
each contributing their own data and their own signature, coordinated by an admin.

## Decision
Add a **Multi-Party Document** process (`core-txn`): roles with cardinality **1..\***; each party's
data arrives via **consented E2E-encrypted share** scoped to this document + named counterparties;
assemble one document (autofill each role from that party's vault); collect **one non-delegable
signature per party** (parallel or sequential); execute + distribute encrypted copies. **No server
holds joint content.** State machine: draft → gathering → assembled → circulating → partially-signed
→ fully-executed | withdrawn. **Editing after any signature invalidates prior signatures** → re-sign.

## Consequences
- Positive: supports real transactional/legal documents privately.
- Negative: cross-party visibility must be consented; orchestration + state complexity; re-sign flow.
