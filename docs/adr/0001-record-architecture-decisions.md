# ADR-0001: Record architecture decisions using ADRs

- **Status:** Accepted
- **Date:** YYYY-MM-DD
- **Deciders:** Team
- **Related:** —

## Context
We need a durable, low-ceremony record of significant technical decisions and the reasoning behind them,
so future contributors (and agents) understand *why* the system is the way it is — not just *what* it is.

## Options considered
1. **ADRs (Markdown, in-repo, numbered)** — versioned with the code, diffable, close to the work.
2. **Wiki / external doc** — easy to edit, but drifts from the code and lacks review.
3. **No formal record** — fastest now, expensive later (decisions re-litigated, context lost).

## Decision
Use **Architecture Decision Records** (MADR-style) in `docs/adr/`, numbered sequentially, immutable once
Accepted, superseded rather than edited. Bigger decisions are proposed first as an **RFC** (`docs/rfc/`)
and then recorded as an ADR. A one-line index is kept in `memory-bank/decisionLog.md`.

## Consequences
- Positive: durable rationale; onboarding and agent context improve; decisions get reviewed.
- Negative: minor overhead per decision.
- Follow-ups: use `/adr` or `scripts/new-adr.mjs` to scaffold new records.
