# Project Brief

_The root context document. If you read only one file, read this. Keep it current._

## Vision
ProjectPDFs is a **privacy-first, cross-platform PDF autofill assistant**. It turns any PDF —
editable or not, in any language — into a fillable form and completes it from the user's own
reusable data (name, DOB, address, phone, and any custom key–value pairs they define), saving
them time, effort, and money. **All user data lives only on the user's own device**; nothing
personal is stored in the cloud or wherever the app runs.

## Problem & audience
- **Primary users / personas:** Individuals worldwide who repeatedly fill the same personal data
  into different forms (government, immigration, healthcare, finance, school, employment); small
  businesses/freelancers filling client forms; anyone handed a non-editable or foreign-language PDF.
- **Problem being solved:** Filling PDFs is manual, repetitive, and error-prone. Many PDFs are
  scanned/non-editable, or are in a language the user can't read. Existing tools either require
  cloud upload of sensitive data or can't handle non-editable / non-native-language forms.
- **Why now / why us:** On-device AI + local vector search now make it possible to do
  form-field inference, translation, and semantic search **without sending private data to a
  server**. Our differentiator is *zero personal data leaves the device* combined with
  *works on any PDF in any language on any device*.

## Scope

### In scope (V1 feature set — the eight pillars)
1. **Reusable personal data vault.** The user maintains a set of key–value data points
   (name, DOB, address, phone, …). These are examples only — users add their own KV pairs
   manually, and when a PDF asks for a datum the vault doesn't have, the system generates a new
   KV pair (prompting the user for the value) and remembers it for future forms.
2. **Make any PDF fillable.**
   - Ingest a PDF by **upload from the device** or by **pointing to a URL**.
   - If the PDF is **already editable**, retain its existing field names verbatim.
   - If it is **non-editable** (the common case), auto-generate editable fields. **AI names each
     field to align with the actual question/ask** on the page (not `field_1`, but e.g.
     `applicant_date_of_birth`).
   - Supported field types: **text box, list box (dropdown), check box, message/multiline box**, etc.
3. **Any-language forms with a native-language working view.**
   - A PDF may be in any language (targeting a global audience).
   - The user gets a **VIEW of the PDF translated into their chosen native language**.
   - While filling (by system or user), the on-screen presentation stays in the **chosen
     language** until the content is fully accepted.
   - **Only at print/save time** does the user choose whether the stored VALUES are written in the
     **original PDF language** or the **user's chosen language**.
4. **Auto-tagging + AI-searchable repository.**
   - On save, the system auto-generates **tags** that identify each PDF so the AI can traverse a
     large collection quickly.
   - PDFs and/or their tags are **vectorized** for fast semantic search and compact storage
     (see _Open decisions_ — recommendation below).
5. **Local-first, cross-platform, zero cloud storage of user data.**
   - **No user values are stored in the cloud** or where the app runs — everything stays on the
     user's device.
   - The app ships for **Desktop, Tablet, and Smartphone**; the tech stack is chosen to honor this
     (see _Constraints_ and _Open decisions_).
6. **AI search bar.** A search window (bottom of the UI) returns a **filtered list of PDFs** the
   user can browse to pick the right one. Each result shows the **PDF name, TAGS, and a resizable
   thumbnail/preview image** for visual selection.
7. **Save & submit anywhere.** A filled PDF can be **saved to the local device** and/or
   **submitted online** — either to a separate submission URL, or by filling values directly where
   the PDF is hosted — giving the user the choice to save or submit online.
8. **Full history, versioning, and rich annotation.**
   - Every user's forms (as **Saved / Submitted / Printed**) are retained in **history**, with
     counters for prints, submissions, etc.
   - **Every data modification is a new version** (immutable version chain per form).
   - Users can add **images, signatures, and free-hand MANUAL WRITING on the PDF itself.**
   - Manual writing/annotation is stored as a **separate layer superimposed on the original PDF**:
     the **original PDF and the layer(s) are stored separately but linked as one entity.**
   - The user controls **color, font, size, thickness**, etc., and can apply a **watermark** of
     their choice to any document.
9. **Authenticated signing (SSO / federated identity) — NON-DELEGABLE.**
   - **The signer must authenticate themselves via SSO** — OIDC/OAuth, **passkeys / WebAuthn**, or
     (where available) **government eID / verifiable credentials** — and the signature is produced by
     **their own authenticator** (ideally a passkey), so it **cannot be created by anyone else**.
   - **Self-fill:** an individual filling their own form is **SSO-authenticated from the start**; that
     same identity signs.
   - **On-behalf fill (Agent / Institution):** an admin may **fill / prepare** a form for a member,
     but **CANNOT sign it.** The designated **Signee must SSO-authenticate themselves and sign** —
     either by taking over the same device for a signing ceremony, or by the form being routed to the
     **Signee's own device** to authenticate and sign there.
   - **HARD RULE: nobody can sign on behalf of another — ever.** "On-behalf-of" applies to
     fill/translate/save/submit/share, **never to sign**. Multiple signees each sign with their own
     SSO, producing distinct signatures.
   - **The Signee always reviews the full document before signing (WYSIWYS).** They see the exact
     rendered form whose hash is signed, and may **approve, reject, or request changes** — a
     signature exists only if they approved and authenticated. Delivery to the signee is one of:
     - **Same-device ceremony:** admin hands over the screen; the signee authenticates with **their
       own phone via cross-device WebAuthn** (scan QR) — the admin never holds their credential.
     - **Routed signing request:** the prepared FormInstance is sent to the **signee's own device**
       as a **consented E2E-encrypted "signing request"** (same channel as sharing — no server); the
       signee reviews, authenticates, signs, and the **signed result is sealed back** to the sender.
     Neither path lets any server hold the content.
   - **Two signing tiers (assurance is explicit):**
     - **Tier 1 — cryptographic self-sign (high):** the signee authenticates via SSO/passkey and
       signs on their own authenticator (as above). Self-proving, non-delegable by key.
     - **Tier 2 — in-person witnessed sign (for a DEVICE-LESS signee):** the signee reviews the form
       on the **operator's device**, **draws their signature**, and gives a **live fingerprint /
       thumbprint** — both placed on the form (drawn mark reuses annotation #8). The **operator (an
       SSO-authenticated admin) is the accountable witness**: their device cryptographically attests
       "captured signee Y's live signature + biometric over document hash H at time T." Non-delegable
       via the **signee's live biometric** (the operator cannot fabricate it) plus the operator's
       accountable identity. **Lower assurance than Tier 1** — trust rests on operator + device +
       liveness; label it as such, never equate with Tier 1.
       - **Biometric = special-category PII:** captured/processed/stored **on-device only**,
         encrypted, explicit consent; prefer a **non-reversible template + visual mark**, not raw.
         Needs data-classification + **per-jurisdiction legal review**.
       - **Hardware:** built-in phone sensors give **auth yes/no only, not an image**. Placing a
         fingerprint **mark** needs an **external scanner (SDK)** or a **photo of an inked
         thumbprint**. Support both; scanner where present. → ADR-0007.
   - PRIVACY: only **identity assertions/tokens** are exchanged with the identity provider — **never
     the form content**. (Needs network at sign time; offline signing is not available without the
     signer's federated authentication — we do not fall back to a delegable local key.)
10. **Data-source documents → auto-extracted KV pairs, per profile.**
    - The user uploads any file as a **data source** (passport, driver's licence, contract, utility
      bill, …). The system **automatically extracts the data of interest** and saves it as
      **key–value pairs on the device**, reusable to fill any other form. (Same on-device
      OCR/field-understanding engine as the fill pipeline — extraction runs **on-device only**;
      these are highly sensitive documents.)
    - Extracted KV pairs and data-source docs are saved **against a Profile**. **Multiple profiles
      per subscription:** a **family** subscription gives each member their own profile; an
      **institution** subscription supports **1-to-many / many-to-many** mapping of data across
      many people's profiles (e.g. an org filling forms for its members). See _Open decisions_ —
      cross-person/cross-device data movement is the one genuine privacy-boundary question.

11. **Fill forms wherever they live — web-hosted files & live web forms (in-app browser view).**
    - A web-hosted **downloadable** file → the app **auto-downloads** it to the device (inbound
      fetch; native HTTP is not CORS-bound) then runs the normal pipeline (catalog-match / OCR →
      autofill → export/submit).
    - A live **HTML web form** (not a file) → the app **autofills the page's fields from the
      on-device vault**, password-manager style: values injected **locally** in the in-app webview;
      submit goes **device → site directly**. This is a distinct field-understanding surface (HTML
      DOM, not PDF geometry). The **Form Catalog may hold web-form field-maps** (source URL + DOM
      selectors + ontology keys) so known web forms autofill without guesswork.
    - A genuinely locked view-only document (no obtainable bytes) → fallback is OCR-of-rendered-view
      or manual; cannot be filled as an editable document. Honest limit.
    - Caveat: once on the live third-party page, that site's own scripts run; we fill locally but
      cannot guarantee the site doesn't transmit as the user types — inherent to using their site,
      and a user-directed submit.

12. **Multi-party documents (a dedicated process).** One document assembled from **several Profiles
    at once**, coordinated by an Institution admin — e.g. **Seller(s) + Buyer(s)**,
    **Plaintiff(s) + Defendant(s)**, plus witnesses/guarantors.
    - **Roles** (Seller, Buyer, Plaintiff, Defendant, Witness…) each have cardinality **1..\***; each
      **party is a distinct Profile**.
    - **Data gathering is per-party consented** (E2E-encrypted share scoped to *this* document with
      *these named counterparties*). The admin may fill on each party's behalf, but assembly needs
      each party's consent.
    - **Assemble one document**, autofilling **each role's fields from that party's own vault**.
    - **One signature per party, non-delegable** (Tier 1 or Tier 2), collected **parallel or
      sequentially** via the signing-request / in-person flows.
    - **Execute + distribute:** when all required signatures are present → **fully executed**;
      encrypted copies go to every party. **No server ever holds the joint content.**
    - **Cross-party visibility is inherent + consented:** a party sees counterparties' data on the
      shared document (nature of a contract); each party explicitly consents to appear.
    - **Editing after partial signing invalidates prior signatures** (hash changes) → back to
      "assembled", re-sign required. → ADR-0008.

13. **Verifiable provenance (authority-scoped traceability) — DISCLOSED, never a vendor backdoor.**
    A **cryptographically signed provenance manifest** embedded in the document (in metadata and as a
    **visible, disclosed, printable QR** — printable is fine; it is disclosed, not covert), giving a
    governing authority real traceability **without us ever holding a key**.
    - **Public, verifiable part:** document **hash** (tamper-evidence), **signer identities**
      (already SSO-bound + consented), **witness attestation**, and **trusted timestamps** (RFC-3161
      TSA / transparency log) for created/signed — anyone can verify authenticity + who/when by
      checking signatures.
    - **Sensitive part:** encrypted to a **NAMED governing authority's public key** (disclosed to the
      parties + consented). Only that authority can decrypt — **we cannot, ever** (we never hold the
      key).
    - **Timestamping** sends **only the document hash** (one-way, no content) to the TSA — user-directed.
    - **HARD EXCLUSIONS:** no **vendor-decryptable** keys, no **IP-address / network surveillance**,
      no **hidden/covert beacon**. Provenance is **disclosed and consented**, never secret. → ADR-0009.

14. **Registered roles & verifiable workflows.** Institutions and governing authorities are
    **registered** in an **Authority/Institution Registry** (organisational identity + role +
    public key — this is *org metadata, not user content*, so a registry server is invariant-safe).
    - **On sign-in (SSO/OIDC), the party's role is registered/asserted from their identity claims or
      the registry** — e.g. Registrar, Notary, Bank-KYC-officer, Court-clerk, Escrow-agent,
      Institution-admin. Access + capabilities are **role-scoped**.
    - **Each role follows a clear, defined workflow** (which steps, in what order, who may do what).
    - **The workflow is verifiable:** every step is attributed to the acting party's **role +
      identity**, recorded in the audit trail and bound into the **provenance manifest (#13)** and
      signatures — so an authority/auditor can verify the correct workflow was followed by the
      authorised role. → ADR-0009/0010.

### V-next scope (accepted, not V1)
- **Word (.docx) and Excel (.xlsx) documents** as additional fillable types. NOTE: these are not
  fixed-layout like PDF — a `.docx` fills via content-controls/placeholders and `.xlsx` via named
  cells/ranges, so `Document` becomes **format-polymorphic** (per-format fill model). The
  translated-fill (#3) and layered-handwriting (#8) features **do not map cleanly** onto reflowable
  Office formats and may be PDF-only. This expansion is a structural boundary change → **RFC/ADR
  required** before building.

### Explicit non-goals (V1)
- No cloud storage or server-side persistence of user personal data / vault values / content.
  (Accounts/billing identity for Subscriptions is metadata, not content, and is permitted.)
- No real-time collaborative editing of the same document (multi-Profile is about owning separate
  data sets, not co-editing one live document).
- Not a general PDF page editor (reflow text, edit source content) — we add a fill/annotation
  layer over the original, we do not rewrite the source document.
- Signatures are cryptographic + federated-identity-bound (#9); we do NOT claim jurisdiction-specific
  legal equivalence (e.g. eIDAS QES) in V1 unless a specific eID provider is integrated.

## Success criteria
- **Time saved:** median time to fill a known form drops materially vs. manual (target set after
  baseline; e.g. ≥70% reduction on a repeat form).
- **Autofill hit rate:** ≥X% of fields on a known form pre-filled correctly from the vault.
- **Field-naming quality:** AI-generated field names judged "aligned with the ask" ≥X% of the time.
- **Search:** relevant PDF appears in the top results for a natural-language query ≥X% of the time,
  under N ms on a typical device.
- **Privacy invariant (hard gate):** independently verifiable that **no user value ever leaves the
  device** (network audit shows zero PII egress).
- **Cross-platform:** feature parity across Desktop / Tablet / Phone for the core fill flow.

## Core domain model (nouns & relationships)
- **User** — owns everything locally; no server identity required for content.
- **Subscription / Tenant** — a billing account (individual, **family**, or **institution**) that
  owns one or more Profiles. Servers may know account/billing identity — but **never** content, and
  billing identity must not be linkable to content.
- **Profile** — a person (or role) whose data lives on the device. A Subscription has **many**
  Profiles; institution subscriptions enable **1-to-many / many-to-many** data mapping across
  Profiles. The **Vault, DataPoints, DataSourceDocuments, and FormInstances all hang off a Profile.**
- **InstitutionAdmin (role, actor generalization of Individual — EXCEPT signing)** — can perform
  **every use case an Individual can, on behalf of another member's Profile** within the same
  Subscription, **with the sole exception of signing (#9 is non-delegable).** The admin selects a
  **target Profile** and fills / translates / saves / submits / shares as that member would; when a
  signature is required, the **Signee must SSO-authenticate and sign themselves**. Constraints:
  (a) the member's data reaches the admin's device only
  via the **consented E2E-encrypted import** (per the sharing ruling — no server path); (b) the admin
  may only act on Profiles they are **authorized** for; (c) every on-behalf action is **attributed
  and audited** to `(acting admin, target Profile)` in that Profile's HistoryEvents.
- **DataSourceDocument** — an uploaded reference doc (passport, licence, contract, bill) whose data
  is **auto-extracted on-device** into DataPoints. Belongs to a Profile; retained + versioned.
- **SignerIdentity** — a federated/public identity (OIDC, passkey/WebAuthn, eID/verifiable
  credential) the signer authenticates as. Binds *who signed* to a Signature.
- **Signature** — a **non-delegable** mark over a FormInstance with an explicit **method** &
  **assurance**: *Tier 1* = cryptographic self-sign (signer's own authenticator, high); *Tier 2* =
  in-person witnessed (drawn signature + live biometric, attested by an operator, lower). Never
  created on behalf of anyone; a form may carry **multiple Signatures**, each from a distinct signer.
- **BiometricCapture (Tier 2, special-category)** — a live fingerprint/thumbprint captured on-device
  (template + optional visual mark), encrypted, on-device only, consented. Bound to a Signature.
- **WitnessAttestation (Tier 2)** — the operator's SSO-authenticated, cryptographically-signed
  statement that they captured the signee's live signature + biometric over document hash H at time T.
- **DataPoint (KV pair)** — a reusable `key → value` a Profile holds (name, DOB, custom keys).
  Auto-created when a form asks for something new, OR extracted from a DataSourceDocument. Belongs
  to a Profile's **Vault**.
- **Document** — an ingested PDF (source: upload or URL). Holds the **original bytes**, language,
  editable/non-editable origin, page count, status. May **match a CatalogEntry** (by URL/fingerprint).
- **CatalogEntry (public)** — a known form in the Form Catalog: name, issuer, country, version,
  source URL, tags, kind (**PDF | DOCX | XLSX | WebForm**), blank template, **FieldMap**, fingerprint.
  Public knowledge, no user data.
- **FieldMap (public)** — the curated/crowd-sourced field layout for a CatalogEntry. For documents:
  positions + types. For **WebForm**: DOM selectors + types. Both carry canonical ontology keys.
  Downloaded to skip OCR/detection; contributed back as **structure only** (never values), consented.
- **WebFormTarget** — a live HTML form (source URL) the app autofills in-webview from the vault;
  may map to a WebForm CatalogEntry. No file bytes; values injected locally, submit goes to the site.
- **MultiPartyDocument (Transaction / Matter / Case)** — one Document assembled from several Profiles,
  coordinated by an admin. Holds a **status** (draft → gathering → assembled → circulating →
  partially-signed → fully-executed | withdrawn) and a **consent scope** (the named counterparties).
- **PartyRole** — a role in a MultiPartyDocument (Seller, Buyer, Plaintiff, Defendant, Witness…),
  cardinality **1..\***.
- **Party** — a (PartyRole, Profile) participant in a MultiPartyDocument, with per-party **consent**,
  **fill status**, and **sign status**; provides at most one Signature.
- **ProvenanceManifest** — a signed, **disclosed** record embedded in a document: doc hash, signer
  identities, **acting roles**, attestations, trusted timestamps (public/verifiable) + a **sensitive
  block encrypted to a named governing authority's key** (not ours). Vendor-unreadable; no IP; printable QR.
- **AuthorityRegistry / RegisteredRole** — a registry of Institutions & GoverningAuthorities with
  their **role + public key** (org metadata, not user content → registry server is invariant-safe).
  On SSO sign-in a party's **RegisteredRole** is asserted (from IdP claims or registry), scoping their
  capabilities and their **role-specific workflow**; each workflow step is attributed + auditable.
- **Field** — an editable region on a Document (type: text/list/check/message; name aligned to the
  ask; source: native or AI-generated). Maps to a DataPoint when autofilled.
- **Tag** — an identifier attached to a Document for search; may be vectorized.
- **Translation / LanguageView** — a chosen-language rendering of a Document for viewing/filling,
  distinct from the stored values' language at save time.
- **AnnotationLayer** — signatures, images, free-hand writing, watermark; stored **separately** but
  **linked 1:1..\*** to its Document (original + layer = one logical entity).
- **FormInstance / Version** — a filled state of a Document with the user's values; **every change
  = a new immutable Version**.
- **HistoryEvent** — a Save / Submit / Print action on a FormInstance, with counters.
- **Submission** — an online submit of a FormInstance to a URL or the hosting location.

Relationships (sketch): `Subscription 1—* Profile`, `Profile 1—* DataPoint`,
`Profile 1—* DataSourceDocument`, `DataSourceDocument 1—* DataPoint (extracted)`,
`Profile 1—* Document`, `Document 1—* Field`, `Document 1—* Tag`, `Document 1—* AnnotationLayer`,
`Document 1—* FormInstance`, `FormInstance 1—* Version`, `FormInstance 1—* HistoryEvent`,
`FormInstance 1—* Signature`, `Signature *—1 SignerIdentity`, `Field *—1 DataPoint (when filled)`.

## Constraints & assumptions

### Privacy invariant (non-negotiable — the top architectural constraint)
*No user content ever travels UP to our servers or any third party the user did not explicitly
direct it to.* This is binding and overrides every other consideration (see CLAUDE.md §1):
- **All operations on user values run ON-DEVICE:** OCR, translation, AI field-naming, tagging,
  embeddings/search, **font subsetting**, and PDF fill/export. No cloud AI touches user content.
- **Servers may only serve assets DOWNWARD** (fonts, models, updates) and never receive user
  content. Downloading a model/font/PDF is inbound and allowed; sending user data out is not.
- **Sole permitted user-data egress = "Submit online" (#7):** user-initiated, device→intended
  recipient **directly**, never proxied or stored by us, explicitly labelled as sending their data.
  (Loading a PDF *from* a URL is an inbound fetch, not user-data egress.)
- **No content telemetry/analytics/crash payloads.** The fill view renders PDFs with **scripting
  disabled and external-resource loading blocked** to prevent a malicious PDF exfiltrating values.
- **Encryption's role:** protect the vault + stored PDFs **at rest** (e.g. SQLCipher) against a
  lost/stolen device. Encryption does NOT enable cloud processing of user content — that path is
  closed regardless.
- **NO VENDOR BACKDOOR:** we never hold a key that lets us read user content or provenance.
  "Encrypted so only we can read it" is forbidden — vendor-held keys are a backdoor, not privacy.
  Authority-scoped provenance (#13) is encrypted to the *authority's* key, never ours. No covert
  trackers, no IP/network surveillance embedded in user documents.

### Fonts & AI models (on-device, lazy, coverage-bounded)
- Fonts and AI models live **on the device**: bundle a small default (Latin + user's language
  script + a base translation/OCR model), **lazy-download additional scripts/languages once and
  cache locally** — never fetch per-export. Only a **subset** of glyphs is embedded into each
  exported PDF (mandatory for correct rendering on any viewer). Font hosting / coarse per-script
  subsetting MAY be a stateless server (assets flow down only).
- **Accepted tradeoff:** "any language in the world" is bounded by what we have an on-device
  translation/OCR **model** AND an embeddable **font** for. Coverage and AI quality trail cloud
  incumbents — this is a deliberate price of the privacy invariant, not a defect.
- **Translation footprint:** the NMT **engine is small + bundled**; only **per-language-direction
  models (~15–50 MB) are lazy-downloaded and cached** for the languages a user actually uses — NOT
  the whole library. Non-English pairs may pivot via English (2 models). Optional pre-download for
  offline use.
- **Evictable asset cache:** downloaded models/fonts/catalog-templates are public + re-downloadable,
  so they auto-evict on **>~30 days unused OR storage pressure**, **except user-pinned offline
  assets**. Re-fetched when next needed (first use of an evicted asset needs network). Lossless —
  never applies to user content. Retention configurable; usage tracked on-device only.

### Platform — NATIVE cross-platform app + public Form Catalog
- ProjectPDFs is a **native, installed cross-platform app** (Tauri v2 + React/TS UI + Rust core)
  covering **Desktop + Tablet + Phone**. **All user data stays on-device; all processing runs
  on-device.** Native (not web) is chosen so there is no served-code trust gap, plus durable local
  storage, camera capture, OS secure keystore, and offline. See `docs/rfc/0001`.
- A **public Form Catalog** server holds only **public form knowledge** — metadata, source URLs,
  tags, blank templates, and curated **field-maps** — and serves it **down**. It is the fast-search
  facilitator AND the primary source of field layouts: **catalogued forms need no OCR/detection**
  (the device downloads the field-map and fills it). OCR/detection is the **fallback** for
  uncatalogued forms. Catalog **search runs on-device** (index synced down) so form-interest doesn't
  leak. The former `apps/api` + Postgres scaffold is **retired**. No server ever receives user content.
- **PDF engine** must support: reading non-editable PDFs, injecting AcroForm/widget fields,
  rendering thumbnails, layered annotations, and export in original-or-chosen language.
- Global/multilingual from day one (i18n of both UI and document content).
- Regulatory: because data stays on-device we reduce (not eliminate) GDPR/PII exposure; a
  data-classification pass is still required (`docs/security/data-classification.md`).

## Open decisions (need my input → ADR before building)

**(4) Vectorization / search — recommendation.** Prefer **vectorizing the TAGS + a short
AI-generated text summary per PDF, not the raw PDF bytes.** Rationale: tag/summary embeddings are
tiny, fast to search, language-agnostic (embed the *meaning*), and cheap to store on-device; full
per-page PDF embedding is far larger and rarely needed for "find the right form." Suggested design:
small on-device embedding model → store vectors in a **local vector index** (e.g. sqlite-vec /
SQLite VSS, LanceDB, or an embedded HNSW) alongside the metadata DB. Keep raw text extraction only
transiently for embedding; **compress and store the original PDF as-is**. Escalate to
page-level/chunked embeddings only if users need in-document semantic search later. → **ADR needed.**

**(5) Stack — DECIDED 2026-07-15/16: NATIVE cross-platform app.** Tauri v2 + React/TS UI + Rust core
(Win/macOS/Linux/iOS/Android); on-device engines (pdf.js/pdfium, ONNX/PaddleOCR OCR **fallback**,
NMT translation, embeddings); SQLite+SQLCipher + OS keystore. Web/PWA rejected (served-code trust).
Formalize as ADR-0002. **Validate Tauri v2 mobile bindings (pdfium/onnxruntime) with an early spike.**

**(11) Public Form Catalog — ADDED 2026-07-16.** A server of **public form knowledge only**
(metadata, tags, blank templates, curated field-maps, fingerprints), served DOWN. **Covers both
document forms AND live web forms:** each entry has `kind` = PDF | DOCX | XLSX | WebForm, and the
FieldMap is polymorphic — **positions/anchors** for documents, **DOM selectors (CSS/XPath) + URL
pattern** for web forms. Catalogued forms skip OCR/detection (documents) or autofill via selectors
(web forms); search runs on-device (index synced). Contributions are structure-only, consented.
Formalize as ADR-0005. See `docs/rfc/0001`.

**(9) Federated signing.** Standards to pick: OIDC/OAuth + **passkeys/WebAuthn** as the baseline;
eID / verifiable credentials where available. Only identity assertions exchanged (never content).
Offline → local self-signed fallback without the federated guarantee. → **ADR needed.**

**(10) Institutional cross-person / cross-device data movement — DECIDED 2026-07-15.**
**Ruling: user-directed E2E-encrypted export/import ONLY.** A person exports an encrypted bundle;
the institution imports it. **No server ever touches the data — not even ciphertext. No relay,
no device-to-device server brokering.** This keeps the invariant absolute (nothing transits our
servers, encrypted or otherwise). Direct local-network P2P sync MAY be added later as pure
device-to-device (no server) but is not required for V1. Zero-knowledge relay is **rejected**.
→ formalize as ADR; architecture must assume no content-bearing server path exists.

## Glossary
| Term | Meaning |
|---|---|
| Vault | The user's on-device store of reusable KV data points. |
| DataPoint / KV pair | A reusable `key → value` (e.g. `date_of_birth → 1990-01-01`). |
| Field | An editable region on a PDF (text/list/check/message box). |
| Native / non-editable PDF | A PDF with no form fields (often scanned); must be made fillable. |
| Field-name alignment | AI naming a generated field to match the form's actual question. |
| LanguageView | A translated rendering of a PDF for viewing/filling in the user's language. |
| AnnotationLayer | Separately-stored signatures/images/handwriting/watermark linked to the original PDF. |
| Profile | A person/role whose vault + docs live on the device; many per Subscription. |
| Subscription / Tenant | Billing account (individual/family/institution) owning Profiles. |
| DataSourceDocument | An uploaded reference doc (passport, licence…) auto-extracted into DataPoints. |
| SignerIdentity | Federated/public identity (OIDC/passkey/eID) binding who signed. |
| Version | An immutable snapshot created on every data modification of a form. |
| HistoryEvent | A Save / Submit / Print action, with counters. |
| Local-first | User data is stored only on the user's device, never server-side. |
