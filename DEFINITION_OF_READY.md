# Definition of Ready (DoR)

Work MUST NOT start until ALL of these hold. This prevents starting under-specified work.

- [ ] A canonical requirement id exists (`REQ-NN.M`) in the BRD.
- [ ] The problem and **non-goals** are written down.
- [ ] Acceptance criteria are explicit and **testable** (each maps to a check).
- [ ] Edge cases and error paths are enumerated.
- [ ] Data contracts / API shapes are drafted (or the change is trivial and noted as such).
- [ ] Dependencies and affected components are identified.
- [ ] Security/privacy impact considered (data classification; needs a threat model? y/n).
- [ ] For non-trivial or risky changes: an **RFC** exists and is at least in review.
- [ ] Rough test plan (which unit / integration / acceptance tests will prove it).
