# /adr

Record an architecture decision.

1. Run `node scripts/new-adr.mjs "<short title>"` (scaffolds the next-numbered ADR from the template),
   or copy `docs/adr/0000-template.md` manually.
2. Fill context, options considered, decision, and consequences. Be explicit about the trade-off accepted.
3. Set Status (Proposed → Accepted). ADRs are immutable once Accepted — supersede, don't edit.
4. Add a one-line entry to `memory-bank/decisionLog.md` linking the ADR.
5. If this decision came from an RFC, link the RFC and set the RFC to Accepted.
