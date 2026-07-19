# Monetization & Licensing

How PolyglotFormFill gets paid **without breaking the privacy model** (no runtime server,
no phone-home). Payment + license issuance happen on the storefront side; the app only ever
**verifies** a signed token offline.

## Pricing (launch)
| Tier | Price | Notes |
|---|---|---|
| Free | $0 | core web-form autofill, **1 profile**, 1 device, basic PDF fill |
| Pro | **$39 one-time / device** (or $19/yr) | **up to 3 profiles**, 1 device, make-fillable OCR, Word/Excel, translation, signing, backup |
| Family | **$79 one-time**, up to 5 devices (or $39/yr) | **unlimited profiles**, Pro across the household |

**Profile limits** are enforced at launch by the app (`create_profile` checks the active license
tier: free=1, pro=3, family=unlimited). Free during beta = unlocked.

Free during public beta; prices take effect at launch. USD; local taxes handled by the MoR.

## Payment processor — recommendation: **Lemon Squeezy** (or Paddle)
Both are **Merchants of Record**: they collect payment and **handle global VAT/GST/sales tax,
invoicing, and refunds** on your behalf — essential for a solo India-based seller going global.
Raw Stripe leaves all tax/compliance to you. Pick one, create an account (only you can), add the
Pro / Pro-annual / Family products.

## License architecture (offline, device-bound — ADR-0011)
- **Keypair (one-time):** `node scripts/license/keygen.mjs` → prints the vendor **public** key
  (embed in `apps/app/src-tauri/src/lib.rs` `VENDOR_PUBLIC`) and writes the **private** key to
  `scripts/license/vendor-key.json` (**gitignored — never commit**).
- **Token:** `PPDF1.<b64url(json)>.<b64url(ed25519-sig)>`, signed by the private key, carrying
  `{subject, tier, features, issued_at, expires_at, device_id}`. Verified fully offline by
  `core_license::verify_on_device` against the embedded public key + this machine's device id.
- **Per-device binding:** the buyer copies their **device id** (shown in the app's "This device"
  line) into a checkout **custom field**; the webhook signs a token bound to it. Multi-device
  orders pass a comma-separated list → one token per device.

## Purchase → activation flow
1. User installs the app → sees **This device: `<id>`** in the Backup/License panel.
2. User buys on the Lemon Squeezy checkout, pasting the device id into the custom field.
3. **Webhook** (`scripts/license/webhook.mjs`) fires on `order_created`: verifies the LS
   signature, signs a device-bound token via `sign.mjs`, and **emails it** to the buyer
   (wire your email step at the `TODO` marker; or store for them to fetch).
4. User pastes the token into **Activate** → `set_license` verifies + stores it → Pro unlocked.
   No network call at any point after purchase.

## Deploying the webhook
It only issues licenses (never touches user content), so it's fine as a small serverless
function — **Vercel**, **Cloudflare Worker**, or a pod on the existing OKE cluster. Set env
`LS_WEBHOOK_SECRET` to the Lemon Squeezy signing secret. Local test:
`LS_WEBHOOK_SECRET=… node scripts/license/webhook.mjs --serve` (listens on :8787).

## Manual issuance (support / comps)
`node scripts/license/issue.mjs --subject a@b.com --tier pro --device <id> --days 0`

## What still needs YOU (business decisions, not code)
1. Create the **Lemon Squeezy/Paddle** account + products (identity-bound to you).
2. Run `keygen.mjs` for **production** and replace `VENDOR_PUBLIC`; safeguard `vendor-key.json`.
3. Deploy the webhook + wire the email delivery step.
4. Paste the real checkout URLs into the pricing page buttons.

## Tested
`scripts/license` end-to-end: keygen → issue → **Rust verify OK** (right device) / **rejected**
(wrong device); webhook signature verified, token device-bound and Rust-verifiable, bad
signature → 401.
