import { test } from "node:test";
import assert from "node:assert/strict";
import { newSalt, derivePassphraseKey, deriveWebAuthnKey, seal, open } from "./vault.js";

test("passphrase: seal/open round-trip", async () => {
  const salt = newSalt();
  const key = await derivePassphraseKey("correct horse battery staple", salt, 50_000);
  const blob = await seal(key, { full_name: "Asha Rao", nationality: "Indian" });
  const got = await open(key, blob);
  assert.deepEqual(got, { full_name: "Asha Rao", nationality: "Indian" });
});

test("passphrase: wrong passphrase cannot decrypt", async () => {
  const salt = newSalt();
  const k1 = await derivePassphraseKey("right", salt, 50_000);
  const k2 = await derivePassphraseKey("wrong", salt, 50_000);
  const blob = await seal(k1, { secret: "value" });
  await assert.rejects(() => open(k2, blob));
});

test("tamper: flipping a ciphertext byte fails authentication", async () => {
  const salt = newSalt();
  const key = await derivePassphraseKey("pw", salt, 50_000);
  const blob = await seal(key, { a: 1 });
  const [iv, ct] = blob.split(".");
  const bytes = Buffer.from(ct, "base64");
  bytes[bytes.length - 1] ^= 0x01;
  await assert.rejects(() => open(key, `${iv}.${bytes.toString("base64")}`));
});

test("webauthn-prf: derived key round-trips", async () => {
  const salt = newSalt();
  const prfSecret = new Uint8Array(32).fill(7); // stand-in for a real PRF output
  const key = await deriveWebAuthnKey(prfSecret, salt);
  const blob = await seal(key, { device: "bound" });
  assert.deepEqual(await open(key, blob), { device: "bound" });
});

test("migration: passphrase vault re-seals under a WebAuthn key, opens the same", async () => {
  const salt = newSalt();
  const pass = await derivePassphraseKey("pw", salt, 50_000);
  const data = { full_name: "Asha Rao", nationality: "Indian" };
  const blob1 = await seal(pass, data); // created under passphrase
  const opened = await open(pass, blob1); // "unlock" (in-memory vault)
  const pk = await deriveWebAuthnKey(new Uint8Array(32).fill(9), salt);
  const blob2 = await seal(pk, opened); // re-seal under passkey (same salt)
  assert.deepEqual(await open(pk, blob2), data); // opens under passkey
  await assert.rejects(() => open(pass, blob2)); // old passphrase no longer opens it
});

test("keys are non-extractable", async () => {
  const key = await derivePassphraseKey("pw", newSalt(), 50_000);
  assert.equal(key.extractable, false);
});
