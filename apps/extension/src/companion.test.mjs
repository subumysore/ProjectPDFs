import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldUseDesktopVault, migrationPlan, reconcileVaults } from "./companion.js";

test("shouldUseDesktopVault: true only when the companion ping succeeds", () => {
  assert.equal(shouldUseDesktopVault({ ok: true }), true);
  assert.equal(shouldUseDesktopVault({ ok: false, error: "x" }), false);
  assert.equal(shouldUseDesktopVault(null), false);
  assert.equal(shouldUseDesktopVault(undefined), false);
});

test("migrationPlan: extension-first — seeds an empty desktop vault with all local fields", () => {
  const local = { first_name: "SUBRAMANYA", email: "a@b.com" };
  const plan = migrationPlan(local, {}, { migrated: false, unlocked: true });
  assert.deepEqual(
    plan.sort((a, b) => a.key.localeCompare(b.key)),
    [
      { key: "email", value: "a@b.com" },
      { key: "first_name", value: "SUBRAMANYA" },
    ],
  );
});

test("migrationPlan: safe union — never clobbers a value the desktop vault already has", () => {
  const local = { first_name: "SUBRAMANYA", email: "new@b.com", phone: "123" };
  const desktop = { first_name: "SUBRAMANYA", email: "existing@b.com" }; // desktop-first data
  // only `phone` is missing on the desktop side → only it is pushed up
  assert.deepEqual(migrationPlan(local, desktop, { migrated: false, unlocked: true }), [
    { key: "phone", value: "123" },
  ]);
});

test("migrationPlan: fills desktop keys that exist but are empty", () => {
  const plan = migrationPlan({ email: "a@b.com" }, { email: "" }, { migrated: false, unlocked: true });
  assert.deepEqual(plan, [{ key: "email", value: "a@b.com" }]);
});

test("migrationPlan: does not run when already migrated, locked, or empty", () => {
  assert.deepEqual(migrationPlan({ a: "1" }, {}, { migrated: true, unlocked: true }), []);
  assert.deepEqual(migrationPlan({ a: "1" }, {}, { migrated: false, unlocked: false }), []);
  assert.deepEqual(migrationPlan({}, {}, { migrated: false, unlocked: true }), []);
  assert.deepEqual(migrationPlan(null, {}, { migrated: false, unlocked: true }), []);
  assert.deepEqual(migrationPlan({ a: "1" }, {}, null), []);
});

test("reconcileVaults: fields on only one side copy to the other (no loss)", () => {
  const { toLocal, toRemote } = reconcileVaults(
    { first_name: { value: "SUBRAMANYA", updated_at: 10 } },
    { email: { value: "a@b.com", updated_at: 5 } },
  );
  assert.deepEqual(toRemote, { first_name: { value: "SUBRAMANYA", updated_at: 10 } });
  assert.deepEqual(toLocal, { email: { value: "a@b.com", updated_at: 5 } });
});

test("reconcileVaults: newer timestamp wins on conflict", () => {
  // local newer → push local to remote, nothing back
  let r = reconcileVaults({ email: { value: "new@b.com", updated_at: 20 } }, { email: { value: "old@b.com", updated_at: 10 } });
  assert.deepEqual(r.toRemote, { email: { value: "new@b.com", updated_at: 20 } });
  assert.deepEqual(r.toLocal, {});
  // remote newer → pull remote to local, nothing pushed
  r = reconcileVaults({ email: { value: "old@b.com", updated_at: 10 } }, { email: { value: "new@b.com", updated_at: 20 } });
  assert.deepEqual(r.toLocal, { email: { value: "new@b.com", updated_at: 20 } });
  assert.deepEqual(r.toRemote, {});
});

test("reconcileVaults: identical values need no writes; equal-timestamp tie → remote wins", () => {
  assert.deepEqual(reconcileVaults({ a: { value: "x", updated_at: 5 } }, { a: { value: "x", updated_at: 5 } }), { toLocal: {}, toRemote: {} });
  const r = reconcileVaults({ a: { value: "L", updated_at: 5 } }, { a: { value: "R", updated_at: 5 } });
  assert.deepEqual(r.toLocal, { a: { value: "R", updated_at: 5 } });
  assert.deepEqual(r.toRemote, {});
});

test("reconcileVaults: missing timestamps treated as 0 (older than any real edit)", () => {
  const r = reconcileVaults({ a: { value: "L" } }, { a: { value: "R", updated_at: 3 } });
  assert.deepEqual(r.toLocal, { a: { value: "R", updated_at: 3 } }); // remote (t=3) beats local (t=0)
  assert.deepEqual(r.toRemote, {});
});
