# ADR-0025 — Stripe as the payment processor (superseding Lemon Squeezy for go-live)

- Status: Accepted
- Date: 2026-07-28
- Supersedes the Lemon Squeezy provisioning path (commits f55b105, cdab039, 41310ad) for revenue go-live.
  Those artifacts (`docs/business/ls-config.json`, `scripts/license/webhook.mjs`) are retained for reference
  but are no longer wired into the site or the issuer.

## Context
We are ready to sell but the Lemon Squeezy (merchant-of-record) store stayed in *pending merchant approval*
(Test mode) with no committed timeline, blocking all real charges. The owner needs to onboard immediately.
The owner's Stripe account (`acct_1KoDEkFWVcXPDpjx`, US/USD) is already fully onboarded:
`charges_enabled`, `payouts_enabled`, `details_submitted` all true, and **Stripe Tax is active**.

## Decision
Use **Stripe** as the payment processor for launch. The owner is the merchant of record (owns sales-tax/VAT
remittance); Stripe Tax computes and collects tax automatically at checkout, which is acceptable for a US sole
proprietor at launch scale.

Provisioned entirely against the live account (all NON-secret ids in `docs/business/stripe-config.json`):
- **Products/prices** — Pro $19 one-time, Duo $29 one-time, Business $29/seat/yr subscription
  (adjustable quantity 1–19), tax code `txcd_10202003` (downloadable software), tax_behavior `exclusive`.
- **PPP** — coupons `ppf-ppp-{10..65}` + promotion codes `PPP{band}`; the site's region script appends
  `?prefilled_promo_code=PPP<band>` to the Payment Link so the shown price equals the charged price
  (identical UX to the previous LS discount-code approach).
- **Checkout** — hosted **Payment Links** (no server, no card data touches us) with a `device_id` custom
  field, `automatic_tax`, promotion codes enabled, and an `after_completion` redirect to
  `…/issuer/claim?session={CHECKOUT_SESSION_ID}`.

## License delivery (unchanged model, Stripe source)
The **zero-storage claim** (ADR precedent: no PVC/DB — re-mint on demand) is preserved. The issuer now:
- `GET /claim?session=cs_…` — fetches the **paid Stripe Checkout Session** (expanded to the product's
  `ppf` metadata), re-mints the Ed25519 token (`sign.mjs`, same production key — no key change, so every
  already-shipped app/extension keeps verifying), binds it to the `device_id` if supplied, and shows it.
  The unguessable `cs_…` id is the proof of purchase; an optional email field is an extra check.
- `POST /webhook` — verifies the `Stripe-Signature` (HMAC over `${t}.${raw}`, 5-min replay window,
  `scripts/license/stripe-webhook.mjs`) and 200-acks; refunds/disputes are surfaced, not minted.

## Privacy invariant
Unaffected. The issuer sees only email + Stripe session id + tier + optional device id — **never any user
FORM content**. Payment Links mean no card data reaches our infrastructure. No user-content egress is added.

## Consequences
- (+) Live today; no third-party approval gate. (+) Stripe Tax handles tax. (+) No card data liability.
- (−) Owner is merchant of record → responsible for tax registration/remittance as thresholds are crossed
  (Stripe Tax monitors and warns). (−) Two payment codebases exist transiently; LS files are dormant.
- The production signing key is **unchanged** — this is a storefront/issuer swap only, invisible to shipped apps.

## Follow-ups
- Retire the dormant LS artifacts once Stripe is proven in production (a later cleanup commit).
- App-side license-panel "device id" display + activation remains the open item (traceability REQ-17.1).
