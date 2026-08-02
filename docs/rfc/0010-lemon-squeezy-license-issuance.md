# RFC-0010: Selling licenses via Lemon Squeezy (merchant-of-record → offline token issuance)

- **Status:** Draft
- **Author(s):** PolyglotFormFill team
- **Created:** 2026-07-25
- **Related:** REQ-17.1; RFC-0005 (offline signed licensing); ADR-0015 (offline license, no activation server); ADR-0011 (per-device offline licensing); privacy invariant (CLAUDE.md); no-budget-until-revenue. Will produce a new ADR (proposed ADR-0025) once accepted.

## Summary
Sell PolyglotFormFill Pro/Family/Team licenses through **Lemon Squeezy (LS)**, a merchant-of-record,
while keeping the existing **offline** licensing model unchanged. LS hosts checkout (no card data ever
touches us), then fires a webhook to a tiny stateless **license-issuer** endpoint. The issuer holds the
vendor Ed25519 **private** key server-side, mints a device-bound `PPDF1.<b64(json)>.<b64(sig)>` token in
the **existing** `core-license` format, and delivers it to the buyer. The user pastes the token into the
app, which verifies it **on-device** against the embedded vendor public key — no activation server, no
phone-home. No user form content or vault data is ever involved: this is purely a signed entitlement.

## Motivation
`core-license`, the app-side import/verify commands, and the signing scripts already exist (RFC-0005 /
ADR-0015; `crates/core-license`, `scripts/license/*`, `set_license`/`license_status` Tauri commands).
What's missing is the **commerce wiring**: a storefront that collects payment + handles global VAT/GST,
and an automated path from "payment cleared" to "buyer holds a signed token." We need revenue, and as a
solo India-based seller selling worldwide, tax/compliance must not fall on us.

**Why a merchant-of-record, and why LS specifically:** an MoR is the legal seller of record — it collects
payment and **remits VAT/GST/sales tax and issues invoices** on our behalf. LS has **no upfront/monthly
cost** (per-sale fee only, ~5% + 50¢ at time of writing), which fits *no-budget-until-revenue*: zero fixed
cost, pay only when we earn. Raw Stripe would leave all global tax compliance to us. Paddle is an
equivalent MoR fallback; the design below is processor-agnostic except for the webhook payload shape.

**Privacy fit (the invariant test):** could this let us — or any third party — see, store, or receive user
content? No. LS only ever receives the buyer's payment + email (which they, not us, are the merchant for)
and a device id the user pastes in. The issuer receives only that order metadata and emits a token. The
app sends nothing at any point. This is squarely within the invariant: the only "egress" is LS's own
checkout, which the user initiates and directs, and it carries no form/vault content.

## Detailed design

### Token format (unchanged — reused verbatim)
`core-license` tokens are `PPDF1.<base64url(json)>.<base64url(ed25519_sig)>` where the JSON is
`{subject, tier, features, issued_at, expires_at, device_id}` in that exact field order (the Rust
`License` struct). Signed by the vendor Ed25519 private key; verified by
`core_license::verify_on_device(token, VENDOR_PUBLIC, now, device_id)`. `expires_at = 0` is perpetual.
`device_id` empty = valid on any device. **This RFC adds no new token fields or crypto.**

### Purchase → license flow (preserves the offline model)
1. **App shows the device id.** The app's License panel already renders `This device: <id>` (Tauri
   `device_id` command). The "Buy" button builds an LS checkout URL injecting it:
   `https://<store>.lemonsqueezy.com/checkout/buy/<VARIANT_ID>?checkout[custom][device_id]=<DEVICE_ID>`.
2. **Buyer checks out on LS-hosted checkout.** Card data touches LS only. LS handles tax + invoicing.
3. **LS fires a signed webhook** (`order_created`, plus subscription events for annual tiers) to the
   issuer. `meta.custom_data.device_id` carries the device id(s); `attributes.user_email` the buyer.
4. **Issuer verifies the HMAC, then mints token(s)** via the existing `signLicense()` (`scripts/license/sign.mjs`)
   — one device-bound token per device id (comma-separated list → multi-device orders), or one unbound
   token if none supplied. Subscription tiers get `expires_at = issued_at + 366d`; one-time buys perpetual.
5. **Delivery to the buyer:** email the token(s) (delivery step marked `TODO` in `webhook.mjs`) and/or
   surface via the LS order confirmation. (LS's built-in "License keys" feature stays **OFF** — we issue
   our own signed tokens, not LS random keys.)
6. **User pastes/imports the token** into the app → `set_license` runs `verify_on_device` (signature +
   expiry + device binding) BEFORE storing to `license.token`. Pro features gate on `License::has(...)`.
   Zero network calls after purchase.

### The license-issuer (the ONLY server piece)
A stateless function that does exactly one thing: verify an LS webhook and mint a token. It is the
framework-agnostic `handleWebhook(raw, signature, opts)` core in `scripts/license/webhook.mjs` (a thin
`--serve` HTTP wrapper is included for local/pod use; serverless platforms call the core directly).

**Owner provisioning checklist (owner-only steps — I cannot do these; they are identity/account bound):**
1. **Create the LS store** (Settings → Stores) — approval can take a day. Note the **Store ID**.
2. **Create Products + variants** matching the pricing tiers (paste-ready copy in
   `docs/business/lemonsqueezy-setup.md`): Pro **$39** one-time, Pro Annual **$19/yr**, Family **$79**
   one-time; optionally Team **$29**/Business **$24**/Scale **$19** per-seat/yr. Leave **License keys = OFF**
   on every product. Note each **Variant ID** (used in checkout URLs).
3. **Get the webhook signing secret + (optional) API key**: Settings → Webhooks → add endpoint (the
   deployed issuer URL), subscribe to `order_created` and the subscription events
   (`subscription_created`, `subscription_payment_success`, `subscription_payment_refunded`,
   `order_refunded`, `subscription_cancelled`, `subscription_expired`). Copy the **signing secret** →
   set as env `LS_WEBHOOK_SECRET` on the issuer. An API key (Settings → API) is only needed if we later
   automate price reads.
4. **Generate the PRODUCTION vendor keypair**: `node scripts/license/keygen.mjs` → replace `VENDOR_PUBLIC`
   in `apps/app/src-tauri/src/lib.rs` and `VENDOR_PUBLIC_HEX` in `apps/extension/src/license.js` with the
   printed public key; keep `vendor-key.json` (private) **off git** and mount it as the issuer's secret.
5. **Deploy the issuer** (see hosting) with `LS_WEBHOOK_SECRET` + the private key mounted; wire the email
   delivery step; paste the real checkout URLs into the pricing page buttons.

### Recommended issuer hosting
**Recommended: a tiny pod on the existing OKE cluster** that already hosts the site
(`polyglotformfill.com`, `publish-site.ps1`). Rationale for *no-budget-until-revenue*: zero new
account/vendor, the cluster is already paid for, and secret handling (the private key + `LS_WEBHOOK_SECRET`)
uses Kubernetes Secrets we already operate. The issuer is stateless and trivially small.
**Fallback: a Cloudflare Worker or Vercel function** (both free-tier, no fixed cost) if we'd rather keep
the issuer off the cluster; the same `handleWebhook` core runs there with the private key in an encrypted
env var. Either way the issuer does **nothing but** mint tokens — it never receives user content.

### Webhook security, idempotency, refunds
- **HMAC verification:** LS signs each webhook with the store secret; the issuer computes
  `HMAC-SHA256(raw_body, LS_WEBHOOK_SECRET)` hex and compares to the `X-Signature` header in constant
  time (`timingSafeEqual`). Bad/absent signature → **401, no token**. The secret is read at call time
  (not import time) so it can be injected at deploy.
- **Idempotency:** LS retries deliveries. The issuer dedupes on the event/resource id via an injectable
  `seen` store (in-memory default; pass a Redis/KV in production) so a retry never mints a second token.
- **Refunds / chargebacks / cancellations:** offline tokens **cannot be remotely revoked** mid-term (the
  known trade-off from ADR-0015). Mitigations: (a) subscription tiers carry a **366-day expiry** so a
  non-renewed/cancelled sub lapses on its own; (b) refund/cancel events mint **no** token and return a
  `{revoke:true}` signal so the delivery layer does not (re)send; (c) perpetual one-time refunds are a
  rare support-desk matter (comps/blocklist), acceptable at low volume. Local clock rollback stays bounded
  by expiry windows, as in ADR-0015.

### App-side mapping (mostly already built)
The traceability row REQ-17.1 says "Verify command + import UI pending" — that is now **stale**: the app
ships `license_status` + `set_license` Tauri commands (`apps/app/src-tauri/src/lib.rs`), the License tab +
`activateLicense()` paste-and-import UI (`apps/app/src/App.tsx`), and the extension verifier
(`apps/extension/src/license.js`). **Remaining app-side work:** (1) add a "Buy" button that builds the LS
checkout URL with the injected device id; (2) embed the **production** `VENDOR_PUBLIC` after prod keygen;
(3) confirm every Pro feature actually gates on `License::has(...)`; (4) update the REQ-17.1 traceability
row to reflect the shipped import UI.

## Alternatives considered
- **LS built-in license keys** — rejected: they're opaque random strings LS validates via *their* API
  (a phone-home), incompatible with our offline Ed25519 verification. We keep License keys OFF and mint
  our own signed tokens.
- **Raw Stripe / Paystack** — rejected as primary: not a merchant-of-record, so global VAT/GST compliance
  falls entirely on a solo seller. Paddle kept as an MoR fallback (same flow, different webhook shape).
- **Online activation server** — rejected by ADR-0015 (phone-home; violates the invariant).

## Risks & trade-offs
- **No mid-term revocation** (accepted; mitigated by expiries + refund handling above).
- **Private-key handling** is the crux: the vendor private key must live ONLY on the issuer (K8s Secret /
  encrypted env), never in git (`vendor-key.json` is gitignored), never in the app. Compromise = ability
  to mint licenses; rotate by re-keygen + shipping a new `VENDOR_PUBLIC` in an app update (invalidates
  old tokens — reissue to paying customers).
- **Processor lock-in** is light: only the webhook payload parsing is LS-specific.
- **Cost/reversibility:** zero fixed cost; can switch MoR or hosting without touching the token format.

## Rollout & migration
1. Owner runs the provisioning checklist (store, products, secret, prod keygen).
2. Deploy the issuer to OKE (or a Worker) with secrets; wire email delivery.
3. Embed prod `VENDOR_PUBLIC`; add the Buy button; ship an app update.
4. Soft-launch with Pro + Family; add seat tiers later. Free stays free during beta.
5. Record the outcome as an ADR (proposed ADR-0025) and link it here.

## Open questions
- Email delivery mechanism for the token (transactional email vendor vs. a fetch-your-token page)?
- Family multi-device UX: collect all device ids at checkout, or issue a redeemable order code the buyer
  exchanges per-device later?

> When accepted, record the outcome as an ADR and link it here.
