# Runbook — license issuer & production signing key

## Production signing key — SETTLED (do NOT regenerate)
The Ed25519 vendor keypair in `scripts/license/vendor-key.json` **is the production key.** Its public key
is already embedded, byte-for-byte identical, in every shipped artifact:

- Desktop app — `apps/app/src-tauri/src/lib.rs` `VENDOR_PUBLIC` (shipped in **v1.0.1**).
- Extension — `apps/extension/src/license.js` `VENDOR_PUBLIC_HEX` = `122609890356e1440e4b10c7dc29d3c9dfbaed880979488fdb3c6cd0ef128c37` (shipped in **v1.0.3**, in review).
- `vendor-key.json` `publicHex` (the issuer signs with the matching private key `jwk.d`).

**Therefore we do NOT generate a new production key.** Regenerating would change the public key and make
every license the issuer signs fail to verify on the already-shipped app + extension — and the extension
can't be republished while v1.0.3 is in Google review. The existing key was generated the same way, is a
valid Ed25519 keypair, and has **never been committed** (`vendor-key.json` is git-ignored).

### ⚠ CRITICAL — back up `vendor-key.json` NOW
It exists **only** on the build machine and is git-ignored. If it is lost, licenses can never again be
signed for the public key that shipped in v1.0.1 / v1.0.3 — you'd have to rebuild and re-release both apps
with a new key. Back it up to a password manager / encrypted vault you control. Do **not** commit it, email
it, or upload it anywhere. (I deliberately did not move or copy it — a private key must not be distributed.)

## Issuer (webhook) — deploy plan (execute when LS is approved / to test)
Code: `scripts/license/webhook.mjs` (HMAC-verify the LS webhook → `signLicense` from `sign.mjs` → return
device-bound token). Pure Node, no Rust dependency. Runs standalone with `--serve` on :8787.

1. **Host** a tiny pod on the OKE cluster (mirrors `deploy/k8s/site.yaml`): a `node:20-slim` Deployment
   mounting `webhook.mjs`/`sign.mjs`/`vendor-key.json` via a Secret+ConfigMap, a Service, and an Ingress
   with cert-manager TLS at e.g. `https://issuer.polyglotformfill.mooo.com/webhook`.
2. **Secrets:** `LS_WEBHOOK_SECRET` (from LS → Settings → Webhooks when you add the endpoint) and the
   private key (mount `vendor-key.json` as a K8s Secret — never in the image).
3. **Register** the endpoint in LS → Settings → Webhooks; subscribe to `order_created` + subscription
   events. LS's own "License keys" feature stays **OFF** (we mint our own token).
4. **Delivery (the one unbuilt piece — a product decision):** `webhook.mjs` mints the token but the
   delivery step is a `TODO`. Options:
   - **In-app claim (zero cost, recommended):** issuer stores the token keyed by order/email; a small
     hosted `/claim` page (linked from the LS order-confirmation) shows the token to copy → buyer pastes
     it into the app's License panel. No email service, no per-message cost.
   - **Email the token:** needs an email sending service (external, may cost) — defer per "no budget until revenue".
5. Paste the real checkout URLs (with `checkout[custom][device_id]`) into the pricing-page Buy buttons and
   flip `docs/business/ls-config.json` `live: true`, then republish the site.

## Status (2026-07-28)
- Production key: ✅ settled (existing key, consistent across app + extension + issuer). No rebuild needed.
- Store: ⏳ LemonSqueezy is **reviewing the merchant application** (Test mode still on). Payouts + live
  checkout turn on only when LS approves — external, not code.
- Issuer: not yet deployed (awaits the delivery decision above + the LS webhook secret, which needs the
  endpoint URL registered — doable in LS test mode to validate end-to-end before go-live).
