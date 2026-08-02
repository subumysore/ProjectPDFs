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

## PAYMENTS ARE ON STRIPE (current — 2026-07-28, ADR-0025)
Lemon Squeezy stayed in pending-merchant-approval (Test mode) with no timeline, so payments went live on
**Stripe** instead (owner = merchant of record; **Stripe Tax active**). The LS sections below are
**superseded/dormant** (kept for reference only).

- **Account:** `acct_1KoDEkFWVcXPDpjx` (US/USD, charges+payouts enabled).
- **Products/prices/PPP/links:** all NON-secret ids in `docs/business/stripe-config.json`. Provisioned via the
  Stripe API against the live account: Pro $19 / Duo $29 one-time, Business $29/seat/yr (adjustable 1–19),
  PPP coupons `ppf-ppp-{10..65}` + promo codes `PPP{band}`, three hosted **Payment Links** with a `device_id`
  custom field + automatic tax + redirect to `…/issuer/claim?session={CHECKOUT_SESSION_ID}`.
- **Issuer (Stripe):** `scripts/license/issuer-server.mjs` (fetches the paid Checkout Session, re-mints from
  the product's `ppf` metadata) + `scripts/license/stripe-webhook.mjs` (verifies `Stripe-Signature`). Same
  production signing key — no app/extension change needed. Deployed to OKE (`deploy/k8s/issuer.yaml`,
  code-rev 2). Secret `issuer-secrets` carries `vendor-key.json` + `STRIPE_API_KEY` + `STRIPE_WEBHOOK_SECRET`.
- **Webhook:** endpoint `we_1TyEIMFWVcXPDpjxlJJjlOR5` → `…/issuer/webhook`
  (checkout.session.completed, charge.refunded, charge.dispute.created, customer.subscription.deleted,
  invoice.paid). Signing secret is in the K8s secret only.
- **Secrets live ONLY in:** the build machine's `STRIPE_API_KEY` user env var + the K8s `issuer-secrets`.
  Never in git. `STRIPE_WEBHOOK_SECRET` was captured at endpoint-creation to the session scratchpad and applied.
- **Redeploy the issuer after a code change:**
  `kubectl -n polyglotformfill create configmap ppf-issuer-code --from-file=scripts/license/issuer-server.mjs
   --from-file=scripts/license/stripe-webhook.mjs --from-file=scripts/license/sign.mjs --dry-run=client -o yaml
   | kubectl apply -f -` then bump `ppf/code-rev` in `issuer.yaml`, `kubectl apply -f deploy/k8s/issuer.yaml`,
  `kubectl -n polyglotformfill rollout restart deploy/ppf-issuer`.
- **Live-endpoint smoke test:** `/issuer/healthz`→ok, `/issuer/claim`→form 200, `?session=cs_bogus`→404,
  POST `/issuer/webhook` bad sig→400. (All verified 2026-07-28.)
- **Go-live wiring done:** `stripe-config.json` `live:true`; site rebuilt (26 langs) with Buy buttons →
  Payment Links + auto-PPP. **Deploy step (owner-run, outward-facing):** `deploy/k8s/publish-site.ps1`.
- **End-to-end validation still to do (owner):** make one real (or a $19 low-risk) purchase → land on the
  claim page → token appears → paste into the app → activates. Then Stripe Dashboard shows the payment + tax.

---
## [SUPERSEDED — Lemon Squeezy] Issuer (webhook) — deploy plan
Code: `scripts/license/webhook.mjs` (HMAC-verify the LS webhook → `signLicense` from `sign.mjs` → return
device-bound token). Pure Node, no Rust dependency. Runs standalone with `--serve` on :8787.

1. **Host** a tiny pod on the OKE cluster (mirrors `deploy/k8s/site.yaml`): a `node:20-slim` Deployment
   mounting `webhook.mjs`/`sign.mjs`/`vendor-key.json` via a Secret+ConfigMap, a Service, and an Ingress
   with cert-manager TLS at e.g. `https://issuer.polyglotformfill.com/webhook`.
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

## Deployed state (2026-07-28)
- **Issuer is LIVE** on the OKE cluster: `deploy/k8s/issuer.yaml` (Deployment/Service/Ingress) +
  ConfigMap `ppf-issuer-code` (the 3 runtime files) + Secret `issuer-secrets` (private `vendor-key.json`,
  `LS_WEBHOOK_SECRET`, `LS_API_KEY`). Reachable at `https://polyglotformfill.com/issuer/{healthz,claim,webhook}`.
- **Zero-cost claim delivery**: `scripts/license/issuer-server.mjs` re-mints the token from the paid LS
  order (verified via LS API + email match) — NO database / PVC / block-volume cost. Tests 9/9.
- **LS webhook registered**: id `122362`, 6 events, secret matches the K8s secret. (Test mode for now.)

## Remaining to actually SELL (go-live)
1. **LS approves the merchant application** — external; Test mode still on. Until then real cards aren't
   charged and payouts don't run.
2. Wire the pricing-page **Buy buttons → LS checkout URLs** (inject `checkout[custom][device_id]`) and set
   each product's **confirmation redirect** to `…/issuer/claim?order={order_id}` so buyers land on the claim
   page automatically. Flip `docs/business/ls-config.json` `live:true`; republish the site.
3. Validate end-to-end with an **LS test purchase** → confirmation → claim → paste token → app activates.

## Status
- Production key: ✅ settled (no rebuild). Issuer: ✅ deployed + webhook registered. Delivery: ✅ built + hosted.
- Blocker to revenue: ⏳ LemonSqueezy merchant-application review (Test mode on) — not code.
