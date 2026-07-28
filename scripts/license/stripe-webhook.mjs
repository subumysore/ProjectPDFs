// Stripe webhook verifier for the license issuer. Stripe signs the RAW body with an HMAC-SHA256
// keyed by the endpoint's signing secret (whsec_...). The Stripe-Signature header looks like:
//   t=1699999999,v1=hexdigest[,v1=hexdigest...]
// We recompute HMAC over `${t}.${rawBody}` and constant-time compare against any v1 candidate,
// and reject stamps older than the tolerance (replay guard). No SDK dependency — pure Node crypto.
//
// This handles ONLY license issuance signalling — never any user form content, so the privacy
// invariant is unaffected. Env: STRIPE_WEBHOOK_SECRET.
import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TOLERANCE = 60 * 5; // 5 minutes

// Parse "t=...,v1=...,v1=..." into { t, v1: [...] }
function parseSig(header) {
  const out = { t: null, v1: [] };
  for (const part of String(header || "").split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") out.t = Number(v);
    else if (k === "v1") out.v1.push(v);
  }
  return out;
}

function safeEqHex(a, b) {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

// Verify a Stripe webhook. `nowSec` is injectable for deterministic tests. Returns true/false.
export function verifyStripeSig(raw, header, secret = process.env.STRIPE_WEBHOOK_SECRET, opts = {}) {
  if (!secret) return false;
  const { t, v1 } = parseSig(header);
  if (!t || !v1.length) return false;
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Number.isFinite(tolerance) && Math.abs(now - t) > tolerance) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return v1.some((cand) => safeEqHex(expected, cand));
}

// Framework-agnostic handler: verify + 200-ack. We do NOT mint here — delivery is the zero-storage
// /claim page (re-mint from the paid session). The webhook exists to (a) let us register a verified
// endpoint and (b) surface refunds/disputes for support. Returns {status, body}.
const ISSUE = new Set(["checkout.session.completed", "invoice.paid", "invoice.payment_succeeded"]);
const REVOKE = new Set(["charge.refunded", "charge.dispute.created", "customer.subscription.deleted"]);

export function handleStripeWebhook(raw, header, opts = {}) {
  if (!verifyStripeSig(raw, header, opts.secret, opts)) return { status: 400, body: "bad signature" };
  let evt;
  try { evt = JSON.parse(raw); } catch { return { status: 400, body: "bad json" }; }
  const type = evt?.type || "";
  const obj = evt?.data?.object || {};
  if (REVOKE.has(type)) {
    return { status: 200, body: JSON.stringify({ revoke: true, type, id: obj.id || "" }) };
  }
  if (ISSUE.has(type)) {
    // Ack only; the buyer claims via /claim. Return the session id for logging.
    return { status: 200, body: JSON.stringify({ ok: true, type, session: obj.id || "" }) };
  }
  return { status: 200, body: JSON.stringify({ ignored: type }) };
}
