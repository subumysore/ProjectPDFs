# /shutdown

Task-end closure. Run BEFORE reporting any task done. Work through `DEFINITION_OF_DONE.md`:

1. **Tests** — unit + integration + acceptance (`features/`) pass; coverage holds; lint + typecheck clean.
2. **Docs** — BRD requirement updated (statement, acceptance, "Solution Implemented"); architecture/API/
   data docs updated; ADRs for non-trivial decisions; `decisionLog.md` updated.
3. **Data** — migrations idempotent + apply to a fresh DB; seed/demo data updated.
4. **Traceability** — update the matrix row + rollup; run `node scripts/check-traceability.mjs`.
5. **Memory Bank** — sync `activeContext.md` and `progress.md`; add patterns learned.
6. **Changelog** — add a `CHANGELOG.md` entry.
7. Report honestly: what's verified, what's deferred (⚠️/🟠 with reason), what tests actually ran.
