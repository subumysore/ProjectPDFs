// Tests for the Stripe webhook verifier: valid signature over `${t}.${raw}`, replay window, and
// event routing (issue-ack vs revoke vs ignore).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyStripeSig, handleStripeWebhook } from "./stripe-webhook.mjs";

const SECRET = "whsec_test_secret_123";
const now = 1750000000;
function sign(raw, t = now, secret = SECRET) {
  const v1 = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

test("verifies a correct signature within tolerance", () => {
  const raw = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
  assert.equal(verifyStripeSig(raw, sign(raw), SECRET, { nowSec: now }), true);
});

test("rejects a tampered body, wrong secret, and stale timestamp", () => {
  const raw = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
  const sig = sign(raw);
  assert.equal(verifyStripeSig(raw + "x", sig, SECRET, { nowSec: now }), false);
  assert.equal(verifyStripeSig(raw, sig, "whsec_wrong", { nowSec: now }), false);
  assert.equal(verifyStripeSig(raw, sig, SECRET, { nowSec: now + 10000 }), false); // outside 5-min window
});

test("routes issue / revoke / ignore events after verifying", () => {
  const mk = (type) => { const raw = JSON.stringify({ type, data: { object: { id: "cs_x" } } }); return { raw, sig: sign(raw) }; };
  const issue = mk("checkout.session.completed");
  assert.equal(handleStripeWebhook(issue.raw, issue.sig, { secret: SECRET, nowSec: now }).status, 200);
  const refund = mk("charge.refunded");
  assert.match(handleStripeWebhook(refund.raw, refund.sig, { secret: SECRET, nowSec: now }).body, /revoke/);
  const other = mk("customer.created");
  assert.match(handleStripeWebhook(other.raw, other.sig, { secret: SECRET, nowSec: now }).body, /ignored/);
  // bad signature is a 400
  assert.equal(handleStripeWebhook(issue.raw, "t=1,v1=deadbeef", { secret: SECRET, nowSec: now }).status, 400);
});
