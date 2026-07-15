# /spec

Produce the behavioral specification (SDD step 2) before tests and code.

1. Copy `docs/specs/TEMPLATE.spec.md` to `docs/specs/REQ-NN.M-<slug>.spec.md`.
2. Fill: intent, scope/non-goals, data contracts (reference the API schema, don't duplicate),
   behavior as GIVEN/WHEN/THEN, boundaries/dependencies, observability, and a test plan.
3. If the change is large/risky, write an RFC first (`docs/rfc/0000-template.md`) and link it.
4. Turn the GIVEN/WHEN/THEN rules into `features/<slug>.feature` scenarios (these become tests).
5. Confirm every acceptance criterion in the BRD maps to at least one scenario/test.

Do not implement yet — the spec + failing tests come first.
