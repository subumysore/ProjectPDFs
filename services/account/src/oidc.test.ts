import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { assertSafeIssuerUrl, base64url, generatePkce, OidcError } from "./oidc.ts";

test("base64url encodes url-safe without padding", () => {
  assert.equal(base64url(Buffer.from("hello")), "aGVsbG8");
  assert.ok(!base64url(crypto.randomBytes(32)).match(/[+/=]/));
});

test("generatePkce: challenge is S256(verifier)", () => {
  const { verifier, challenge } = generatePkce();
  const expected = base64url(crypto.createHash("sha256").update(verifier).digest());
  assert.equal(challenge, expected);
  assert.ok(verifier.length >= 43); // 32 bytes base64url
});

test("assertSafeIssuerUrl accepts a real https issuer", () => {
  const url = assertSafeIssuerUrl("https://accounts.google.com");
  assert.equal(url.hostname, "accounts.google.com");
});

test("assertSafeIssuerUrl allows localhost only in dev", () => {
  assert.ok(assertSafeIssuerUrl("http://localhost:8080", false));
  assert.throws(() => assertSafeIssuerUrl("http://localhost:8080", true), OidcError);
});

test("assertSafeIssuerUrl rejects empty / insecure / private / metadata hosts", () => {
  for (const bad of [
    "",
    "not-a-url",
    "http://example.com", // insecure, non-localhost
    "https://169.254.169.254", // cloud metadata (link-local)
    "https://10.0.0.5", // private
    "https://192.168.1.1", // private
    "https://db.internal", // internal
  ]) {
    assert.throws(() => assertSafeIssuerUrl(bad), OidcError, `expected reject: ${bad}`);
  }
});
