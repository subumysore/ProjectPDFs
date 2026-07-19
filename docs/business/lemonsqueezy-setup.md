# Lemon Squeezy — product setup sheet (paste-ready)

Create these once the store is approved. For **every** product: **License keys = OFF** (we issue our
own device-bound Ed25519 tokens via the webhook — see `monetization.md`). Currency **USD**.

## Shared description (paste into each product; swap the last line per tier)
> **Stop retyping the same details into every form.**
>
> PolyglotFormFill fills PDFs, Word and Excel documents, and web forms from a vault of *your* details —
> entirely **on your device**. Your documents and data never touch a server, never reach us, never leave
> your machine.
>
> - 🧩 **Turns non-fillable PDFs into fillable forms** — a flat PDF, a scan, even a photo. On-device OCR
>   finds the fields, creates them, and fills them.
> - 🧠 **Understands your form** — one "Name" box gets first + middle + last; a "Middle initial" box gets
>   just the letter; one "Address" line combines street, city, state, ZIP. No rules to configure.
> - 📷 **Scan to fill** — snap an ID, licence, or business card; it reads the details into your vault.
> - 🌍 **Polyglot** — read a form in one language, fill it in another, translated on your device.
> - 🔒 **Private by design** — AES-256 vault, passphrase or hardware passkey, no accounts, no cloud, no tracking.
> - 💾 **Encrypted backup & transfer** between devices.
>
> *(last line — per tier below)*

## Products / variants to create
| Product | Type | Price | Last line of description |
|---|---|---|---|
| **PolyglotFormFill Pro** | Single payment | **$39** | "Pro: one device, perpetual license, up to 3 profiles." |
| **PolyglotFormFill Pro (Annual)** | Subscription / yearly | **$19/yr** | "Pro, billed yearly, one device." |
| **PolyglotFormFill Family** | Single payment | **$79** | "Family: up to 5 devices, up to 5 profiles." |
| **PolyglotFormFill Team** | Subscription / yearly, **quantity = seats** | **$29/seat/yr** | "Team: 5–50 seats, unlimited profiles." |
| **PolyglotFormFill Business** | Subscription / yearly, quantity = seats | **$24/seat/yr** | "Business: 51–100 seats." |
| **PolyglotFormFill Scale** | Subscription / yearly, quantity = seats | **$19/seat/yr** | "Scale: 101–500 seats." |
| **Enterprise** | — (no product) | Contact us | Handle via email / custom invoice. |

> Tip: you can start with just **Pro** + **Family** to launch, and add the seat tiers later.

## After creating each product — capture these IDs (I need them to wire the buttons)
For each product/variant, from its page or the API, note:
- **Variant ID** (the number used in checkout URLs)
- **Store ID** (one value, in Settings → Stores)

## Checkout URL format (the app's "Buy" button builds this)
```
https://<your-store>.lemonsqueezy.com/checkout/buy/<VARIANT_ID>?checkout[custom][device_id]=<DEVICE_ID>
```
The app injects the device id automatically, and the webhook reads `meta.custom_data.device_id` to sign a
device-bound token (already tested).

## Webhook (Step 3 — after products exist)
- Settings → Webhooks → add endpoint (URL of the deployed `scripts/license/webhook.mjs`), event
  **`order_created`**, copy the **signing secret** → set as `LS_WEBHOOK_SECRET`.
- Settings → API → create an **API key** (only needed if we later automate product/price reads).
- Deploy `webhook.mjs` on Vercel/Cloudflare Worker or the OKE cluster; wire the email-delivery `TODO`.
