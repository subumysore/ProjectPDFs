# SDD Project Starter

A **stack-agnostic starter** that carries forward a proven way of working: **Specification-Driven
Development (SDD)**, a **Memory Bank** for durable context, **requirements traceability**, and decision
records — plus the additional best practices below. Drop your application code into it (any language /
framework) and keep the governance.

> Rename this folder to your project, then work through `docs/START_HERE.md`.

## The loop (SDD)

```
INTENT → SPECIFICATION → TEST DESIGN → IMPLEMENTATION → VALIDATION → CLOSURE
   │          │              │              │              │           │
 scope,   behavioral     write tests   production     re-verify   Memory Bank +
 edge     spec + data    BEFORE code    code to        vs spec     traceability +
 cases    contracts      (BDD/unit)     pass tests                 changelog + ADR
```

Nothing is "done" at *code-complete* — it is done when the spec, tests, docs, traceability, and Memory
Bank all agree (see `DEFINITION_OF_DONE.md`).

## What's in here

| Area | Where | Purpose |
|---|---|---|
| Operating rules | `CLAUDE.md` | The canonical rules every task follows (human + AI agents) |
| Memory Bank | `memory-bank/` | Durable project context — read before large changes |
| Requirements | `docs/requirements/` | Canonical BRD (`REQ-NN.M`), acceptance criteria |
| Specs | `docs/specs/`, `features/` | Behavioral specs + executable BDD `.feature` files |
| Architecture | `docs/reference/`, C4 | Context → Container → Component views |
| Decisions | `docs/adr/`, `docs/rfc/` | RFC (propose) → ADR (record) |
| Security | `docs/security/` | STRIDE threat models, data classification |
| Runbooks | `docs/runbooks/` | Operational procedures |
| Gates | `DEFINITION_OF_READY.md`, `DEFINITION_OF_DONE.md` | Entry + exit criteria |
| Automation | `scripts/`, `.github/workflows/` | Traceability check, ADR scaffolder, CI gates |
| Agent commands | `.claude/commands/` | `/sdd`, `/pre-task-audit`, `/adr`, `/spec`, `/shutdown` |

## Quick start

1. `docs/START_HERE.md` — orientation
2. Fill in `memory-bank/projectBrief.md` and `docs/requirements/BUSINESS_REQUIREMENTS_DOCUMENT.md`
3. For each feature: `/pre-task-audit` → `/spec` → write tests → implement → `/shutdown`
4. `node scripts/check-traceability.mjs` before declaring anything done
