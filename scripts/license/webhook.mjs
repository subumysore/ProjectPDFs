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

const SECRET = process.env.LS_WEBHOOK_SECRET || "";

// Map Lemon Squeezy variant/product names to license tier + feature set.
const TIERS = {
  pro: { tier: "pro", features: ["docx", "ocr", "translate", "companion", "sign"], days: 0 },
  "pro-annual": { tier: "pro", features: ["docx", "ocr", "translate", "companion", "sign"], days: 366 },
  family: { tier: "family", features: ["docx", "ocr", "translate", "companion", "sign"], days: 0 },
};

function verify(raw, signature) {
  if (!SECRET) return false;
  const digest = createHmac("sha256", SECRET).update(raw).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signature || ""));
  } catch {
    return false;
  }
}

// Framework-agnostic core: given the raw body + signature, return {status, body}.
export function handleWebhook(raw, signature) {
  if (!verify(raw, signature)) return { status: 401, body: "bad signature" };
  const evt = JSON.parse(raw);
  const attrs = evt?.data?.attributes ?? {};
  const meta = evt?.meta ?? {};
  if (meta.event_name !== "order_created") return { status: 200, body: "ignored" };

  const subject = attrs.user_email || "";
  // The buyer pastes their device id (from the app's "This device" line) into a
  // checkout custom field; multi-device orders provide a comma-separated list.
  const custom = meta.custom_data || {};
  const devices = String(custom.device_id || "").split(",").map((s) => s.trim()).filter(Boolean);
  const variant = (attrs.first_order_item?.variant_name || "pro").toLowerCase();
  const plan = TIERS[variant] || TIERS.pro;
  const issued_at = Math.floor(Number(attrs.created_at ? Date.parse(attrs.created_at) : Date.now()) / 1000);

  // One token per device (device-bound); if none supplied, an unbound token (any device).
  const tokens = (devices.length ? devices : [""]).map((device) =>
    signLicense({ subject, tier: plan.tier, features: plan.features, device, issued_at, days: plan.days }),
  );

  // TODO: deliver `tokens` to `subject` — email them, or store for the buyer to fetch.
  return { status: 200, body: JSON.stringify({ subject, tokens }) };
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
