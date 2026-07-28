// Tests for the zero-storage claim issuer: a claim re-mints the token from the paid order (fetched
// via an injected LS fetcher), verifies the email, and refuses a mismatch — no persistence involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify as edVerify } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const dir = mkdtempSync(join(tmpdir(), "ppdf-issuer-"));
writeFileSync(join(dir, "vendor-key.json"), JSON.stringify({ publicHex: Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("hex"), jwk: privateKey.export({ format: "jwk" }) }));
process.env.LS_VENDOR_KEY_FILE = join(dir, "vendor-key.json");

const { handleClaim } = await import("./issuer-server.mjs");

// Fake LS: order "100" belongs to buyer@example.com, a Pro purchase.
const fakeFetch = async (id) => id === "100"
  ? { user_email: "Buyer@Example.com", first_order_item: { variant_name: "PolyglotFormFill PRO" }, created_at: "2026-07-20T00:00:00Z" }
  : null;

function openToken(token) {
  const [hdr, j, s] = token.split(".");
  assert.equal(hdr, "PPDF1");
  const json = Buffer.from(j, "base64url");
  return { ok: edVerify(null, json, publicKey, Buffer.from(s, "base64url")), license: JSON.parse(json.toString("utf8")) };
}

test("claim re-mints a valid token for the right order + email (case-insensitive)", async () => {
  const r = await handleClaim("100", "buyer@example.com", fakeFetch);
  assert.equal(r.status, 200);
  const m = r.body.match(/PPDF1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  assert.ok(m, "token present in the page");
  const { ok, license } = openToken(m[0]);
  assert.equal(ok, true);                        // signs against our vendor key
  assert.equal(license.tier, "pro");
  assert.equal(license.subject, "Buyer@Example.com");
});

test("claim refuses a wrong email or unknown order", async () => {
  assert.equal((await handleClaim("100", "someone@else.com", fakeFetch)).status, 404);
  assert.equal((await handleClaim("999", "buyer@example.com", fakeFetch)).status, 404);
});

test("no order/email → the claim form (not an error)", async () => {
  const r = await handleClaim("", "", fakeFetch);
  assert.equal(r.status, 200);
  assert.match(r.body, /Claim your PolyglotFormFill license/);
});
