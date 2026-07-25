// Lemon Squeezy webhook -> issue a device-bound license (storefront automation).
// Deploy as a small serverless function (Vercel / Cloudflare Worker / a pod on the OKE
// cluster). It receives the order, verifies the signature, signs a device-bound token,
// and returns it (wire your email/delivery step where marked). This handles ONLY license
// issuance — never any user form content, so the privacy invariant is unaffected.
//
// Env: LS_WEBHOOK_SECRET (Lemon Squeezy signing secret). Node 18+.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { signLicense } from "./sign.mjs";

// Map Lemon Squeezy variant/product names to license tier + feature set.
// Subscription tiers get an expiry so they naturally lapse if not renewed (offline model
// has no remote revocation — see RFC-0010 / ADR-0015). Perpetual one-time buys use days:0.
const TIERS = {
  pro: { tier: "pro", features: ["docx", "ocr", "translate", "companion", "sign"], days: 0 },
  "pro-annual": { tier: "pro", features: ["docx", "ocr", "translate", "companion", "sign"], days: 366 },
  family: { tier: "family", features: ["docx", "ocr", "translate", "companion", "sign"], days: 0 },
  team: { tier: "team", features: ["docx", "ocr", "translate", "companion", "sign", "team"], days: 366 },
  business: { tier: "team", features: ["docx", "ocr", "translate", "companion", "sign", "team"], days: 366 },
  scale: { tier: "team", features: ["docx", "ocr", "translate", "companion", "sign", "team"], days: 366 },
};

// Events that MINT a token (a paid purchase or a renewal).
const ISSUE_EVENTS = new Set([
  "order_created",
  "subscription_created",
  "subscription_payment_success",
]);
// Events that should NOT mint (refund/chargeback/cancel). Offline tokens can't be pulled
// back mid-term, so the response flags them for the delivery layer to (a) not re-send and
// (b) let the subscription's expiry lapse. Perpetual refunds are a support-desk action.
const REVOKE_EVENTS = new Set([
  "order_refunded",
  "subscription_payment_refunded",
  "subscription_cancelled",
  "subscription_expired",
]);

// Verify the Lemon Squeezy webhook HMAC (SHA-256 over the RAW body, hex, X-Signature header).
// Read the secret at call time so tests / deploys can set it after import. Constant-time.
function verify(raw, signature) {
  const secret = process.env.LS_WEBHOOK_SECRET || "";
  if (!secret) return false;
  const digest = createHmac("sha256", secret).update(raw).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signature || ""));
  } catch {
    return false;
  }
}

// Default in-memory idempotency store. In production pass a durable store (Redis/KV) so a
// LS retry of the same event does not mint a second token. Any object with has()/add() works.
const defaultSeen = new Set();

// Framework-agnostic core: given the raw body + signature, return {status, body}.
// `opts.seen` overrides the idempotency store (e.g. a KV in serverless).
export function handleWebhook(raw, signature, opts = {}) {
  if (!verify(raw, signature)) return { status: 401, body: "bad signature" };
  const evt = JSON.parse(raw);
  const attrs = evt?.data?.attributes ?? {};
  const meta = evt?.meta ?? {};
  const event = meta.event_name || "";
  const seen = opts.seen || defaultSeen;

  // Idempotency key: prefer LS's event id header/body; fall back to the resource id.
  const eventId = String(opts.eventId ?? evt?.data?.id ?? "");
  if (eventId && seen.has(eventId)) {
    return { status: 200, body: JSON.stringify({ deduped: true, eventId }) };
  }

  if (REVOKE_EVENTS.has(event)) {
    if (eventId) seen.add(eventId);
    // Do NOT mint. Signal the delivery layer; expiry handles subscription lapse.
    return { status: 200, body: JSON.stringify({ revoke: true, event, subject: attrs.user_email || "" }) };
  }
  if (!ISSUE_EVENTS.has(event)) return { status: 200, body: "ignored" };

  const subject = attrs.user_email || "";
  // The buyer pastes their device id (from the app's "This device" line) into a
  // checkout custom field; multi-device orders provide a comma-separated list.
  const custom = meta.custom_data || {};
  const devices = String(custom.device_id || "").split(",").map((s) => s.trim()).filter(Boolean);
  const variant = (attrs.first_order_item?.variant_name || attrs.variant_name || "pro").toLowerCase();
  const plan = TIERS[variant] || TIERS.pro;
  const issued_at = Math.floor(Number(attrs.created_at ? Date.parse(attrs.created_at) : Date.now()) / 1000);

  // One token per device (device-bound); if none supplied, an unbound token (any device).
  const tokens = (devices.length ? devices : [""]).map((device) =>
    signLicense({ subject, tier: plan.tier, features: plan.features, device, issued_at, days: plan.days }),
  );

  if (eventId) seen.add(eventId);
  // TODO: deliver `tokens` to `subject` — email them, or store for the buyer to fetch.
  return { status: 200, body: JSON.stringify({ subject, tier: plan.tier, tokens }) };
}

// Optional standalone server (for local testing / a pod). Serverless platforms call
// handleWebhook directly instead.
if (process.argv[1] && process.argv[1].endsWith("webhook.mjs") && process.argv.includes("--serve")) {
  createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const { status, body } = handleWebhook(raw, req.headers["x-signature"]);
      res.writeHead(status);
      res.end(body);
    });
  }).listen(8787, () => console.log("license webhook on :8787"));
}
