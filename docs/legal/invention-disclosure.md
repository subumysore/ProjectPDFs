# Invention Disclosure — PolyglotFormFill

> Working document for a patent attorney's novelty/prior-art assessment. Not a patent
> application. Keep confidential (trade secret) until a filing strategy is decided. Inventor:
> Subramanya Mysore. Date of first reduction to practice: 2026-07 (see git history).

## Field
On-device (privacy-preserving) automated form understanding and filling across document types
(PDF, Office, web/HTML) and natural languages.

## Invention 1 — Context-aware, form-shape-driven field resolution ("combine/split")
**Problem.** A user's stored data atoms (e.g., `first`, `middle`, `last`; `street1`, `street2`,
`city`, `state`, `zip`) rarely match a form's field granularity. Existing autofill maps a field
label to a single stored key; it fails when the form is coarser (one "Name" or "Address" box) or
finer (a one-character "Middle Initial") than the stored data.

**Method (novel).** A two-pass resolver that, *without per-form rules or a rules engine*:
1. Resolves each form field to a concept via a general identity ontology + a token-overlap score
   that rewards phrase specificity (so "first name" beats generic "name").
2. Computes, from the *set of fields the form actually exposes*, which atomic concepts are
   "claimed" by a dedicated field.
3. Fills a **composite** field (e.g., a lone "Address" or "Full name") by joining exactly the
   member atoms **not claimed** by any more-specific field present — so one Address line absorbs
   street+city+state+zip, but collapses to street-only when the form *also* has City/State/Zip.
4. Applies general value **derivations** triggered by the form itself (e.g., emit an initial when
   the field says "initial" or has `maxlength=1`) rather than by hardcoded per-field rules.

**Novelty hooks.** The decision of what a coarse field absorbs is a *function of the form's field
inventory*, computed at fill time; derivations are driven by form-declared constraints. Runs
fully on-device.

## Invention 2 — Non-delegable, device-bound signing & offline licensing
**Method.** A signature/authorization scheme where the signing key is derived from a hardware
authenticator's PRF secret (WebAuthn) that exists only when the hardware is present, making the
capability **non-delegable** (no other party or software update can produce the signature); and a
companion **offline license** token (Ed25519) bound to a per-install device identifier and
verified locally with no activation server or network call. (See ADR-0004, ADR-0011.)

**Novelty hooks.** Combination of PRF-derived non-extractable keys with device-bound offline
license verification to deliver paid, per-device entitlement while guaranteeing zero runtime
egress.

## Invention 3 (candidate) — On-device polyglot fill pipeline
Reading a form in one language, translating labels for the user's comprehension, capturing the
user's answers in a base language, and writing them back **in the form's original language**,
entirely on-device (self-hosted NMT), with a downloadable/removable per-language-pair model
manager. (See RFC-0006.)

## Prior art to search (attorney)
Browser autofill (Chrome/1Password/Dashlane), Adobe Acrobat form field detection, OCR form
extraction, WebAuthn PRF key derivation, offline software licensing (Ed25519 tokens), on-device
NMT (Bergamot/Firefox Translations, transformers.js).

## Jurisdiction note
India (§3(k) Patents Act) generally excludes "computer programme per se"; a claim likely needs a
demonstrable technical effect. The US (post-*Alice*) may allow method claims if not "abstract." A
low-cost **US provisional** is a reasonable first step to secure priority while assessing.
