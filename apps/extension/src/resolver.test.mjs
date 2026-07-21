// Regression suite for the shared semantic resolver (resolver.js): meaning-matching,
// value derivation (age from DOB, initials), composites, and the government-form
// bundle. These replace the manual "did the dependent DOB fill?" style checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFields, resolveBundle } from "./resolver.js";

const one = (vault, label, maxLength = -1) => resolveFields(vault, [{ label, maxLength }])[0];

test("semantic: differently-named vault keys still resolve", () => {
  const v = { fname: "Asha", surname: "Rao", "e-mail": "asha@example.com" };
  assert.equal(one(v, "Given Name"), "Asha");
  assert.equal(one(v, "Family Name"), "Rao");
  assert.equal(one(v, "Email Address"), "asha@example.com");
});

test("derivation: middle INITIAL from a middle name (maxLength 1)", () => {
  assert.equal(one({ middle_name: "Quincy" }, "Middle Initial", 1), "Q");
});

test("derivation: age is computed from date_of_birth", () => {
  // Someone born on this month/day 30 years ago is exactly 30.
  const now = new Date();
  const dob = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${now.getFullYear() - 30}`;
  assert.equal(one({ date_of_birth: dob }, "Age"), "30");
});

test("semantic: a DEPENDENT's DOB fills from a differently-named dependent key", () => {
  // The exact regression the user hit: vault key 'dependent_1' should map to the
  // dependent concept, and 'Name of Dependent' must NOT grab the user's own name.
  const v = { first_name: "Asha", last_name: "Rao", dependent_1: "Riya Rao", dependent_1_dob: "05/06/2015" };
  assert.equal(one(v, "Name of Dependent"), "Riya Rao");
  assert.equal(one(v, "Dependent 1 Date of Birth"), "05/06/2015");
});

test("composite: a lone Address absorbs the sub-parts", () => {
  const v = { street_address: "123 Maple St", city: "Springfield", state: "IL", zip: "62704" };
  const val = one(v, "Address");
  assert.ok(val.includes("123 Maple St") && val.includes("Springfield") && val.includes("IL") && val.includes("62704"));
});

test("bundle: SSN splits into area/group/serial for boxed forms", () => {
  const b = resolveBundle({ ssn: "123-45-6789", first_name: "Asha", middle_name: "K", last_name: "Rao", city: "Springfield", state: "IL", zip: "62704" });
  assert.equal(b.ssn1, "123");
  assert.equal(b.ssn2, "45");
  assert.equal(b.ssn3, "6789");
  assert.equal(b.firstMiddle, "Asha K");
  assert.equal(b.cityStateZip, "Springfield, IL 62704");
});

test("camelCase field names and dotted abbreviations resolve", () => {
  const v = { date_of_birth: "11/30/68", first_name: "Asha" };
  assert.equal(one(v, "dateOfBirth"), "11/30/68");
  assert.equal(one(v, "DateOfBirth"), "11/30/68");
  assert.equal(one(v, "D.O.B."), "11/30/68");
  assert.equal(one(v, "DOB"), "11/30/68");
  assert.equal(one(v, "firstName"), "Asha");
});

test("document-qualified dates: DL vs passport don't conflate", () => {
  const v = { dl_expiry_date: "08/09/2033", dl_issue_date: "03/16/2023", passport_expiry_date: "11/30/2029", passport_issue_date: "05/01/2019" };
  assert.equal(one(v, "Passport Expiry Date"), "11/30/2029");
  assert.equal(one(v, "License Expiry Date"), "08/09/2033");
  assert.equal(one(v, "Date of Expiry"), "11/30/2029"); // bare expiry defaults to passport
  assert.equal(one(v, "Passport Valid From"), "05/01/2019");
  assert.equal(one(v, "License Issue Date"), "03/16/2023");
});

test("marital status resolves (fills the field / ticks the right option checkbox)", () => {
  assert.equal(one({ marital_status: "Married" }, "Marital Status"), "Married");
  assert.equal(one({ marital_status: "Single" }, "Civil Status"), "Single");
});

test("every option-checkbox concept pdffill relies on actually resolves (guards against referenced-but-undefined)", () => {
  // pdffill.userOptionValues resolves these to tick option checkboxes (gender/nationality/…).
  // If a concept is missing (as 'marital status' was), the box silently never ticks.
  const cases = {
    salutation: "Mr", nationality: "Indian", country: "USA", state: "NC",
    "marital status": "Married", gender: "M",
  };
  const vault = { salutation: "Mr", nationality: "Indian", country: "USA", state: "NC", marital_status: "Married", gender: "M" };
  for (const label of Object.keys(cases)) {
    assert.ok(one(vault, label), `option concept "${label}" must resolve, else its checkbox never ticks`);
  }
});

test("resolver: an unmatched label yields no value (never a wrong guess)", () => {
  assert.equal(one({ first_name: "Asha" }, "Favourite Colour"), null);
});
