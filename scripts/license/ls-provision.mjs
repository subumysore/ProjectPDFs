#!/usr/bin/env node
// Provision the Lemon Squeezy store for PolyglotFormFill via the LS REST API — automates the tedious
// parts. LS's API is READ-ONLY for products/variants (you create the 3 products in the dashboard once),
// but it CAN: read back the Variant IDs, create the PPP discount codes, and create the webhook.
//
//   Auth:  set LS_API_KEY (a store API key). Never commit it.
//   Usage: node scripts/license/ls-provision.mjs [--dry-run] [--webhook]
//          --dry-run  : print what WOULD happen, change nothing.
//          --webhook  : also create the webhook (needs LS_WEBHOOK_URL + LS_WEBHOOK_SECRET).
//
// It writes the non-secret results (store id/slug, variant ids, discount codes) to
// docs/business/ls-config.json for the site/issuer wiring. Idempotent: existing discounts/webhooks
// with the same code/url are left alone.
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const KEY = process.env.LS_API_KEY;
const DRY = process.argv.includes("--dry-run");
const DO_WEBHOOK = process.argv.includes("--webhook");
if (!KEY) { console.error("Set LS_API_KEY (a Lemon Squeezy store API key)."); process.exit(1); }

const BASE = "https://api.lemonsqueezy.com/v1";
const H = {
  Authorization: `Bearer ${KEY}`,
  Accept: "application/vnd.api+json",
  "Content-Type": "application/vnd.api+json",
};
async function api(path, method = "GET", body = null) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 400)}`);
  return j;
}
async function all(path) { // follow pagination
  let out = [], url = path;
  while (url) { const j = await api(url.replace(BASE, "")); out = out.concat(j.data || []); url = j.links?.next || null; }
  return out;
}

// --- the pricing matrix (must match docs/business/lemonsqueezy-setup.md) --------------------------
// Finer 10% PPP bands (+ 65% floor) so the on-site price snaps to a band that is actually charged.
const PPP_BANDS = [10, 20, 30, 40, 50, 60, 65];
// Product name → the tier key we expect (matched case-insensitively by substring).
const WANT = [
  { key: "pro", match: /\bpro\b/i, price: 1900, kind: "one-time" },
  { key: "duo", match: /\bduo\b/i, price: 2900, kind: "one-time" },
  { key: "business", match: /business/i, price: 2900, kind: "subscription/seat/yr" },
];

(async () => {
  console.log(DRY ? "— DRY RUN (no changes) —\n" : "");

  // 1) Store
  const stores = await all(`${BASE}/stores`);
  if (!stores.length) throw new Error("No stores on this account/key.");
  const store = stores[0];
  const storeId = store.id, slug = store.attributes.slug, currency = store.attributes.currency;
  console.log(`Store: ${store.attributes.name}  id=${storeId}  slug=${slug}  currency=${currency}`);
  if (currency !== "USD") console.warn(`  ! Store currency is ${currency}, expected USD.`);

  // 2) Read back the variant ID for each of our 3 products (fetch variants PER product — no global
  //    status filter, which returns nothing while the store is still in review / test mode).
  const products = await all(`${BASE}/products?filter[store_id]=${storeId}`);
  console.log(`  products: ${products.map((p) => `${p.attributes.name} [${p.attributes.status}]`).join(" · ") || "(none)"}`);
  const found = {};
  for (const w of WANT) {
    const prod = products.find((p) => w.match.test(p.attributes.name || ""));
    if (!prod) { console.warn(`  ${w.key.padEnd(9)} product NOT FOUND — make sure a product name contains "${w.key}".`); continue; }
    const vs = await all(`${BASE}/variants?filter[product_id]=${prod.id}`);
    const v = vs[0];
    if (!v) { console.warn(`  ${w.key.padEnd(9)} "${prod.attributes.name}" has no variant yet.`); continue; }
    found[w.key] = { variantId: v.id, product: prod.attributes.name, price: v.attributes.price, status: v.attributes.status };
    const priceOk = v.attributes.price === w.price ? "✓" : `! expected ${w.price}`;
    console.log(`  ${w.key.padEnd(9)} variantId=${v.id}  "${prod.attributes.name}"  price=${v.attributes.price} [${v.attributes.status}] ${priceOk}`);
  }

  // 3) Discounts — create any missing PPP band (percent, forever, unlimited, all products)
  const existing = await all(`${BASE}/discounts?filter[store_id]=${storeId}`);
  const haveCode = new Set(existing.map((d) => (d.attributes.code || "").toUpperCase()));
  for (const pct of PPP_BANDS) {
    const code = `PPP${pct}`;
    if (haveCode.has(code)) { console.log(`  discount ${code} already exists — skip`); continue; }
    const payload = { data: { type: "discounts", attributes: {
      name: `PPP ${pct}% (regional)`, code, amount: pct, amount_type: "percent",
      is_limited_to_products: false, is_limited_redemptions: false, duration: "forever",
    }, relationships: { store: { data: { type: "stores", id: String(storeId) } } } } };
    if (DRY) { console.log(`  would create discount ${code} (${pct}%)`); continue; }
    await api("/discounts", "POST", payload);
    console.log(`  created discount ${code} (${pct}%)`);
  }

  // 4) Webhook (optional — needs the issuer URL + a secret you choose)
  if (DO_WEBHOOK) {
    const url = process.env.LS_WEBHOOK_URL, secret = process.env.LS_WEBHOOK_SECRET;
    if (!url || !secret) { console.warn("  --webhook needs LS_WEBHOOK_URL + LS_WEBHOOK_SECRET — skipping."); }
    else {
      const hooks = await all(`${BASE}/webhooks?filter[store_id]=${storeId}`);
      if (hooks.some((w) => w.attributes.url === url)) console.log(`  webhook for ${url} already exists — skip`);
      else {
        const events = ["order_created", "subscription_created", "subscription_updated", "subscription_cancelled", "subscription_expired", "order_refunded"];
        const payload = { data: { type: "webhooks", attributes: { url, events, secret }, relationships: { store: { data: { type: "stores", id: String(storeId) } } } } };
        if (DRY) console.log(`  would create webhook → ${url}`);
        else { await api("/webhooks", "POST", payload); console.log(`  created webhook → ${url}`); }
      }
    }
  } else {
    console.log("  (webhook skipped — pass --webhook once the issuer is deployed)");
  }

  // 5) Write the non-secret config for wiring
  const cfg = { storeId, slug, currency, variants: found, pppBands: PPP_BANDS, generatedNote: "non-secret; safe to commit" };
  const out = resolve(ROOT, "docs/business/ls-config.json");
  if (!DRY) writeFileSync(out, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`\n${DRY ? "(dry-run) would write" : "wrote"} ${out}`);
  console.log("Next: send me any NOT FOUND products' names, or (if all found) I wire the Buy buttons from ls-config.json.");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
