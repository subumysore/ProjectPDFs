# PolyglotFormFill — CLAUDE.md

## Project Operating Rules (canonical — apply to every task)

These rules govern all work in this repo, for humans and AI agents alike. Where any two rules conflict,
follow the **stricter**. Replace the `TODO` placeholders with your project's specifics.

---

# 1. CORE GOVERNANCE (the "No-Go" zones)
- **NO SILENT DELETIONS:** never delete or rename files/folders without explicit confirmation.
- **ARCHITECTURE IS INTENTIONAL:** structural boundaries are defined in `docs/reference/architecture.md`;
  do not create competing structures. Changing a boundary requires an RFC → ADR.
- **SINGLE SOURCE OF TRUTH:** each concept has ONE authoritative home (schema, config, API contract).
  Duplicating it is forbidden.
- **SECURITY & DATA:** follow `docs/security/data-classification.md`. Secrets never in code or git.
- **PRIVACY INVARIANT (non-negotiable, overrides everything):** *We do not SEE, STORE, or SEND user
  content to ANY location the user did not intend. User content leaves the device ONLY to the exact
  destination the user explicitly chose (e.g. the recipient of a form they submit) — never to us, never
  to a third party, never to any unintended location.* Concretely:
  - **Every operation that touches user values runs ON-DEVICE** (OCR, translation, AI field-naming,
    tagging, embeddings/search, font subsetting, PDF fill/export). No cloud AI on user content — ever.
  - **Servers may only serve assets DOWNWARD** (fonts, models, app updates) and must NEVER receive
    user content. Inbound downloads are fine; outbound user data is forbidden.
  - **Permitted user-directed egress (user-initiated, device→recipient DIRECTLY, never proxied or
    stored by us, explicitly labelled):**
    1. **"Submit online" (#7)** — sends the filled form to the intended recipient.
    2. **Web search to locate a form (ADR-0013)** — sends ONLY the user's typed search query to a
       privacy-respecting engine (DuckDuckGo) directly; never form content, vault data, or identifiers.
    No other user-data egress is permitted. Both are opt-in and prominently labelled; everything else
    (OCR, translation, fill, etc.) stays on-device.
  - **No content telemetry/analytics/crash payloads.** PDFs are rendered with scripting disabled and
    external-resource loading blocked (anti-exfiltration).
  - **The test for any new work:** "could this let us — or any unintended party — SEE, STORE, or RECEIVE
    user content, or send it anywhere the user did not explicitly choose?" If yes → not allowed, redesign
    on-device. The only sanctioned egress is user-initiated, device→user-chosen-destination, direct.
- **STATUS LIVES IN ONE PLACE:** requirement status lives ONLY in
  `memory-bank/requirements-traceability-matrix.md`.

# 2. SPECIFICATION-DRIVEN DEVELOPMENT (SDD) PROTOCOL
Do not jump to code or debug "on vibes." Every task follows this loop:
1. **INTENT & ALIGNMENT** — explicit scope, edge cases, data structures, non-goals. Ask when ambiguous.
2. **SPECIFICATION** — draft/update the behavioral spec (`docs/specs/`): data contracts, component APIs,
   boundaries. Bigger/riskier changes get an **RFC** first (`docs/rfc/`).
3. **TEST DESIGN** — write/outline tests BEFORE finalizing code: unit, integration, and **executable
   acceptance specs** (`features/*.feature`). The spec must be testable.
4. **IMPLEMENTATION** — write clean production code to pass the tests; re-verify against the spec.
5. **VALIDATION & CLOSURE** — run the full test matrix; complete the Definition of Done.

# 3. DEFINITION OF READY / DONE (gates)
- Do not START work that fails `DEFINITION_OF_READY.md`.
- Do not CALL work done until it passes `DEFINITION_OF_DONE.md`. "Code complete" is NOT "done."

# 4. ANTI-LOOP & WORKFLOW PROTOCOL
- **PRE-TASK AUDIT:** before ANY task, read the Memory Bank core set (§6) to establish context.
- **TARGETED FIXES:** analyze only the first few errors of a failed build; do not audit the whole repo.
- **ENVIRONMENT FIRST:** for "module not found" and similar, verify config/deps before editing code.
- **PROGRESS LOG:** after a module, update the traceability matrix + `memory-bank/progress.md`.

# 5. DECISIONS: RFC → ADR
- Propose a non-trivial change as an **RFC** (`docs/rfc/`, use `0000-template.md`).
- Once decided, record the outcome as an **ADR** (`docs/adr/`, MADR template). ADRs are immutable;
  supersede rather than edit.

# 6. MEMORY BANK (read before large changes)
1. `memory-bank/projectBrief.md` — product & vision
2. `memory-bank/systemPatterns.md` — architecture & established patterns
3. `memory-bank/techContext.md` — stack, tooling, constraints
4. `memory-bank/activeContext.md` — what's in flight right now
5. `memory-bank/requirements-traceability-matrix.md` — per-requirement status
Keep these accurate to the living state — they are the project's durable memory.

# 7. TASK-END CLOSURE ROUTINE ("done" ≠ "code complete")
On completing any task, BEFORE reporting done:
- **Memory Bank sync** — `activeContext.md`, `progress.md`, and any pattern/decision docs.
- **Docs** — update architecture/API/data docs where impacted; record decisions as ADRs.
- **Requirements** — update the BRD requirement (statement, acceptance criteria, "Solution Implemented").
- **Migrations & seeds** — idempotent, reversible-or-additive; demoable seed data updated.
- **Tests** — unit + integration always; acceptance (`.feature`) for new/changed behavior.
- **Traceability** — update the matrix row (Status / Impl / Tests / Coverage / Ready) and run
  `node scripts/check-traceability.mjs`.
- **Changelog** — add an entry (`CHANGELOG.md`, Keep-a-Changelog + SemVer).

# 8. VERSIONING & GIT
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, …).
- **SemVer** for releases; freeze/release via an annotated tag + a changelog entry + (optionally) a
  GitHub Release. A release tag MUST correspond to a reproducible build/commit.
- Branch strategy: TODO (trunk-based recommended). Never commit secrets; never force-push shared branches.

# 9. QUALITY GATES (CI must pass)
lint · typecheck · unit + integration tests · acceptance specs · traceability check · migration-safety ·
secret scan · dependency/license policy. See `.github/workflows/ci.yml`.

---

## What this project is
TODO — one paragraph: the product, its users, the core domain.

## Tech & environment constraints
TODO — languages, frameworks (and pinned versions), package manager, DB/ORM, how to run locally, how to
test. Prefer this section over any placeholder paths elsewhere.

## Requirements change protocol (mandatory)
When any requirement is introduced/modified/extended, produce ALL of these in the SAME task before
reporting done: (1) canonical `REQ-NN.M` in the BRD, (2) business docs, (3) technical/design docs + ADR,
(4) Memory Bank updates, (5) migrations, (6) seed/demo data, (7) unit + integration + acceptance tests,
(8) traceability row + rollup, (9) doc indexing if you have a docs search, (10) mark done only when
(1)–(9) hold or Ready is honestly set to ⚠️ with the reason.
