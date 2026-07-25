// Tests for the Lemon Squeezy license-issuer webhook (RFC-0010).
// Uses a THROWAWAY Ed25519 keypair written to a temp file — never the real vendor key.
// Covers: HMAC signature verification, token issuance (byte-compatible with core-license),
// idempotency (LS retries), and refund handling (no token minted).
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHmac, verify as edVerify } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- Set up a throwaway vendor key + a test webhook secret BEFORE importing the modules. ---
const SECRET = "test-signing-secret";
process.env.LS_WEBHOOK_SECRET = SECRET;

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const privJwk = privateKey.export({ format: "jwk" });
const pubRaw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url"); // 32 bytes
const keyDir = mkdtempSync(join(tmpdir(), "ppdf-license-"));
const keyFile = join(keyDir, "vendor-key.json");
writeFileSync(keyFile, JSON.stringify({ publicHex: pubRaw.toString("hex"), jwk: privJwk }));
process.env.LS_VENDOR_KEY_FILE = keyFile;

const { handleWebhook } = await import("./webhook.mjs");

function sign(raw) {
  return createHmac("sha256", SECRET).update(raw).digest("hex");
}

function orderBody({ email = "buyer@example.com", device = "device-XYZ", variant = "pro", id = "evt-1" } = {}) {
  return JSON.stringify({
    meta: { event_name: "order_created", custom_data: { device_id: device } },
    data: { id, attributes: { user_email: email, first_order_item: { variant_name: variant }, created_at: "2026-07-20T00:00:00Z" } },
  });
}

// Verify a PPDF1 token's Ed25519 signature against the throwaway public key + decode payload.
function openToken(token) {
  const [hdr, b64json, b64sig] = token.split(".");
  assert.equal(hdr, "PPDF1");
  const json = Buffer.from(b64json, "base64url");
  const sig = Buffer.from(b64sig, "base64url");
  const ok = edVerify(null, json, publicKey, sig);
  return { ok, license: JSON.parse(json.toString("utf8")) };
}

test("rejects a bad HMAC signature with 401 (no token minted)", () => {
  const raw = orderBody();
  const res = handleWebhook(raw, "deadbeef");
  assert.equal(res.status, 401);
});

test("valid order_created mints a device-bound, verifiable token", () => {
  const raw = orderBody({ device: "device-XYZ", variant: "pro" });
  const res = handleWebhook(raw, sign(raw), { seen: new Set() });
  assert.equal(res.status, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.subject, "buyer@example.com");
  assert.equal(out.tier, "pro");
  assert.equal(out.tokens.length, 1);
  const { ok, license } = openToken(out.tokens[0]);
  assert.equal(ok, true, "token signature verifies against the vendor public key");
  assert.equal(license.tier, "pro");
  assert.equal(license.device_id, "device-XYZ");
  assert.equal(license.subject, "buyer@example.com");
  assert.ok(license.features.includes("docx"));
});

test("multi-device order mints one token per device id", () => {
  const raw = orderBody({ device: "dev-A, dev-B" });
  const res = handleWebhook(raw, sign(raw), { seen: new Set() });
  const out = JSON.parse(res.body);
  assert.equal(out.tokens.length, 2);
  assert.deepEqual(out.tokens.map((t) => openToken(t).license.device_id).sort(), ["dev-A", "dev-B"]);
});

test("idempotency: a retried event id does not mint a second token", () => {
  const seen = new Set();
  const raw = orderBody({ id: "evt-dup" });
  const first = handleWebhook(raw, sign(raw), { seen });
  assert.ok(JSON.parse(first.body).tokens);
  const second = handleWebhook(raw, sign(raw), { seen });
  assert.equal(JSON.parse(second.body).deduped, true);
});

test("refund events do not mint a token and flag a revoke", () => {
  const raw = JSON.stringify({
    meta: { event_name: "order_refunded" },
    data: { id: "evt-refund", attributes: { user_email: "buyer@example.com" } },
  });
  const res = handleWebhook(raw, sign(raw), { seen: new Set() });
  assert.equal(res.status, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.revoke, true);
  assert.equal(out.tokens, undefined);
});

test("unrelated events are ignored (no token)", () => {
  const raw = JSON.stringify({ meta: { event_name: "subscription_updated" }, data: { id: "x" } });
  const res = handleWebhook(raw, sign(raw), { seen: new Set() });
  assert.equal(res.body, "ignored");
});
