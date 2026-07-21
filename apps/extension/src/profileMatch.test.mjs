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
