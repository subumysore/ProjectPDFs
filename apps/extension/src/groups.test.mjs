import { test } from "node:test";
import assert from "node:assert/strict";
import { listRecords, pickRecord, recordVault, maskCard, cardSecurityNotes } from "./groups.js";
import { resolveFields } from "./resolver.js";

const VAULT = {
  first_name: "SUBRAMANYA", last_name: "MYSORE",
  records: [
    { type: "card", id: "visa1", label: "Personal Visa", primary: true, fields: { cc_name: "S V MYSORE", cc_number: "4111111111111111", cc_exp: "08/29" } },
    { type: "card", id: "amex1", label: "Amex Business", fields: { cc_name: "SUBRAMANYA MYSORE", cc_number: "378282246310005", cc_exp: "05/28", cc_csc: "1234" } },
    { type: "profile", id: "child1", label: "Child — Aarav", fields: { first_name: "AARAV", last_name: "MYSORE", date_of_birth: "05/10/2015" } },
  ],
};

test("listRecords filters by type, primary first", () => {
  const cards = listRecords(VAULT, "card");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].id, "visa1"); // primary first
  assert.equal(listRecords(VAULT, "profile").length, 1);
});

test("pickRecord by id, else primary/first", () => {
  assert.equal(pickRecord(VAULT, "card", "amex1").id, "amex1");
  assert.equal(pickRecord(VAULT, "card").id, "visa1");     // default → primary
  assert.equal(pickRecord(VAULT, "card", "nope").id, "visa1");
  assert.equal(pickRecord(VAULT, "address"), null);
});

test("recordVault merges the chosen card so the resolver fills FROM it", () => {
  const v = recordVault(VAULT, pickRecord(VAULT, "card", "amex1"));
  assert.equal(v.cc_number, "378282246310005");
  assert.ok(!("records" in v));                 // the record list itself never leaks into a fill
  assert.equal(v.last_name, "MYSORE");          // base identity preserved
});

test("a chosen PROFILE fills as that person (not the account holder)", () => {
  const v = recordVault(VAULT, pickRecord(VAULT, "profile", "child1"));
  assert.equal(resolveFields(v, [{ label: "First name" }])[0], "AARAV");
  assert.equal(resolveFields(v, [{ label: "Date of birth" }])[0], "05/10/2015");
});

test("maskCard shows only the last 4; CVV storage is flagged", () => {
  assert.equal(maskCard("4111111111111111"), "•••• 1111");
  assert.equal(cardSecurityNotes(pickRecord(VAULT, "card", "amex1")).length, 1); // Amex has CVV → flagged
  assert.equal(cardSecurityNotes(pickRecord(VAULT, "card", "visa1")).length, 0);
});
