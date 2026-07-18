# RFC-0005: Offline signed licensing

- **Status:** Accepted — implemented (2026-07-18)
- **Author(s):** ProjectPDFs team
- **Created:** 2026-07-18
- **Related:** REQ-17.1; produced ADR-0015; privacy invariant.

## Summary
Monetize via a freemium model whose Pro/Team entitlements are carried in an **offline,
Ed25519-signed license token** verified on-device — no activation server, no phone-home,
consistent with "nothing leaves your device."

## Detailed design
`core-license`: `issue(license, keypair)` (vendor-side) → `PPDF1.<b64(json)>.<b64(sig)>`;
`verify(token, vendor_public, now)` (app-side) checks signature + expiry and returns the
`License { subject, tier, features, issued_at, expires_at }`; `License::has(feature)` gates
features. The app embeds only the vendor public key.

## Tiers (proposed)
- **Free:** core autofill, 1 profile, basic PDF fill.
- **Pro:** multi-profile, DOCX/XLSX, OCR make-fillable, translated-fill, signing, companion.
- **Team/Institutional:** multi-party documents + registered roles/workflows.

## Alternatives / risks
Online activation rejected (phone-home). Offline tokens can't be revoked mid-term → use
reasonable expiries + reissue; protect the signing key (HSM). Local clock rollback bounded by
expiry windows.

## Rollout
Crate + tests done. Next: `verify_license` command + Settings import UI; embed the real vendor
public key at build; gate Pro features on `License::has`.

> When accepted, record the outcome as an ADR and link it here. → ADR-0015.
