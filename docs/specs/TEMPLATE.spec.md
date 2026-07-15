# Spec: <feature> (REQ-NN.M)

_The behavioral specification — written in SDD step 2, before tests and code. One spec per feature/epic._

## Intent
What this does and why. Link the BRD requirement(s).

## Scope & non-goals
- In scope:
- Non-goals:

## Data contracts
Inputs, outputs, and the shapes involved (schemas / types / DB tables). Reference the API contract
(OpenAPI/AsyncAPI) rather than duplicating it.

```
# example request/response or type
```

## Behavior
Enumerate the rules precisely. Prefer GIVEN/WHEN/THEN — these become `features/*.feature` scenarios.
- GIVEN … WHEN … THEN …
- Edge cases:
- Error handling:

## Boundaries & dependencies
Which components/services are touched; what must NOT change.

## Observability
SLIs/SLOs, logs, metrics, health signals this feature adds.

## Test plan
- Unit:
- Integration:
- Acceptance (`features/…feature`):

## Open questions
-
