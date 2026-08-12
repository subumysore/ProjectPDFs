// Encrypted backup/transfer must carry the WHOLE vault — every profile — not just the active one.
// This is the test that was missing: a user with two profiles (Pranav, Subu) exports, imports on
// another device, and BOTH come back under their own names. The old single-profile format silently
// shipped only the selected profile, so "I imported the vault but only got PRANAV" was invisible to
// the suite. v1 files (one profile) must still import, as a one-entry list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { exportVault, exportVaultAll, importVault } from "./backup.js";

const PASS = "correct horse staple";

test("v2 round-trip: the whole vault (all profiles) survives export → import", async () => {
  const profiles = [
    { id: "p1", name: "Pranav", data: { first_name: "Pranav", city: "Bengaluru" } },
    { id: "p2", name: "Subu", data: { first_name: "Subu", city: "Mysuru", email: "s@x.io" } },
  ];
  const bytes = await exportVaultAll(PASS, profiles, "device-A");
  const out = await importVault(PASS, bytes);
  assert.equal(out.profiles.length, 2, "both profiles must come back");
  const byName = Object.fromEntries(out.profiles.map((p) => [p.name, p.data]));
  assert.deepEqual(byName["Pranav"], { first_name: "Pranav", city: "Bengaluru" });
  assert.deepEqual(byName["Subu"], { first_name: "Subu", city: "Mysuru", email: "s@x.io" });
  // names + ids preserved so a re-import merges into the same profile, not a duplicate
  assert.deepEqual(out.profiles.map((p) => p.id).sort(), ["p1", "p2"]);
});

test("v1 round-trip still works and is presented as a one-profile list", async () => {
  const bytes = await exportVault(PASS, { first_name: "Asha" }, "asha@example.com");
  const out = await importVault(PASS, bytes);
  assert.deepEqual(out.data, { first_name: "Asha" });
  assert.equal(out.profiles.length, 1);
  assert.equal(out.profiles[0].name, "asha@example.com");
  assert.deepEqual(out.profiles[0].data, { first_name: "Asha" });
});

test("a v2 export with one profile is not lossy either", async () => {
  const bytes = await exportVaultAll(PASS, [{ name: "Solo", data: { a: "1" } }]);
  const out = await importVault(PASS, bytes);
  assert.equal(out.profiles.length, 1);
  assert.deepEqual(out.profiles[0].data, { a: "1" });
});

test("wrong passphrase is rejected, not silently empty", async () => {
  const bytes = await exportVaultAll(PASS, [{ name: "Pranav", data: { a: "1" } }]);
  await assert.rejects(() => importVault("wrong pass", bytes), /wrong passphrase|tampered/);
});
