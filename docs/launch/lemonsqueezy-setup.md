# Lemon Squeezy setup — PolyglotFormFill (owner steps)

Our licensing is **offline, signed tokens** (ADR-0015/0011): Lemon Squeezy is only the
**storefront + payment**. After a purchase, our webhook signs a `PPDF1.…` token and emails it
to the buyer, who pastes it into the app/extension — verified on-device, no phone-home.

Gating (decided): **Free** = autofill (web + PDF) + ID/passport scanning + 1 profile ·
**Pro ($19)** = on-device translation + photo/signature fields · **Family ($29)** = multiple
profiles + encrypted device sync.

## 1. Create the store & products
1. Sign in at app.lemonsqueezy.com → create your **Store** (if not already).
2. **Products → New Product** (create two):
   - **PolyglotFormFill Pro** — one-time **$19** (add a second variant "Pro Annual $X" later if you want).
   - **PolyglotFormFill Family** — one-time **$29**.
   - Type: **Digital product / license**. You do NOT need Lemon Squeezy's own "license keys"
     feature — we issue our own signed tokens. (Leave LS license-key generation OFF.)
3. Publish both.

## 2. Send me these IDs (I wire them into `scripts/license/webhook.mjs`)
- **Store ID**
- **Pro variant ID** and **Family variant ID** (Product → the variant → the numeric ID in the URL/API)
- **Webhook signing secret** (next step)

## 3. Webhook (order → token)
1. Lemon Squeezy → **Settings → Webhooks → +**.
2. **Callback URL:** the deployed `webhook.mjs` endpoint (see §5). e.g. `https://lic.polyglotformfill.com/ls`
3. **Events:** check **`order_created`**.
4. Copy the **Signing secret** → this is `LS_WEBHOOK_SECRET` (send it to me / set it in the deploy env).

## 4. Device binding — pick ONE (my recommendation: Unbound for the extension)
Tokens can be **device-bound** (per ADR-0011, one device per seat) or **unbound** (works on all
the buyer's devices).
- **Unbound (recommended for launch):** simplest UX — the buyer buys, gets a token, pastes it on
  any device. No "enter your device ID at checkout" step. The webhook issues `device=""`.
- **Device-bound:** stronger per-seat control, but the buyer must first copy their **device ID**
  (shown in the popup's License section) and enter it as a checkout custom field. More friction.
Tell me which; I'll set the webhook accordingly. (The verifier already supports both.)

## 5. Deploy the webhook
`scripts/license/webhook.mjs` is framework-agnostic (`handleWebhook(rawBody, signature)`), needs
`LS_WEBHOOK_SECRET`, and the vendor **private** key (`scripts/license/vendor-key.json`, never
committed). Options:
- **OKE pod** (same cluster as the site) — I can add a small Deployment + Service + Ingress.
- **Cloudflare Worker / Vercel function** — paste `handleWebhook` in, set the secret + key as env.
Delivery: wire the token into your transactional email (Lemon Squeezy can email order content, or
use Resend/SES). I'll add the send step once you pick a mail provider.

## 6. PPP (purchasing-power) pricing
Lemon Squeezy has no native PPP. Two practical routes:
- **Discount codes per region** (e.g. `INDIA40`, `LATAM30`) surfaced by the site's geo script
  (the landing page already floors a PPP multiplier at 0.35). Lowest effort.
- **Separate regional variants/products** at localized prices, shown by country. More control.
Start with discount codes; revisit if abuse appears (codes can be shared).

## 7. Store housekeeping after this ships
- Chrome Web Store **Distribution → Payments**: switch from "Free of charge" to
  **"Contains in-app purchases"** once the Pro upsell ships in a published version.
- Marketing note: the pitch/landing currently frame translation as a headline free feature.
  Since translation is now **Pro**, update that copy to say "Pro" (or reposition Free).

## What's already done (code)
- Extension verifies + activates tokens offline (`apps/extension/src/license.js`), Pro-gates
  translation + image fields, shows the device ID + activate/remove UI.
- Storefront signer exists (`scripts/license/sign.mjs`, `issue.mjs`, `webhook.mjs`); vendor
  keypair generated; public key embedded in extension + desktop.
- Remaining = your §1–§6 above, then I finish the webhook variant mapping + delivery + deploy.
