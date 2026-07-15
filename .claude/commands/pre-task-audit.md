# /pre-task-audit

Establish context BEFORE starting any task. Do not write code until this is complete.

1. Read the Memory Bank core set:
   - `memory-bank/projectBrief.md`, `systemPatterns.md`, `techContext.md`, `activeContext.md`,
     `requirements-traceability-matrix.md`.
2. Locate the relevant `REQ-NN.M` in `docs/requirements/BUSINESS_REQUIREMENTS_DOCUMENT.md`.
   If none exists, propose one before proceeding.
3. Check `DEFINITION_OF_READY.md` — is this task actually Ready? If not, close the gaps first
   (spec, acceptance criteria, edge cases, deps).
4. Summarize: scope, non-goals, affected components, test plan, and any risks.
5. Only then proceed to `/spec` (or straight to test design for trivial changes).

Output a short audit summary; do not begin implementation in this step.
