# /sdd

Run the full Specification-Driven Development loop for the current task.

1. **INTENT** — `/pre-task-audit`: context loaded, `REQ-NN.M` identified, Ready confirmed.
2. **SPECIFICATION** — `/spec`: behavioral spec + data contracts (+ RFC if large).
3. **TEST DESIGN** — write failing tests FIRST: unit + integration + `features/*.feature`.
4. **IMPLEMENTATION** — clean production code to make the tests pass; re-verify vs the spec.
5. **VALIDATION & CLOSURE** — `/shutdown`: full test matrix, docs, traceability, memory, changelog.

Never skip step 3. "Code complete" is not "done" until `/shutdown` passes.
