# Lemon Squeezy — dashboard setup (PolyglotFormFill)

Final pricing matrix (locked 2026-07-25). **We mint our own Ed25519 license tokens via a webhook**, so
**License keys are OFF on every product.** Prices are a **single USD base**; regional (PPP) pricing is
applied by **our site** via discount codes (below), so **leave Lemon Squeezy's own "regional pricing"
OFF** to avoid double-discounting.

| Product | LS type | Price (USD base) | Seats/devices | Notes |
|---|---|---|---|---|
| **Pro** | Single payment (one-time) | **$19.00** | 1 device | personal |
| **Duo** | Single payment (one-time) | **$29.00** | 2 devices | personal |
| **Business** | Subscription · **yearly** · per-unit | **$29.00 / seat / yr** | 1–19 seats (buyer picks qty) | commercial |
| *Free trial* | — (NOT an LS product) | $0 | 1 device / 30 days | minted by our issuer, no purchase |
| *Enterprise* | — (NOT an LS product) | contact | 20+ seats | mailto / contact form |

---

## 1. Store settings
1. **Settings → Stores** → confirm **Currency = USD**.
2. Make sure Lemon Squeezy's own **"Regional pricing"/PPP is OFF** (we do PPP ourselves — §3).
3. Note the **Store slug** (`xxxx.lemonsqueezy.com`) and **Store ID** → send to me.

## 2. Products & variants
For EACH product: **Products → New Product**. On the variant, open **"License keys"** and
**turn generation OFF** (we issue our own).

### Pro
- Name `PolyglotFormFill Pro` · Pricing **Single payment** · **$19.00**.
- Blurb: "One-time, per-device license. Verified offline on your device — no account, no subscription."
- Save → open the variant → **copy the Variant ID**.

### Duo
- Name `PolyglotFormFill Duo` · Pricing **Single payment** · **$29.00**.
- Blurb: "One-time license for 2 devices."
- Save → **copy the Variant ID**.

### Business (per-seat, annual)
- Name `PolyglotFormFill Business` · Pricing **Subscription** · Interval **Yearly**.
- Model **Per-unit**, **$29.00 per unit**, enable **"Let customers choose quantity"** (min 1, max 19). One unit = one seat.
- Blurb: "Annual per-seat commercial license, unlimited profiles, central issuance."
- Save → **copy the Variant ID**.
- *(If your plan can't do per-unit quantity on a subscription, tell me — we'll fall back to a 1-seat subscription + quantity note, or a few seat packs.)*

> Free trial + Enterprise get **no product** — the trial is minted by our issuer at first run; Enterprise is a "contact us" mailto.

## 3. PPP discount codes — **AUTOMATED, don't create these by hand**
`scripts/license/ls-provision.mjs` creates the finer 10%-step bands for you via the API
(`PPP10, PPP20, PPP30, PPP40, PPP50, PPP60, PPP65`), percentage / all-products / forever / unlimited.
The site detects the visitor's country, snaps to the nearest band, and appends
`checkout[discount_code]=CODE` to the buy URL. Full USD applies when no code matches.

## 4. Webhook — **AUTOMATED** (created by the same script with `--webhook`)
Runs once the issuer is deployed. Events: `order_created`, `subscription_created`,
`subscription_updated`, `subscription_cancelled`, `subscription_expired`, `order_refunded`. The signing
secret is one YOU choose (env `LS_WEBHOOK_SECRET`) → also mounted on the issuer.

## 5. API key — the one thing that unlocks all the automation
**Settings → API → New API key** → copy. This is `LS_API_KEY`. With it, the script reads back your
Variant IDs, creates all discount codes, and (later) the webhook. Give it to me **securely** (I set it as
an env var / K8s secret — never chat or git).

## Your ACTUAL manual work (everything else is automated)
1. **Create the 3 products** in §2 (LS API can't create products — this is the only unavoidable manual part). License keys **OFF**.
2. **Give me the `LS_API_KEY`** (securely). Then I run `node scripts/license/ls-provision.mjs`, which:
   reads back the Pro/Duo/Business **Variant IDs** automatically, **creates all 7 PPP discount codes**,
   and writes `docs/business/ls-config.json` for the site wiring. Later, `--webhook` creates the webhook.

Then I: wire the Buy buttons + dynamic PPP-code selection into the site, deploy the issuer with the
secrets, run the production keygen (new public key embedded in the app), and test a full
checkout → token → offline-verify cycle. The 30-day trial token is issued by the same endpoint.
