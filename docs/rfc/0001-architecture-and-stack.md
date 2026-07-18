# RFC-0001: Native local-first architecture, stack & the public Form Catalog

- **Status:** Accepted (2026-07-16) — proceed to Phase 0 (spikes) then Phase 1 (MVP)
- **Author(s):** PolyglotFormFill team
- **Created:** 2026-07-15
- **Updated:** 2026-07-15 — **native cross-platform** app (not web/PWA); added the **public Form
  Catalog** facilitator; OCR/detection demoted to a fallback behind catalog field-maps.
- **Related:** projectBrief.md (pillars #1–#11), docs/feasibility/*, ADR-0002 (stack, on accept),
  ADR-0003 (cross-device sharing = encrypted export/import), ADR-0004 (federated signing),
  ADR-0005 (Form Catalog), **ADR-0006 (signing-request/response bundle — pending)**,
  **ADR-0007 (in-person biometric/witnessed signing — pending)**,
  **ADR-0008 (multi-party document workflow — pending)**,
  **ADR-0009 (authority-scoped verifiable provenance — pending)**,
  **ADR-0010 (registered roles + verifiable workflows — pending)**

## Summary
Build PolyglotFormFill as a **native, installed cross-platform app** (Desktop + Tablet + Phone) that keeps
**all user data on the device** and runs **all processing on-device**. A **public Form Catalog**
server holds only **public form knowledge** — metadata, source URLs, tags, blank templates, and
curated **field-maps** — and serves it **down** to devices. The catalog is both the fast-search
facilitator and the primary source of field layouts, so **known forms need no OCR/detection at all**;
OCR/field-detection becomes the fallback for unknown/custom forms. No server ever receives user
content — not metadata about their values, not ciphertext, nothing.

## Motivation
- **Native over web:** a web app re-downloads its code from us each visit, so "nothing leaks" would
  depend on trusting the served code. A native, installed, auditable app closes that residual gap and
  gains durable local storage, camera capture, OS secure-keystore, offline, and file handling. Given
  the non-negotiable privacy invariant, native is the correct trust model. (Web/PWA was considered
  and set aside; it remains a possible later reach channel.)
- **The Form Catalog turns our biggest risk into a strength.** The feasibility trial showed
  worst-case field detection is unreliable (esp. CJK scans). But most target forms are **public,
  standard government/institutional forms**. If the form is in the catalog with a curated field-map,
  the device downloads the map and just fills it — **zero OCR/detection**. Detection is only needed
  for the long tail of unknown forms. This also realises the "shared template" moat.
- Both hold the privacy line: the catalog is **public knowledge only**; user data stays on-device.

## Detailed design

### Stack decision (native, stack freedom granted 2026-07-15)
| Layer | Choice | Why |
|---|---|---|
| App shell | **Tauri v2** (Win/macOS/Linux **and** iOS/Android) | One installed codebase all platforms; small footprint; auditable; native storage/keystore/camera |
| UI | **React + TypeScript** (in the Tauri webview) | Reuses the rich JS document ecosystem; fast iteration |
| Core engine | **Rust** (`src-tauri` + `crates/*`) | Performant, memory-safe on-device processing + crypto; one core across platforms |
| PDF render/interact | **pdf.js** (webview) | Mature interactive rendering + fill overlay |
| PDF raster/export | **pdfium** (`pdfium-render`) + **lopdf/pdf-writer** + **fontkit** (Rust) | Raster for OCR; field injection, annotation layers, subset font embed on export |
| OCR (on-device, **fallback**) | Pluggable trait; **ONNX/PaddleOCR** for quality (esp. CJK), Tesseract fallback | Needed only for forms absent from the catalog; kept swappable (server OCR rejected) |
| Field maps | **Catalog field-map first**; CV/heuristic + optional ONNX layout model only if uncatalogued | Catalog-first is the core simplification |
| Translation (on-device) | **CTranslate2 / Bergamot** NMT, quantized. Small **engine bundled**; **per-language-direction models (~15–50 MB) lazy-fetched + cached**, NOT the whole library; non-English pairs may pivot via English (2 models) | Proven on-device NMT; footprint scales with languages the user uses; assets down only; optional pre-download for offline field work |
| Search | **Local catalog index** synced to device → **on-device search** (no query leaves); embeddings + sqlite-vec | Even "which form" stays private (see below) |
| Local store | **SQLite + SQLCipher** (encrypted at rest), per-Profile; encrypted file blobs | Native durable storage |
| Crypto | Rust crypto + **OS secure keystore** (Keychain/Keystore/DPAPI); Ed25519 signing | Key mgmt + at-rest encryption + signatures |
| Signing identity | **WebAuthn/passkeys + OIDC (SSO)**; signature produced by the signer's own authenticator | **Non-delegable** by construction — only the signer's passkey can sign; on-behalf never signs |

**Rejected:** web/PWA as the primary target (served-code trust); Flutter (weaker on-device
OCR/NMT/PDF ecosystem, larger rewrite); server-side OCR/any content endpoint (privacy invariant).

### The Form Catalog (public knowledge — the new server role)
- **Covers BOTH document forms AND live web forms.** Every `CatalogEntry` has a
  **`kind` = PDF | DOCX | XLSX | WebForm**, so the same catalog answers "where are the fields"
  whether the form is a file or a web page.
- **Contents (all public, no user content):** `CatalogEntry` = { form name, issuer, country,
  version, `kind`, **source URL**, tags, blank template (documents), **FieldMap**, fingerprint }.
  The **FieldMap is polymorphic by `kind`:**
  - **Document forms (PDF/DOCX/XLSX):** field **positions/anchors** + types + canonical ontology keys.
  - **WebForm:** **DOM field-maps** — CSS/XPath **selectors** per field + types + canonical ontology
    keys (+ optional URL pattern for the page).
  FieldMaps are **curated and/or crowd-sourced** (structure only, never values).
- **Matching:**
  - a **document** is matched to a `CatalogEntry` by **source URL** or **layout fingerprint**; on hit
    it pulls the FieldMap and skips OCR/detection entirely.
  - a **live web form** is matched by **source URL (pattern)**; on hit `core-webform` uses the DOM
    selectors to autofill the page from the vault, in the in-app webview, locally.
- **Private search:** the catalog **index** (names, tags, fingerprints, embeddings) is **synced to
  the device** and searched **on-device**, so the user's form-interest never leaves. Full templates
  are fetched on demand (a template fetch reveals only that a public form was downloaded — the same
  as visiting the government site). Strict mode: prefetch templates in bulk to hide even that.
- **Contribution loop:** when a device derives a FieldMap for an uncatalogued public form, it may
  **offer to contribute the map** (structure only, user-consented, never their values) — growing the
  catalog and the moat.

### Component boundaries
```
apps/app                     Tauri application (installed)
  src/            React/TS UI (viewer, fill overlay, field editor, catalog search, profiles, signing)
  src-tauri/      Rust command bridge + wiring
crates/
  core-pdf        render(pdfium), edit/export(lopdf,fontkit), annotation layers
  core-catalog    local catalog index sync + on-device search + fingerprint match (docs + web forms)
  core-txn        multi-party document orchestration: roles, per-party consent + fill + signature state
  core-webform    in-app webview autofill: match live HTML form -> inject vault values locally
  core-fetch      native HTTP download of web-hosted files (not CORS-bound)
  core-ocr        OCR trait + ONNX/Tesseract + CV field detection (FALLBACK)
  core-mt         on-device translation
  core-extract    data-source extraction (passport/licence → KV) + ontology
  core-store      SQLCipher DB, per-Profile repos, encrypted blob store
  core-crypto     OS-keystore key mgmt, Ed25519 signing, E2E export/import (.pdfxfer)
  core-identity   WebAuthn/OIDC signer authentication
packages/shared   TS types shared UI<->core
services/
  catalog         PUBLIC Form Catalog API + index — serves public form knowledge DOWN only
  assets          STATELESS: fonts, OCR/NMT/embedding models, app updates — DOWN only
  account          OPTIONAL: subscription/billing + OIDC broker — identity/metadata ONLY, never content
```

### Data & storage
- Everything hangs off a **Profile**; a **Subscription** (individual/family/institution) owns Profiles.
- **InstitutionAdmin = actor generalization of Individual, EXCEPT signing:** performs any use case
  **on behalf of** a selected member Profile they are authorized for — but **never signs.** When a
  signature is required the **Signee SSO-authenticates and signs on their own authenticator**
  (same-device ceremony or routed to the Signee's device). Member data arrives only via consented
  E2E-encrypted import (no server path); every on-behalf action is attributed + audited to
  `(admin, target Profile)`. Authorization + audit live on-device in `core-store`.
- SQLite (SQLCipher) for metadata, KV vault, field maps in use, local catalog index, and vectors;
  originals, annotation layers, and DataSourceDocuments as **encrypted blobs**.
- **Keys** in the OS secure keystore, wrapped by an optional passphrase; per-Profile derived keys.
- **Downloaded assets are an evictable cache (not user data).** Translation/OCR models, per-script
  fonts, and catalog templates are public + re-downloadable, so they use **LRU/TTL eviction**
  (default: **unused > ~30 days OR under storage pressure**), **except assets the user pins for
  offline use**. Re-fetched transparently when next needed. **First use of a not-yet-cached
  language/script/model needs connectivity; offline thereafter.** Retention is user-configurable;
  usage tracking is **on-device only**. Same policy for all lazy assets — never for user content.
- **Cross-person sharing = user-directed E2E-encrypted `.pdfxfer` export/import ONLY** (ADR-0003). No
  server participates — not even with ciphertext.

### Server footprint (all content-free by construction)
- `services/catalog` — public form knowledge for **documents and web forms** (metadata, tags,
  templates, **document field-maps + web-form DOM field-maps**, fingerprints); **down only**;
  accepts only user-consented **structure** contributions (never values).
- `services/assets` — fonts + models; **down only**.
- `services/account` — optional subscription/billing + OIDC broker; **account/identity metadata only.**
- **No content endpoint exists anywhere.**

### Anti-exfiltration (hard requirements)
- PDFs rendered with **scripting disabled** and **external-resource loading blocked**.
- Egress allowlist: catalog, assets, OIDC broker, and the **user-initiated submit target** — nothing
  else. No content telemetry. HTTP submit targets warn the user.

### Multi-party documents (`core-txn`)
- One `MultiPartyDocument` binds a Document to **Parties** = (PartyRole 1..*, Profile). Coordinated by
  an admin; **each party's data arrives via consented E2E-encrypted share** scoped to this document +
  named counterparties. Assemble → autofill each role from that party's vault.
- **One non-delegable signature per party** (Tier 1/2), collected **parallel or sequential**.
- **State machine:** draft → gathering → assembled → circulating → partially-signed → fully-executed
  (or withdrawn). **Any content edit after a signature invalidates prior signatures** (hash change) →
  back to assembled, re-sign. On execution, encrypted copies distribute to all parties. **No server
  holds joint content.** Cross-party visibility is inherent + consented. → **ADR-0008**.

### Verifiable provenance (authority-scoped) — `core-crypto`
- Embed a **disclosed, signed ProvenanceManifest** in the document (metadata + a **visible QR**):
  doc hash, signer identities, attestations, **trusted timestamps** (RFC-3161 TSA / transparency
  log). Public part is verifiable by anyone; a **sensitive block is encrypted to a NAMED governing
  authority's public key** (disclosed + consented) — **we never hold that key**.
- Timestamping sends **only the document hash** (one-way, no content) to the TSA — user-directed.
- **Forbidden by construction:** vendor-decryptable keys, IP/network surveillance, covert/hidden
  beacons. Provenance is disclosed (a **printable QR is fine**), not secret. → **ADR-0009**.
  (Reinforces the no-vendor-backdoor rule in the privacy invariant.)

### Registered roles & verifiable workflows (`services/account` + `core-txn`)
- An **Authority/Institution Registry** holds organisational identity + **role** + **public key**
  (org metadata, not user content → registry server is invariant-safe). On **SSO/OIDC sign-in a
  party's RegisteredRole is asserted** from IdP claims or the registry (Registrar, Notary, KYC-officer,
  Court-clerk, Escrow-agent, Institution-admin…), scoping capabilities.
- Each role runs a **defined, role-scoped workflow**; every step is **attributed to (role, identity)**,
  audited, and **bound into the provenance manifest + signatures**, so an authority can **verify the
  correct workflow was followed by the authorised role**. → **ADR-0010** (roles/workflow) with ADR-0009.

### Signing tiers
- **Tier 1 — cryptographic self-sign (high assurance):** signee SSO-authenticates and signs on their
  own passkey/authenticator. Self-proving, non-delegable by key.
- **Tier 2 — in-person witnessed sign (device-less signee, lower assurance):** signee reviews on the
  operator's device, **draws a signature** and gives a **live fingerprint/thumbprint** (both placed
  on the form); the **SSO-authenticated operator attests** the capture over the document hash. Bound
  by `BiometricCapture` + `WitnessAttestation`. Non-delegable via the live biometric + accountable
  witness; **explicitly a lower tier** than Tier 1.
  - **Biometric = special-category PII:** on-device only, encrypted, consented, prefer non-reversible
    template + visual mark. Needs data-classification + per-jurisdiction legal review.
  - **Hardware:** built-in sensors auth-only (no image); a fingerprint *mark* needs an **external
    scanner (SDK)** or a **photo of an inked thumbprint** — support both. → **ADR-0007**.

### Signing hand-off (how the signee sees & signs)
- **Same-device ceremony:** hand over the screen; the signee authenticates via **cross-device
  WebAuthn** (their phone/passkey) — admin never holds their credential.
- **Routed signing request:** the prepared FormInstance is sealed as a **consented E2E-encrypted
  "signing request"** (reuses the `.pdfxfer` bundle + `core-crypto`, ADR-0003/0006) to the signee's
  device; the signee **reviews the exact rendered form (WYSIWYS)**, approves/rejects, SSO-auths, and
  signs on their own authenticator; the **signed FormInstance is sealed back** to the sender. No
  server touches content. Signature is over the canonical (flattened) document hash the signee saw.

### Filling forms wherever they live (webview)
- **Web-hosted downloadable file** → `core-fetch` downloads it to the device (inbound; native HTTP,
  no CORS limit), then the normal document pipeline runs.
- **Live HTML web form** → an **in-app webview** navigates to it; `core-webform` matches it to a
  WebForm CatalogEntry (or detects fields on the DOM) and **injects vault values locally**. Submit
  goes device→site directly. Once on the third-party page its own scripts run (user-directed).
- **Locked view-only doc** → OCR-of-rendered-view or manual fallback; cannot edit as a document.

## Alternatives considered
- **Web/PWA** — set aside (served-code trust; evictable storage). Possible later reach channel.
  (Also: a web app is CORS-bound and could not auto-download third-party forms — native can.)
- **Flutter / React Native / MAUI** — weaker on-device OCR/NMT/PDF ecosystem; larger rewrite.
- **Server-side OCR / any content endpoint / submission proxy / zero-knowledge relay** — all rejected
  (privacy invariant; explicit rulings 2026-07-15).

## Risks & trade-offs
- **Tauri v2 mobile maturity** — validate pdfium/onnxruntime native bindings on iOS/Android with an
  early spike before committing all platforms.
- **Rust + TS dual-language** build/complexity — clean bridge + generated types + CI for both.
- **On-device model size/perf** on phones — lazy per-language, quantized, off-thread; but the catalog
  means many forms skip OCR entirely.
- **Catalog coverage & trust** — curated + crowd field-maps need moderation/versioning to stay
  correct; uncatalogued forms fall back to on-device detection (feasibility floor still holds).

## Rollout & migration
1. **Repo restructure** (native): `apps/app` (Tauri) + `crates/*` + `services/{catalog,assets,account}`.
   Retire the content-bearing `apps/api`/Postgres scaffold (explicit removal). Keep prototypes as refs.
2. **Vertical slice:** open a **catalogued** PDF → match → download FieldMap → autofill from local
   vault → encrypted on-device save → export. Proves the catalog-first happy path end-to-end on one
   desktop + one mobile target.
3. Add the fallback detection path, translation, data-source extraction, signing, export/import, and
   the catalog contribution loop — each behind its own REQ + spec + tests.

## Open questions
- **ADR-0006 (pending):** the **signing-request/response** is a distinct bundle type from the sharing
  bundle (ADR-0003) — it carries a "review + sign, then return" intent, preparer provenance, and a
  bound canonical document hash. Spec its format, consent/authorization, and revocation separately.
- **ADR-0007 (pending):** in-person biometric/witnessed signing — hardware (external scanner SDK vs
  inked-thumbprint photo), biometric storage (template vs mark, non-reversible), liveness/anti-spoof,
  legal validity per jurisdiction, and the witnessed-tier assurance labelling.
- **ADR-0008 (pending):** multi-party document workflow — role/cardinality model, per-party consent +
  scope, parallel vs sequential signing, re-sign-on-edit invalidation, executed-copy distribution.
- **ADR-0009 (pending):** authority-scoped verifiable provenance — manifest schema, TSA/transparency
  choice, authority key distribution/registry, disclosure + consent UX, QR payload. No vendor key.
- **ADR-0010 (pending):** registered roles + verifiable workflows — registry model (federated IdP
  claims vs hosted registry), role taxonomy, role-scoped workflow definitions, audit + provenance
  binding, verification by an authority.
- Native stack final confirm: **Tauri v2** vs Flutter (recommend Tauri; validate mobile bindings first).
- Catalog FieldMap schema + fingerprinting algorithm + moderation/versioning model.
- On-device OCR engine for the fallback (ONNX/PaddleOCR vs Tesseract) — V1 bench.
- `.pdfxfer` bundle format + key exchange (ADR-0003 detail).

> On accept: record ADR-0002 (native stack), ADR-0003 (encrypted export/import), ADR-0004 (federated
> signing), ADR-0005 (Form Catalog), ADR-0006 (signing-request/response bundle), ADR-0007 (in-person
> biometric/witnessed signing), ADR-0008 (multi-party document workflow), ADR-0009 (authority-scoped
> verifiable provenance), ADR-0010 (registered roles + verifiable workflows), then repo restructure +
> catalog-first vertical slice.
