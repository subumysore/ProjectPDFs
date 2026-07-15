# Definition of Done (DoD)

"Code complete" is NOT "done." A change is done only when ALL of these hold (or Prod-Ready is honestly
set to ⚠️/🟠 with the reason recorded).

## Code & tests
- [ ] Implements the spec; re-verified against acceptance criteria.
- [ ] Unit + integration tests pass; **acceptance spec** (`features/*.feature`) added/updated for
      new/changed behavior.
- [ ] Coverage meets the project bar; no reduction in coverage.
- [ ] Lint + typecheck clean.

## Docs & decisions
- [ ] BRD requirement updated (statement, acceptance criteria, "Solution Implemented", status marker).
- [ ] Architecture / API / data docs updated where impacted.
- [ ] Non-trivial decisions recorded as ADRs; decision log updated.

## Data
- [ ] Migrations are idempotent + additive/reversible and apply to a fresh DB.
- [ ] Seed/demo data updated so the feature is demoable.

## Traceability & memory
- [ ] Traceability matrix row updated (Status / Impl / Tests / Cov% / Prod-Ready) + rollup.
- [ ] `node scripts/check-traceability.mjs` passes.
- [ ] Memory Bank synced (`activeContext.md`, `progress.md`, patterns/decisions).

## Release hygiene
- [ ] `CHANGELOG.md` entry added.
- [ ] No secrets committed; CI green.
