// Regression suite for identity matching (profileMatch.js, RFC-0007): match a scanned
// ID to an existing profile by full name + DOB, else treat it as a new person.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normDob, identityOf, sameIdentity, findMatch, profileNameFrom } from "./profileMatch.js";

test("normDob: 2- and 4-digit years canonicalise to the same key", () => {
  assert.equal(normDob("11/30/1968"), normDob("11/30/68"));
  assert.equal(normDob("1/5/2001"), "01052001");
});

test("identityOf: first+last only (middle name ignored)", () => {
  const a = identityOf({ first_name: "John", middle_name: "Q", last_name: "Doe", date_of_birth: "01/15/1985" });
  const b = identityOf({ first_name: "John", last_name: "Doe", date_of_birth: "01/15/85" });
  assert.ok(sameIdentity(a, b));
});

test("identityOf: derives first/last from a full_name", () => {
  const id = identityOf({ full_name: "Jane Ann Smith", dob: "03/03/1975" });
  assert.equal(id.name, "jane smith");
});

test("sameIdentity: same name but different DOB is NOT a match", () => {
  const a = identityOf({ first_name: "John", last_name: "Doe", date_of_birth: "01/15/1985" });
  const b = identityOf({ first_name: "John", last_name: "Doe", date_of_birth: "02/20/1990" });
  assert.equal(sameIdentity(a, b), false);
});

test("findMatch: locates the existing profile id, else null for a new person", () => {
  const profiles = {
    p1: { name: "John Doe", data: { first_name: "John", last_name: "Doe", date_of_birth: "01/15/1985" } },
    p2: { name: "Jane Smith", data: { first_name: "Jane", last_name: "Smith", date_of_birth: "03/03/1975" } },
  };
  assert.equal(findMatch(profiles, { first_name: "John", last_name: "Doe", date_of_birth: "1/15/85" }), "p1");
  assert.equal(findMatch(profiles, { first_name: "Alan", last_name: "Turing", date_of_birth: "06/23/1912" }), null);
});

test("profileNameFrom: human name from scanned data, else a fallback", () => {
  assert.equal(profileNameFrom({ first_name: "John", last_name: "Doe" }), "John Doe");
  assert.equal(profileNameFrom({}), "New profile");
});

import { chooseDataProfile } from "./profileMatch.js";

test("chooseDataProfile: binds to the profile WITH data, not an empty auto-created one", () => {
  const profiles = [{ id: "me-empty" }, { id: "john" }];   // "me-empty" is listed first
  const counts = { "me-empty": 0, john: 28 };
  assert.equal(chooseDataProfile(profiles, counts, undefined), "john");
});

test("chooseDataProfile: does NOT latch onto a remembered EMPTY profile", () => {
  const profiles = [{ id: "me-empty" }, { id: "john" }];
  const counts = { "me-empty": 0, john: 28 };
  // Even though 'me-empty' was remembered, it has no data now → re-pick the populated one.
  assert.equal(chooseDataProfile(profiles, counts, "me-empty"), "john");
});

test("chooseDataProfile: keeps a remembered choice while it still holds data", () => {
  const profiles = [{ id: "john" }, { id: "jane" }];
  const counts = { john: 12, jane: 30 };
  // 'john' has fewer fields than 'jane' but is remembered and non-empty → stays put (no churn).
  assert.equal(chooseDataProfile(profiles, counts, "john"), "john");
});

test("chooseDataProfile: all-empty falls back to the first profile; no profiles → null", () => {
  assert.equal(chooseDataProfile([{ id: "a" }, { id: "b" }], { a: 0, b: 0 }, undefined), "a");
  assert.equal(chooseDataProfile([], {}, undefined), null);
});

test("chooseDataProfile: an EXPLICIT user choice is sticky, even over a bigger profile", () => {
  const profiles = [{ id: "personal" }, { id: "work" }];
  const counts = { personal: 12, work: 40 };
  // The user explicitly chose "personal"; it must NOT be swapped for the larger "work".
  assert.equal(chooseDataProfile(profiles, counts, "personal", true), "personal");
  // Explicit choice sticks even if it is currently empty (until they change it).
  assert.equal(chooseDataProfile(profiles, { personal: 0, work: 40 }, "personal", true), "personal");
  // But a stale explicit id that no longer exists falls back to auto-pick.
  assert.equal(chooseDataProfile(profiles, counts, "deleted", true), "work");
});
