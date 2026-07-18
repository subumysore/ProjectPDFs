# Active Context

_What is in flight RIGHT NOW. Update at the start and end of every work session. Convert relative dates
to absolute._

## Current focus
- **BUILD-EVERYTHING pass complete (overnight, autonomous).** All 14 requirements in progress;
  full app loop plumbed + build/test-verified. Self-hosted OCR + English↔Hindi translation
  (execution-only CSP, zero third-party egress), OS keystore, device signing + provenance, PDF
  render/fill/export, save/versions/history, submit, web-form logic, OIDC broker (reused). 25 Rust
  tests + Node tests green, all builds green, traceability green. Ready for ONE full test pass:
  `node scripts/fetch-translation-assets.mjs` then `cd apps/app && pnpm tauri dev`.

## (earlier) Current focus
- **RFC-0001 ACCEPTED. Go-ahead executed (2026-07-16).** ADR-0002…0010 recorded; governance synced.
- **Toolchain INSTALLED + verified on this machine:** Rust 1.97 (MSVC) + Android targets, VS 2022
  C++ Build Tools, JDK 17, Node 24/pnpm 9, WebView2 150. cargo on User PATH. See
  `docs/reference/dev-setup.md`. **Desktop Tauri build path is ready.**
- **Rust workspace scaffolded + BUILDS:** root `Cargo.toml` + all 11 `crates/core-*` stubs;
  `cargo build` + `cargo test` green (smoke tests pass).
- **Old scaffold removed:** `apps/api` + `packages/db` deleted (authorized); root package.json + pnpm
  lockfile refreshed; traceability green.
- **Tauri v2 desktop app BUILDS (`apps/app`):** React/TS UI ↔ Rust core bridge (commands `greet`,
  `core_modules`) wired to core-store/crypto/catalog; `cargo build` → `target/debug/app.exe` (12.4MB);
  frontend builds; icons generated. Live window = `pnpm tauri dev` (needs desktop session, not run here).
- **Phase-1 vertical slice LANDED (catalog-first autofill):** `core-store` (SQLite vault + tests) +
  `core-catalog` (field-maps + autofill + tests) → app `demo_autofill` → UI table. `services/catalog`
  (Node stub, serving verified) + `packages/shared` types (typecheck). 14 pillars → REQ-01.1..14.1
  (traceability green). All green: cargo test 25 ok / 0 fail, frontend build, traceability.
- **Remaining:** SQLCipher encryption-at-rest + Profiles UI; `core-mt` translation + `core-ocr`
  fallback; `pnpm tauri dev` visual check; Android SDK/NDK (dev-setup.md); iOS on a Mac. Everything
  on `master`, uncommitted (user: no branching).
- **(prior) GO/NO-GO gate: passed with CONDITIONAL GO** (see `docs/feasibility/`). Worst-case trial run
  2026-07-15 empirically confirmed auto field-detection is unreliable on bad scans (esp. CJK OCR
  → 0/6 under moderate degradation), but the guaranteed floor (digital-text path + template
  memoization + human-in-the-loop, all on-device) holds, so the app is viable. Do NOT architect
  around zero-touch detection of arbitrary scans.
- **Architecture RFC drafted:** `docs/rfc/0001-architecture-and-stack.md`. FINAL direction (2026-07-16):
  **NATIVE cross-platform app** — Tauri v2 + React/TS UI + Rust core; all data + processing on-device;
  SQLite+SQLCipher + OS keystore. Web/PWA rejected (served-code trust). Validate Tauri v2 mobile
  bindings early.
- **Public Form Catalog added (user's idea, 2026-07-16):** a server of PUBLIC form knowledge only
  (metadata, tags, blank templates, curated **field-maps**, fingerprints), served DOWN. Catalogued
  forms **skip OCR/detection** (download the field-map) → this turns the feasibility risk into a
  strength; OCR/detection is now the FALLBACK. Catalog **search runs on-device** (index synced) so
  form-interest doesn't leak. Contributions are structure-only + consented. → ADR-0005.
- **OCR stays ON-DEVICE.** Server OCR was floated 2026-07-15, flagged as breaking the invariant
  (reads the uploaded doc → content up, incl. passports); ruling = on-device, better engine
  (ONNX/PaddleOCR), now only a fallback behind the catalog.
- **Web-form autofill added (#11, 2026-07-16):** in-app webview. Web-hosted downloadable file →
  native download (no CORS) → normal pipeline. Live HTML form → autofill DOM fields from vault
  locally (password-manager style), submit device→site. Catalog covers WebForm entries (URL + DOM
  selectors). Locked view-only docs → OCR/manual fallback only.
- **Signing is NON-DELEGABLE (2026-07-16):** the signer/signee must SSO-authenticate themselves
  (OIDC/passkey) and the signature is produced by **their own authenticator** — nobody signs on
  behalf of another. On-behalf-of (admin) covers fill/translate/save/submit/share but **NOT sign**;
  when a signature is needed the Signee signs on the same device (ceremony) or on their own device.
  Self-fillers are SSO'd from the start. No delegable offline-key fallback.
- **Signing hand-off (how the signee sees it):** signee ALWAYS reviews the full rendered form before
  signing (WYSIWYS). Delivery = same-device ceremony (signee auths with their own phone via
  cross-device WebAuthn) OR a consented E2E-encrypted **signing request** routed to the signee's
  device (reuses the sharing bundle); signee reviews/approves/rejects, signs, signed result sealed
  back. No server touches content. New sequence diagram added to the UML artifact.
- **Device-less signee → Tier-2 in-person signing (2026-07-16):** signee reviews on the operator's
  device, draws a signature + gives a live fingerprint/thumbprint, placed on the form; SSO'd operator
  cryptographically attests the capture (WitnessAttestation) over the doc hash. Non-delegable via
  live biometric + accountable witness, but LOWER assurance than Tier-1 passkey self-sign — label as
  such. Biometric = special-category, on-device only + encrypted + consented + legal review.
  Hardware: built-in sensors are auth-only (no image) → need external scanner SDK or inked-thumbprint
  photo. → ADR-0007. Sequence diagram s10 added.
- Cross-person sharing = user-directed E2E-encrypted export/import only (no relay). **RFC awaiting accept.**

## Locked decisions (binding — see CLAUDE.md §1 privacy invariant)
- **Privacy invariant is non-negotiable:** no user content goes UP; all AI on user values runs
  on-device; servers serve assets DOWN only; sole egress is user-initiated "Submit online" direct to
  recipient; no content telemetry; PDFs rendered with scripting/external resources blocked.
- **Fonts & models are on-device** (bundle default + lazy-cache per script/language; subset-embed
  into each PDF). Font/model hosting may be a stateless asset server. Encryption = at-rest only.
- **Accepted tradeoff:** language/script coverage + AI quality are bounded by on-device model+font
  availability — deliberate price of the invariant.
- `apps/api` to be **re-scoped from data store → stateless asset server**.

## Stack freedom (2026-07-15)
- User explicitly freed stack/architecture choice at ALL layers — **not obligated to keep the
  current scaffold** (Express `apps/api`, Drizzle/Postgres, pnpm workspace, folder structure).
  The RFC should pick the best local-first cross-platform stack from scratch (e.g. Tauri+Capacitor
  vs Flutter vs …), then we restructure the repo accordingly.

## Recent changes (most recent first)
- 2026-07-16 — **Market + tech reassessment** written (`docs/feasibility/03-...`). Verdict: architecture
  holds, risk shifted from feasibility→scope; phase hard; Tauri-mobile spike is #1 gate. Market:
  ~$40-70B TAM by 2030, ~30-40% e-sign CAGR (APAC fastest ~40%); strong India fit (900M users, 22
  languages, Aadhaar eSign/DigiLocker, ~500k CSC channel, DPDP compliance); comparable airSlate $120M ARR.
- 2026-07-16 — **Printable QR OK** (provenance is disclosed, not covert). **Registered roles +
  verifiable workflows (#14):** Authority/Institution Registry (org metadata, invariant-safe); on SSO
  sign-in a party's RegisteredRole is asserted (Registrar/Notary/KYC-officer/etc.), scoping a
  role-defined workflow; every step attributed + bound into provenance/audit → verifiable by an
  authority. New entities AuthorityRegistry/RegisteredRole. → ADR-0010.
- 2026-07-16 — **Provenance/traceability request REFRAMED (#13).** User asked for a hidden,
  vendor-decryptable QR logging creators/signers/IP addresses. FLAGGED as breaking the invariant on
  3 counts (vendor backdoor, IP surveillance, covert beacon) + an ethics/legal line; declined that
  form. User chose **authority-scoped verifiable provenance**: a DISCLOSED signed manifest (doc hash,
  signer identities, attestations, trusted timestamps) with a sensitive block **encrypted to a NAMED
  governing authority's key — never ours**. No vendor key, no IP surveillance, no covert beacon; TSA
  gets only a one-way hash. Added no-vendor-backdoor rule to the invariant. → ADR-0009. UML gained a
  provenance sequence + class entities (ProvenanceManifest, GoverningAuthority).
- 2026-07-16 — **Multi-party document process added (#12):** one document assembled from several
  Profiles (Seller/Buyer, Plaintiff/Defendant, +witnesses), coordinated by an admin. Roles 1..*,
  per-party consented E2E data share scoped to this doc + counterparties, one non-delegable signature
  per party (parallel/sequential), execute + distribute encrypted copies — no server holds joint
  content. Cross-party visibility is inherent + consented; editing after a signature invalidates
  prior signatures (re-sign). New crate `core-txn`; entities MultiPartyDocument/PartyRole/Party;
  UML gained a multi-party sequence + a lifecycle state diagram. → ADR-0008.
- 2026-07-16 — Translation footprint clarified: small bundled engine + per-language-direction models
  (~15-50 MB) lazy-downloaded/cached (not the whole library; pivot via English for non-English pairs).
  Added **evictable asset-cache policy** for ALL lazy assets (models, fonts, catalog templates):
  auto-evict on >~30 days unused OR storage pressure, EXCEPT user-pinned offline assets; lossless
  re-download; first use of an evicted/new asset needs network; usage tracked on-device only.
- 2026-07-15 — Added features **#9 authenticated signing (federated/public identity: OIDC,
  passkeys/WebAuthn, eID)** and **#10 data-source documents → on-device auto-extracted KV pairs,
  saved per Profile**. Introduced **Profiles + Subscriptions/Tenants** (family = many profiles;
  institution = 1-to-many / many-to-many mapping). Domain model, non-goals, glossary, and open
  decisions updated in the brief. **Blocking decision:** institutional cross-person/cross-device
  data movement — recommend user-directed E2E-encrypted export (option a); zero-knowledge relay
  (option c) needs explicit user ruling vs the privacy invariant.
- 2026-07-15 — Ran worst-case feasibility trial (`prototypes/field-detection-trial/`, docs in
  `docs/feasibility/`). Verdict: **conditional GO**. Documented optimistic approach + trial results.
- 2026-07-15 — Built spike `prototypes/translated-fill/` (isolated from the pnpm workspace):
  scanned PDF → `pdfjs` render → `tesseract.js` OCR → heuristic field detection → cloud translation
  (MyMemory default, Google via key) → fill → `pdf-lib` export in original-or-chosen language.
  Typechecks, builds, and dev server serves. **Runtime behaviour (OCR/translation quality) not yet
  verified in-browser — needs a human click-through** (see its README).
- 2026-07-15 — Wrote `memory-bank/projectBrief.md` (full vision + 8 pillars + domain model).
- 2026-07-15 — Wired scaffold plumbing: installed deps, fixed `@types/node`/`drizzle-orm` gaps,
  added vitest smoke test, pg pool connect timeout, real CI gates. typecheck/test/build/traceability
  all green.

## Next steps
- [ ] **You:** run the spike (`cd prototypes/translated-fill && pnpm dev`), click through, and judge
      OCR + field-detection quality on a REAL scanned form. Record verdict here.
- [ ] Draft the **architecture RFC** (local-first + cross-platform; re-scope `apps/api`/Postgres to
      optional stateless services). Blocked on the spike verdict.
- [ ] Draft the **search/vectorization ADR** (recommend: vectorize tags + AI summary, local index).
- [ ] Decide Word/XLS fill model (now recorded as V-next scope in the brief) — needs its own ADR.

## Open questions / blockers
- **Privacy vs. cloud AI:** spike uses cloud OCR/translation, which violates the local-first rule.
  Production needs on-device models — feasibility unproven. Biggest open risk.
- **Field detection on real layouts** is the hardest unsolved piece (heuristic today).
- Stack not yet chosen: Tauri+Capacitor (reuse TS) vs Flutter. Awaiting your lean.

## Decisions pending (ADRs to record on RFC accept)
- **ADR-0002** native stack (Tauri v2) · **ADR-0003** encrypted export/import bundle ·
  **ADR-0004** federated signing · **ADR-0005** Form Catalog ·
  **ADR-0006** signing-request/response bundle (distinct from ADR-0003: review+sign+return intent,
  preparer provenance, bound canonical doc hash, consent/authorization + revocation) ·
  **ADR-0007** in-person biometric/witnessed signing (scanner vs thumbprint-photo, biometric storage,
  liveness, legal validity, assurance labelling) ·
  **ADR-0008** multi-party document workflow (roles/cardinality, per-party consent + scope, parallel
  vs sequential signing, re-sign-on-edit invalidation, executed-copy distribution) ·
  **ADR-0009** authority-scoped verifiable provenance (manifest schema, TSA/transparency, authority
  key registry, disclosure+consent UX, QR payload — no vendor key) ·
  **ADR-0010** registered roles + verifiable workflows (registry model, role taxonomy, role-scoped
  workflow defs, audit+provenance binding, authority verification).

## Recently shipped (2026-07-18)
- **Fill-a-Form flow reworked:** opening a form (PDF/image) now **auto-detects & fills** (existing
  AcroForm → fill; else OCR-create + fill); "Fill a PDF" renamed "Fill a Form"; demo sample tucked away.
- **Image-of-a-form → editable PDF** (`imageToPdf`), then the same pipeline.
- **From the web (URL):** `core-fetch::fetch_form` (reqwest/rustls, SSRF-guarded, redirect-revalidated,
  size-capped) + `download_form` command + UI.
- **Word/Excel (REQ-15.1 / RFC-0002 / ADR-0011) Phase A:** fill named regions (Word content controls,
  Excel named ranges) on-device via OOXML edit (`office.ts`, fflate + fast-xml-parser). Unit-tested.
- **Windows code signing:** opt-in `signCommand` hook (`sign-windows.ps1`), env-driven, dev-cert script,
  docs — verified end-to-end (signed MSI + NSIS setup).

## Decisions pending (older)
- Architecture RFC (local-first, cross-platform) — not yet opened.
- Vectorization/search ADR — recommendation drafted in the brief, not yet formalized.
- **Word/Excel fill:** Phase A **done** (named fields). Phase B (flat-doc detection) + Phase C
  (Office→PDF) pending — see RFC-0002.
- **Web *search* to locate a form (REQ-11):** parked — user scoped web sourcing to URL/download only
  (a search query would leave the device; needs explicit opt-in).
