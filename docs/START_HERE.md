# Start Here

Orientation for anyone (human or agent) joining this project.

## 1. Read the Memory Bank (in order)
1. `memory-bank/projectBrief.md`
2. `memory-bank/productContext.md`
3. `memory-bank/systemPatterns.md`
4. `memory-bank/techContext.md`
5. `memory-bank/activeContext.md`
6. `memory-bank/requirements-traceability-matrix.md`

## 2. Understand the rules
- `CLAUDE.md` — the operating rules for every task.
- `DEFINITION_OF_READY.md` / `DEFINITION_OF_DONE.md` — the gates.

## 3. The workflow for a feature
```
/pre-task-audit        # load context, confirm Ready
  → write/update the BRD requirement (REQ-NN.M)
  → /spec              # behavioral spec + data contracts
  → write tests first  # unit + integration + features/*.feature
  → implement          # make tests pass
  → /shutdown          # DoD closure: docs, traceability, memory, changelog
node scripts/check-traceability.mjs
```

## 4. Decisions
- Propose a big change: `docs/rfc/` (copy `0000-template.md`).
- Record a made decision: `/adr` or copy `docs/adr/0000-template.md`.

## 5. First-time setup checklist
- [ ] Rename the project; fill the `TODO`s in `CLAUDE.md` and `memory-bank/projectBrief.md`.
- [ ] Choose your stack; fill `memory-bank/techContext.md`.
- [ ] Set up CI from `.github/workflows/ci.yml` (wire real lint/test commands).
- [ ] Add your first real `REQ-NN.M` to the BRD and the matrix.
