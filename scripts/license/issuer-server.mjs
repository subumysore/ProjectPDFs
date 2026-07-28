// License issuer server — ZERO-COST claim delivery (no database, no paid volume). STRIPE edition.
//
//   POST /webhook — Stripe calls this on checkout.session.completed / refunds; we verify the
//                   Stripe-Signature and 200-ack (register a verified endpoint + surface refunds).
//                   No storage, no minting here.
//   GET  /claim   — the buyer lands here from the Checkout success redirect
//                   (…/issuer/claim?session=<CHECKOUT_SESSION_ID>). We fetch the PAID session from
//                   the Stripe API, RE-MINT the license token on the fly from the purchased tier,
//                   and show it to copy into the app's License panel. The unguessable cs_… id is
//                   itself the proof of purchase; an email field is offered only as an extra check.
//
// No token is ever stored — it is deterministically re-signed from the paid session, so there is
// nothing to persist (no PVC / block-volume cost). PRIVACY: only email + session id + tier + an
// optional device id — never any user FORM content.
//
// Env: STRIPE_API_KEY (read sessions), STRIPE_WEBHOOK_SECRET (verify webhook),
//      LS_VENDOR_KEY_FILE (mounted private key), PORT (default 8787).
import { createServer } from "node:http";
import { signLicense } from "./sign.mjs";
import { handleStripeWebhook } from "./stripe-webhook.mjs";

const PORT = Number(process.env.PORT || 8787);
const FEATURES = ["docx", "ocr", "translate", "companion", "sign"];

// Map the purchased product's `ppf` metadata (set on the Stripe product) to license tier/features/expiry.
// Fall back to the product NAME if metadata is missing. Subscriptions lapse via `days` expiry.
function planForPpf(ppf, name) {
  const v = `${ppf || ""} ${name || ""}`.toLowerCase();
  if (/business|team|scale|enterprise/.test(v)) return { tier: "team", features: [...FEATURES, "team"], days: 366 };
  if (/duo|family/.test(v)) return { tier: "family", features: FEATURES, days: 0 };
  return { tier: "pro", features: FEATURES, days: 0 };
}

// Fetch a PAID Stripe Checkout Session, expanded to the line item's product (for tier metadata).
// Injectable for tests. Returns a normalized record or null.
async function fetchSessionStripe(sessionId) {
  const key = process.env.STRIPE_API_KEY;
  if (!key) return null;
  const qs = "expand[]=line_items.data.price.product";
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?${qs}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!r.ok) return null;
  const s = await r.json();
  const item = s?.line_items?.data?.[0];
  const product = item?.price?.product || {};
  const deviceField = (s?.custom_fields || []).find((f) => f.key === "device_id");
  // Prefer client_reference_id (passed silently when the checkout is launched FROM the app, which
  // knows its own device id) over the manually-typed fallback field.
  const device = (s?.client_reference_id || deviceField?.text?.value || "").trim();
  return {
    paid: s.payment_status === "paid" || s.status === "complete",
    email: s?.customer_details?.email || s?.customer_email || "",
    ppf: product?.metadata?.ppf || "",
    productName: product?.name || item?.description || "",
    device,
    created: s.created ? Number(s.created) : null,
  };
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PAGE = (inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PolyglotFormFill — Claim your license</title><style>
  body{font:15px system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#101a20}
  h1{font-size:20px}.sub{color:#55666f}.tok{width:100%;box-sizing:border-box;padding:10px;border:1px solid #cfe9e5;border-radius:8px;background:#f4fbfa;font:12px ui-monospace,monospace;word-break:break-all}
  input{padding:9px;border:1px solid #cfe9e5;border-radius:8px;width:100%;box-sizing:border-box;margin:6px 0}
  label{font-size:13px}button{padding:9px 14px;border:0;border-radius:8px;background:#0d8f83;color:#fff;font-weight:600;cursor:pointer}
  .err{color:#9a2c2c}.ok{color:#0a6a60}</style></head><body>${inner}</body></html>`;
const claimForm = (session, msg) => PAGE(`<h1>Claim your PolyglotFormFill license</h1>
  <p class="sub">Your license is generated from your Stripe receipt. If you were redirected here after paying, your key appears automatically. Otherwise paste your Checkout session id (starts with <code>cs_</code>) from the receipt link.</p>
  ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
  <form method="GET" action="claim">
    <label>Checkout session id<input name="session" value="${esc(session)}" placeholder="cs_live_..." required></label>
    <label>Email used at checkout (optional, extra check)<input name="email" type="email" placeholder="you@example.com"></label>
    <button type="submit">Reveal my license</button>
  </form>`);
const claimResult = (rec) => PAGE(`<h1 class="ok">✓ License ready (${esc(rec.tier)})</h1>
  <p class="sub">Copy the token below and paste it into the app (License → Activate).</p>
  ${rec.tokens.map((t) => `<textarea class="tok" rows="3" readonly onclick="this.select()">${esc(t)}</textarea>`).join("")}
  <p class="sub">Keep it safe — you can return here with your Checkout session id any time.</p>`);

export async function handleClaim(session, email, fetchSession = fetchSessionStripe) {
  const id = String(session || "").trim();
  const em = String(email || "").trim().toLowerCase();
  if (!id) return { status: 200, type: "text/html", body: claimForm(id, "") };
  const s = await fetchSession(id);
  if (!s || !s.paid) {
    return { status: 404, type: "text/html", body: claimForm(id, "No paid purchase found for that session id. Use the exact link from your Stripe receipt.") };
  }
  if (em && String(s.email || "").trim().toLowerCase() !== em) {
    return { status: 404, type: "text/html", body: claimForm(id, "That email does not match the one used at checkout. Leave it blank, or enter the email you paid with.") };
  }
  const plan = planForPpf(s.ppf, s.productName);
  const issued_at = Math.floor(Number(s.created ? s.created * 1000 : Date.now()) / 1000);
  const token = signLicense({ subject: s.email, tier: plan.tier, features: plan.features, device: s.device || "", issued_at, days: plan.days });
  return { status: 200, type: "text/html", body: claimResult({ tier: plan.tier, tokens: [token] }) };
}

if (process.argv[1] && process.argv[1].endsWith("issuer-server.mjs") && process.argv.includes("--serve")) {
  createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/^\/issuer/, "") || "/"; // tolerate an /issuer/ ingress prefix
    if (req.method === "GET" && path === "/healthz") { res.writeHead(200); return res.end("ok"); }
    if (req.method === "GET" && (path === "/claim" || path === "/")) {
      handleClaim(url.searchParams.get("session") || "", url.searchParams.get("email") || "")
        .then(({ status, type, body }) => { res.writeHead(status, { "content-type": type }); res.end(body); })
        .catch(() => { res.writeHead(500); res.end("error"); });
      return;
    }
    if (req.method === "POST" && path === "/webhook") {
      let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
        const { status, body } = handleStripeWebhook(raw, req.headers["stripe-signature"]);
        res.writeHead(status); res.end(body);
      });
      return;
    }
    res.writeHead(404); res.end("not found");
  }).listen(PORT, () => console.log(`license issuer on :${PORT} (stripe webhook + claim, zero-storage)`));
}
