// Offline license verifier tests (license.js) — verifies against the embedded PUBLIC key
// only (no private key needed), so this is CI-safe. Token below was issued by
// scripts/license/issue.mjs (tier pro, device "demo-device", perpetual).
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyLicense } from "./license.js";

const TOKEN = "PPDF1.eyJzdWJqZWN0IjoiYnV5ZXJAZXhhbXBsZS5jb20iLCJ0aWVyIjoicHJvIiwiZmVhdHVyZXMiOlsiZG9jeCIsIm9jciIsInRyYW5zbGF0ZSIsImNvbXBhbmlvbiIsInNpZ24iXSwiaXNzdWVkX2F0IjoxMDAwMDAwMDAwLCJleHBpcmVzX2F0IjowLCJkZXZpY2VfaWQiOiJkZW1vLWRldmljZSJ9.7p2qoJiAV58ObF0LeYUVdPXHaMjzQPChhgyfJu86_UxrzjTsMh_NoeFn3GtwR3he5Xlagv0TGI6mgRSakTboAg";

test("genuine token verifies on its bound device", async () => {
  const e = await verifyLicense(TOKEN, { deviceId: "demo-device" });
  assert.equal(e.licensed, true);
  assert.equal(e.tier, "pro");
  assert.ok(e.features.includes("translate"));
  assert.equal(e.subject, "buyer@example.com");
});

test("token is rejected on a different device", async () => {
  const e = await verifyLicense(TOKEN, { deviceId: "some-other-device" });
  assert.equal(e.licensed, false);
  assert.match(e.reason, /different device/i);
});

test("a tampered signature does not verify", async () => {
  const bad = TOKEN.slice(0, -3) + (TOKEN.endsWith("AAA") ? "BBB" : "AAA");
  const e = await verifyLicense(bad, { deviceId: "demo-device" });
  assert.equal(e.licensed, false);
  assert.match(e.reason, /genuine|verify/i);
});

test("a tampered payload does not verify", async () => {
  const parts = TOKEN.split(".");
  // flip a byte in the payload
  const bad = parts[0] + "." + (parts[1].slice(0, 10) + (parts[1][10] === "A" ? "B" : "A") + parts[1].slice(11)) + "." + parts[2];
  const e = await verifyLicense(bad, { deviceId: "demo-device" });
  assert.equal(e.licensed, false);
});

test("a token with internal whitespace (line-wrapped on paste) still verifies", async () => {
  const wrapped = TOKEN.slice(0, 40) + "\n  " + TOKEN.slice(40, 120) + " \n" + TOKEN.slice(120);
  const e = await verifyLicense(wrapped, { deviceId: "demo-device" });
  assert.equal(e.licensed, true);
  assert.equal(e.tier, "pro");
});

test("garbage and empty are FREE, not crashes", async () => {
  assert.equal((await verifyLicense("")).licensed, false);
  assert.equal((await verifyLicense("not-a-token")).licensed, false);
  assert.equal((await verifyLicense("PPDF1.xxx.yyy")).licensed, false);
});
