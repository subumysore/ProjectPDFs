# Business Requirements Document (BRD)

The **canonical** requirements. Every requirement has a stable id `REQ-NN.M` (or `REQ-NN-UI.M` for UI).
Status lives in the traceability matrix, not here. Requirements derive from the vision pillars in
`memory-bank/projectBrief.md`; the architecture is `docs/rfc/0001` + ADR-0002…0010.

**Global invariant (applies to every requirement):** no user content leaves the device (CLAUDE.md §1).

---

## REQ-01 — Reusable data vault & autofill
### REQ-01.1 — On-device vault with catalog-first autofill
**Statement.** As a user, I want my reusable data points (name, DOB, address…) stored on-device and
auto-filled into forms so I stop re-typing them.
**Acceptance criteria.**
- [ ] GIVEN a Profile vault WHEN a catalogued form is opened THEN each field is filled from the vault
  by ontology key; missing keys are flagged to add.
- [ ] Vault persists locally (encrypted at rest in production) and upserts by key.
**Security/privacy.** Vault = user PII, on-device only.
**Solution Implemented.** `core-store` (SQLite vault, upsert, `vault()`), `core-catalog::autofill`;
app command `demo_autofill`; unit tests in both crates. (Encryption-at-rest + real Profiles pending.)

## REQ-02 — Make any form fillable
### REQ-02.1 — Catalog-first field maps, OCR/detection fallback
**Statement.** As a user, I want non-editable PDFs made fillable — instantly for known forms, via
on-device OCR/detection otherwise.
**Acceptance criteria.**
- [ ] GIVEN a catalogued form THEN its field-map is used with no OCR.
- [ ] GIVEN an unknown form THEN on-device OCR + CV detection produce editable fields (assisted).
**Security/privacy.** OCR runs on-device; documents never leave.

## REQ-03 — Any-language translated fill
### REQ-03.1 — Native-language working view + original/chosen output
**Statement.** As a user, I want a foreign form shown in my language, filled locally, and exported in
the original or my language. **Security/privacy.** On-device NMT; values never sent out.

## REQ-04 — Auto-tagging & searchable catalog
### REQ-04.1 — Tags + on-device index
**Statement.** As a user, I want forms auto-tagged and searchable on-device. **Privacy.** Search index
synced down; queries never leave.

## REQ-05 — Local-first cross-platform app
### REQ-05.1 — Native app (Desktop/Tablet/Phone), all data on-device
**Statement.** As a user, I want an installed app across my devices with all data on-device.
**Solution Implemented.** Tauri v2 + Rust core + React/TS (`apps/app`); desktop build produces
`app.exe`; UI↔core bridge working. (Mobile spike + iOS pending.)

## REQ-06 — AI search bar
### REQ-06.1 — Filtered results with name, tags, thumbnail. **Privacy.** On-device.

## REQ-07 — Save & submit
### REQ-07.1 — Save locally; submit direct to vendor (no proxy), HTTP warned.

## REQ-08 — History, versioning & annotation
### REQ-08.1 — Immutable versions; save/submit/print counters; layered signatures/handwriting/watermark.

## REQ-09 — Authenticated signing (non-delegable)
### REQ-09.1 — SSO/passkey self-sign (Tier 1) + in-person biometric witnessed (Tier 2); nobody signs
on behalf of another.

## REQ-10 — Data-source extraction & profiles
### REQ-10.1 — Extract KV from passport/licence on-device; Profiles + Subscriptions (family/institution).

## REQ-11 — Fill forms wherever they live
### REQ-11.1 — Web-hosted file auto-download (native, no CORS) + live web-form autofill in-webview.

## REQ-12 — Multi-party documents
### REQ-12.1 — One document from several Profiles (Seller/Buyer, Plaintiff/Defendant); per-party consent
+ signature; re-sign on edit.

## REQ-13 — Verifiable provenance (authority-scoped)
### REQ-13.1 — Disclosed signed manifest + printable QR; sensitive block encrypted to a named authority
(never us). No vendor backdoor, no IP surveillance, no covert beacon.

## REQ-14 — Registered roles & verifiable workflows
### REQ-14.1 — Authority/Institution registry; role asserted on SSO; role-scoped, auditable workflows.

<!-- Copy a REQ-NN.M block for each new requirement. Keep ids stable and sequential per group. -->
