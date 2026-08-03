import { test } from "node:test";
import assert from "node:assert/strict";
import { listRecords, pickRecord, recordVault, maskCard, cardSecurityNotes, detectCardBrand, cardTypeLabel } from "./groups.js";
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

test("detectCardBrand identifies the brand from the number prefix", () => {
  assert.equal(detectCardBrand("4111111111111111"), "visa");
  assert.equal(detectCardBrand("5500 0000 0000 0004"), "mastercard");
  assert.equal(detectCardBrand("2221000000000009"), "mastercard"); // new 2-series MC range
  assert.equal(detectCardBrand("340000000000009"), "amex");
  assert.equal(detectCardBrand("6011000000000004"), "discover");
  assert.equal(detectCardBrand("3600000000000008"), "diners");
  assert.equal(detectCardBrand("3530111333300000"), "jcb");
  assert.equal(detectCardBrand("6212345678901232"), "unionpay");
  assert.equal(detectCardBrand(""), "");
  assert.equal(detectCardBrand("9999"), "");
});

test("cardTypeLabel normalises the sub-type", () => {
  assert.equal(cardTypeLabel("debit"), "Debit");
  assert.equal(cardTypeLabel("Credit Card"), "Credit");
  assert.equal(cardTypeLabel("cash"), "Cash");
  assert.equal(cardTypeLabel(""), "");
});

test("a saved card record fills a payment form (card fields + billing), without touching mailing address", () => {
  const base = { first_name: "SUBRAMANYA", last_name: "MYSORE", address_1: "4308 ALBINO DEER WAY", city: "WAKE FOREST", state: "NC", zip: "27587" };
  const card = { type: "card", id: "v1", label: "Visa", primary: true, fields: {
    card_name: "SUBRAMANYA MYSORE", card_number: "4111111111111111", card_expiry: "12/28", card_cvv: "123", card_type: "credit",
    billing_address_1: "999 BILLING BLVD", billing_city: "BILLTOWN", billing_state: "CA", billing_zip: "90001",
  } };
  const v = recordVault({ ...base, records: [card] }, card);
  const ask = (label) => resolveFields(v, [{ label }])[0];
  assert.equal(ask("Name on card"), "SUBRAMANYA MYSORE");
  assert.equal(ask("Card Number"), "4111111111111111");
  assert.equal(ask("CVV"), "123");
  assert.equal(ask("Valid thru"), "12/28");
  assert.equal(ask("Billing Address"), "999 BILLING BLVD");
  assert.equal(ask("Billing City"), "BILLTOWN");
  assert.equal(ask("Billing Zip"), "90001");
  // the plain MAILING address is untouched by the card's billing address
  assert.equal(ask("City"), "WAKE FOREST");
  assert.equal(ask("Address line 1"), "4308 ALBINO DEER WAY");
});
