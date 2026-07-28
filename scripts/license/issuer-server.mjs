// License issuer server — ZERO-COST claim delivery (no database, no paid volume).
//
//   POST /webhook — Lemon Squeezy calls this on purchase; we HMAC-verify and 200-ack (used to
//                   register the endpoint + could log/refund-flag). No storage.
//   GET  /claim   — the buyer opens this from the LS order-confirmation redirect
//                   (…/issuer/claim?order=<order_id>), enters the email they paid with; we fetch
//                   the paid order from the LS API, verify the email, RE-MINT the license token on
//                   the fly, and show it to copy into the app's License panel.
//
// No token is ever stored — it is deterministically re-signed from the paid order, so there is
// nothing to persist (no PVC / block volume cost). PRIVACY: only email + order id + tier — never
// any user FORM content.
//
// Env: LS_WEBHOOK_SECRET (LS signing secret), LS_API_KEY (read orders), LS_VENDOR_KEY_FILE
//      (mounted private key), PORT (default 8787).
import { createServer } from "node:http";
import { signLicense } from "./sign.mjs";
import { handleWebhook } from "./webhook.mjs";

const PORT = Number(process.env.PORT || 8787);
const FEATURES = ["docx", "ocr", "translate", "companion", "sign"];
// Map an LS variant/product name to license tier + features + expiry (subscriptions lapse via expiry).
function planForVariant(variant) {
  const v = String(variant || "").toLowerCase();
  if (/business|team|scale|enterprise/.test(v)) return { tier: "team", features: [...FEATURES, "team"], days: 366 };
  if (/duo|family/.test(v)) return { tier: "family", features: FEATURES, days: 0 };
  return { tier: "pro", features: FEATURES, days: 0 };
}

// Fetch a paid order from Lemon Squeezy (real in live, test orders in test mode). Injectable for tests.
async function fetchOrderLS(orderId) {
  const key = process.env.LS_API_KEY;
  if (!key) return null;
  const r = await fetch(`https://api.lemonsqueezy.com/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/vnd.api+json" },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.data?.attributes || null;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PAGE = (inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PolyglotFormFill — Claim your license</title><style>
  body{font:15px system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#101a20}
  h1{font-size:20px}.sub{color:#55666f}.tok{width:100%;box-sizing:border-box;padding:10px;border:1px solid #cfe9e5;border-radius:8px;background:#f4fbfa;font:12px ui-monospace,monospace;word-break:break-all}
  input{padding:9px;border:1px solid #cfe9e5;border-radius:8px;width:100%;box-sizing:border-box;margin:6px 0}
  label{font-size:13px}button{padding:9px 14px;border:0;border-radius:8px;background:#0d8f83;color:#fff;font-weight:600;cursor:pointer}
  .err{color:#9a2c2c}.ok{color:#0a6a60}</style></head><body>${inner}</body></html>`;
const claimForm = (order, msg) => PAGE(`<h1>Claim your PolyglotFormFill license</h1>
  <p class="sub">Enter the email you used at checkout to reveal your license key, then paste it into the app: <b>License → paste → Activate</b>.</p>
  ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
  <form method="GET" action="claim">
    <label>Order number<input name="order" value="${esc(order)}" placeholder="e.g. 12345" required></label>
    <label>Email used at checkout<input name="email" type="email" required placeholder="you@example.com"></label>
    <button type="submit">Reveal my license</button>
  </form>`);
const claimResult = (rec) => PAGE(`<h1 class="ok">✓ License ready (${esc(rec.tier)})</h1>
  <p class="sub">Copy the token below and paste it into the app (License → Activate).</p>
  ${rec.tokens.map((t) => `<textarea class="tok" rows="3" readonly onclick="this.select()">${esc(t)}</textarea>`).join("")}
  <p class="sub">Keep it safe — you can return here with your order number + email any time.</p>`);

export async function handleClaim(order, email, fetchOrder = fetchOrderLS) {
  const id = String(order || "").trim();
  const em = String(email || "").trim().toLowerCase();
  if (!id || !em) return { status: 200, type: "text/html", body: claimForm(id, "") };
  const o = await fetchOrder(id);
  if (!o || String(o.user_email || "").trim().toLowerCase() !== em) {
    return { status: 404, type: "text/html", body: claimForm(id, "No paid order found for that number + email. Use the order number from your receipt and the exact email you paid with.") };
  }
  const plan = planForVariant(o.first_order_item?.variant_name || o.variant_name);
  const issued_at = Math.floor(Number(o.created_at ? Date.parse(o.created_at) : Date.now()) / 1000);
  const token = signLicense({ subject: o.user_email, tier: plan.tier, features: plan.features, device: "", issued_at, days: plan.days });
  return { status: 200, type: "text/html", body: claimResult({ tier: plan.tier, tokens: [token] }) };
}

if (process.argv[1] && process.argv[1].endsWith("issuer-server.mjs") && process.argv.includes("--serve")) {
  createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/^\/issuer/, "") || "/"; // tolerate an /issuer/ ingress prefix
    if (req.method === "GET" && path === "/healthz") { res.writeHead(200); return res.end("ok"); }
    if (req.method === "GET" && (path === "/claim" || path === "/")) {
      handleClaim(url.searchParams.get("order") || "", url.searchParams.get("email") || "")
        .then(({ status, type, body }) => { res.writeHead(status, { "content-type": type }); res.end(body); })
        .catch(() => { res.writeHead(500); res.end("error"); });
      return;
    }
    if (req.method === "POST" && path === "/webhook") {
      let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
        const { status, body } = handleWebhook(raw, req.headers["x-signature"]);
        res.writeHead(status); res.end(body);
      });
      return;
    }
    res.writeHead(404); res.end("not found");
  }).listen(PORT, () => console.log(`license issuer on :${PORT} (webhook + claim, zero-storage)`));
}
