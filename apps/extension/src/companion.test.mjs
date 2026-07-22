import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldUseDesktopVault, migrationPlan } from "./companion.js";

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
