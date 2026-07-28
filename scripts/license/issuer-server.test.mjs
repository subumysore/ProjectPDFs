// Tests for the zero-storage claim issuer (STRIPE): a claim re-mints the token from the paid
// Checkout Session (fetched via an injected fetcher), optionally checks the email, binds to the
// device id if the buyer supplied one — no persistence involved.
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

// Fake Stripe: session "cs_100" is a PAID Pro purchase by Buyer@Example.com, device "dev-abc".
const fakeFetch = async (id) => id === "cs_100"
  ? { paid: true, email: "Buyer@Example.com", ppf: "pro", productName: "PolyglotFormFill Pro", device: "dev-abc", created: 1750000000 }
  : id === "cs_unpaid"
  ? { paid: false, email: "x@y.com", ppf: "pro", productName: "Pro", device: "", created: 1750000000 }
  : null;

function openToken(token) {
  const [hdr, j, s] = token.split(".");
  assert.equal(hdr, "PPDF1");
  const json = Buffer.from(j, "base64url");
  return { ok: edVerify(null, json, publicKey, Buffer.from(s, "base64url")), license: JSON.parse(json.toString("utf8")) };
}

test("claim re-mints a valid device-bound token for the paid session", async () => {
  const r = await handleClaim("cs_100", "", fakeFetch);
  assert.equal(r.status, 200);
  const m = r.body.match(/PPDF1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  assert.ok(m, "token present in the page");
  const { ok, license } = openToken(m[0]);
  assert.equal(ok, true);                        // signs against our vendor key
  assert.equal(license.tier, "pro");
  assert.equal(license.subject, "Buyer@Example.com");
  assert.equal(license.device_id, "dev-abc");    // bound to the device field
});

test("optional email must match when supplied; unpaid/unknown session refused", async () => {
  assert.equal((await handleClaim("cs_100", "someone@else.com", fakeFetch)).status, 404);
  assert.equal((await handleClaim("cs_100", "buyer@example.com", fakeFetch)).status, 200); // case-insensitive match
  assert.equal((await handleClaim("cs_unpaid", "", fakeFetch)).status, 404);
  assert.equal((await handleClaim("cs_999", "", fakeFetch)).status, 404);
});

test("no session id → the claim form (not an error)", async () => {
  const r = await handleClaim("", "", fakeFetch);
  assert.equal(r.status, 200);
  assert.match(r.body, /Claim your PolyglotFormFill license/);
});
