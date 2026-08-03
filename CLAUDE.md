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

# 4b. PARALLELISM RULE (do independent work concurrently)
Whenever tasks are INDEPENDENT (no output of one is an input to another), execute them in PARALLEL, not
one-after-another — it is faster and the default expectation here:
- Batch independent tool calls into a single step (multiple searches/reads/edits at once; independent
  builds/tests kicked off together; background long-runs while you continue other work).
- Only serialize when there is a real data dependency (B needs A's result) or a shared-resource conflict
  (e.g. two builds writing the same target, or editing the same file). When unsure whether they conflict,
  say so and serialize just those.
- Applies to code changes too: land related independent edits together and verify in one pass rather than
  a slow edit→build→edit→build loop.

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

# 8b. DUAL-SURFACE TESTING RULE (Desktop **and** Extension — non-negotiable)
No change is "tested" until it is verified on **BOTH** surfaces it can affect: the **Desktop app (EXE)**
and the **Chrome Extension**. They share one engine (`@engine`) and must stay in lockstep, so:
- Any change to shared logic (resolver, proximity, OCR/parse, PDF fill, i18n, optmatch, fonts, …) MUST be
  tested against the Desktop app AND the Extension before being called done — not one, then "assume" the other.
- **Test the real integration, not just the pure function.** A Node/unit pass proves the algorithm; it does
  NOT prove the surface. Verify the actual runtime path (webview for the EXE, content-script/page for the
  Extension) — the bug that bit us (encrypted-PDF load throwing only in the app) never showed up in Node.
- Prefer **automated** verification (headless/driven UI) and capture the result; never hand the owner a
  "please test this" when it can be automated. Document what was tested on each surface and the outcome.
- Keep the two **in sync**: if a fix lands on one surface, port + test it on the other in the SAME task, or
  explicitly flag the parity gap in the deliverables matrix.

# 9. QUALITY GATES (CI must pass)
lint · typecheck · unit + integration tests · acceptance specs · traceability check · migration-safety ·
secret scan · dependency/license policy. See `.github/workflows/ci.yml`.

# 10. RELEASE, PUBLISHING & COMMUNICATION (do these unprompted — never make the owner remind you)
- **TURNKEY RELEASES.** Before reporting a Desktop-app or Extension change "done", ensure EVERY piece
  of plumbing to ship it exists and runs immediately — version bump, build, hashes, infra upload, docs,
  and the download/store links. No inventing steps at release time. Canonical chain:
  `scripts/set-version.mjs` → `pnpm tauri build` → stage installer to
  `docs/marketing/site/download/PolyglotFormFill-Setup.exe` → `scripts/release-manifest.mjs` →
  `deploy/k8s/publish-site.ps1 -WithBinaries` (desktop); `deploy/publish-extension.ps1` →
  `deploy/publish-webstore.ps1` (extension). Keep a runbook current; prefer a single orchestrator.
- **KEEP THE EXTENSION CURRENT.** Any change under `apps/extension/**` — INCLUDING the shared `@engine`
  files it bundles (resolver, optmatch, i18n, …) — means the published Chrome Web Store copy must not
  lag the code: bump the version and republish. Flag it in the deliverables matrix (below).
- **CHECK REVIEW STATE BEFORE TOUCHING THE STORE (learned the hard way).** The Chrome Web Store LOCKS an
  item's listing read-only while a submitted version is *Pending review* — you can neither edit the
  listing (promo video, screenshots, description) NOR upload a new version until that version
  **publishes or fails**. So BEFORE attempting any listing edit or `publish-extension.ps1`, verify the
  item is not pending: `GET https://www.googleapis.com/chromewebstore/v1.1/items/<id>?projection=DRAFT`
  (WEBSTORE creds). If it's in review, DO NOT try to edit — wait for publish/fail, and tell the owner.
  Because of frequent updates this queue matters: batch changes, don't resubmit while one is pending.
- **DELIVERABLES MATRIX ON EVERY SUBSTANTIVE CHANGE.** Close such work with a matrix, not prose: each
  deliverable, ✅ for done, and a clear flag for what needs the OWNER's attention and why it can't be
  automated (🔧 = I can run it, needs their go because it's outward-facing; 🙋 = only they can do it).
- **VIDEO CHANGED → I (Claude) PERFORM the whole pipeline; the owner's ONLY step is the final review.**
  These are MY tasks, run without being asked:
  1. `node scripts/build-guide.mjs` — rebuild video + captions.
  2. `.\deploy\k8s\publish-site.ps1 -WithGuide` — refresh the stable site copy (`…/download/guide.mp4`).
  3. `make guide-upload` — upload the new cut PUBLIC, auto-attach the captions, copy the watch URL to
     the clipboard (one-time YouTube OAuth done; public uploads verified working on this project).
  4. **Chrome Web Store promo field** (no API exists — UI only): I copy the `https://www.youtube.com/watch?v=<id>`
     (NEVER `youtu.be/…`, which the field rejects) to the clipboard, open the listing editor, and DRIVE
     the paste into the Global promo-video field and **Save draft**. I STOP before "Submit for review"
     and hand the owner a one-click review — because submitting a live public listing is theirs to
     approve. If the store SPA can't be driven reliably, I fall back to clipboard+open+prompt, but I
     never make the owner hunt for the field or the URL.
  Never let a video change pass without completing 1-4 and prompting for the final Submit.
- **STABLE LINKS.** Owner-controlled destinations (website, docs, emails) must point at the permanent
  self-hosted URLs (`…/download/{PolyglotFormFill-Setup.exe,guide.mp4,…}`), which keep the same address
  across rebuilds — never at a URL that churns per build (e.g. a fresh YouTube upload).
- **NOTHING OUTWARD-FACING WITHOUT A GREEN LIGHT** unless durably authorized (a standing rule here or an
  explicit "publish"/"release"). Building the plumbing is always fine; pulling the trigger needs the go.

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
