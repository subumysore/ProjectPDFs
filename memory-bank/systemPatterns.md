# System Patterns

_Established architectural and code patterns. New code should look like the patterns here. Add a pattern
only once it is used in ≥2 places; record the decision that introduced it as an ADR._

## Architecture style
TODO — e.g. modular monolith, layered, hexagonal, microservices. Link the C4 diagrams in
`docs/reference/architecture.md`.

## Cross-cutting patterns
- **Error handling:** TODO (one shared helper; never swallow errors silently)
- **AuthN / AuthZ:** TODO (how identity and roles flow; where enforced)
- **Auditing:** TODO (which actions are audited and how)
- **Data access:** TODO (single connection/repository pattern; no ad-hoc queries)
- **Validation:** TODO (schema-first; where inputs are validated)
- **Config & secrets:** TODO (how config is loaded; secrets never in code)
- **Idempotency & migrations:** TODO (additive/reversible; how applied)

## Testing patterns
- Test pyramid: many unit, fewer integration, few end-to-end/acceptance.
- Acceptance = executable specs in `features/` (BDD). Contract tests against the API schema.

## Observability
- SLIs/SLOs defined per service in the spec. Structured logs, health endpoints, traces. TODO specifics.

## Anti-patterns (do NOT do)
- TODO — record traps discovered the hard way so they are never repeated.
