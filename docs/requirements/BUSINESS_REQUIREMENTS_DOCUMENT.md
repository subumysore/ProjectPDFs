# Business Requirements Document (BRD)

The **canonical** requirements. Every requirement has a stable id `REQ-NN.M` (or `REQ-NN-UI.M` for UI).
Never invent ad-hoc ids. Status lives in the traceability matrix, not here — here we keep the statement,
acceptance criteria, and "Solution Implemented" notes.

---

## REQ-00 — Requirement group name

### REQ-00.1 — Short requirement title
**Statement.** As a `<persona>`, I want `<capability>` so that `<benefit>`.

**Acceptance criteria** (each must be testable — map to a check in `features/` or a test):
- [ ] GIVEN `<context>` WHEN `<action>` THEN `<observable outcome>`.
- [ ] Edge case: `<...>` is handled by `<...>`.
- [ ] Error path: `<...>` returns `<...>`.

**Non-goals.** What this requirement explicitly does NOT cover.

**Security/privacy.** Data touched + classification (see `docs/security/data-classification.md`).

**Solution Implemented.** _(fill on completion)_ — approach, key files, endpoints/models.

**Status marker.** ☐ / 🟡 / ✅  (authoritative status is in the traceability matrix)

---

<!-- Copy the REQ-00.1 block for each new requirement. Keep ids stable and sequential per group. -->
