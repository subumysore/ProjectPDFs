# Tech Context

_The stack, tooling, and environment. Keep versions pinned and current._

## Stack
| Layer | Choice | Version | Notes |
|---|---|---|---|
| Language | TODO | TODO | |
| Framework(s) | TODO | TODO | |
| Package manager | TODO | TODO | |
| Database / ORM | TODO | TODO | |
| API contract | OpenAPI / AsyncAPI | TODO | source of truth in `docs/reference/` |
| CI/CD | TODO | | see `.github/workflows/` |
| Hosting / infra | TODO | | |

## Local development
```
TODO install      # install deps
TODO dev          # run locally
TODO test         # run tests
TODO migrate      # apply migrations
```

## Environments
| Env | URL | Purpose | Deploy trigger |
|---|---|---|---|
| dev | TODO | integration | TODO |
| prod | TODO | live | TODO |

## Tooling conventions
- Lint/format: TODO. Typecheck: TODO. Pre-commit hooks: traceability, migration-safety, secret-scan.
- Dependency hygiene: Renovate/Dependabot; SBOM on release; license policy (allowed licenses: TODO).
