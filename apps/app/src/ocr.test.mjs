import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFields } from "./ocr.ts";

const asMap = (text) => Object.fromEntries(parseFields(text).map((f) => [f.ontology_key, f.value]));

// A driver-licence / ID card as OCR typically returns it: "Label value" with a SINGLE space
// and NO colon. This is the layout of docs/guide/demo-assets/sample-id.png. Before the fix the
// parser found only ONE field — it misread the licence number as a phone number.
test("ID card: single-space labels are all captured, licence number is not a phone", () => {
  const text = [
    // OCR frequently merges the top banner onto one line — this must NOT be read as the
    // licence number (the regression that made license_no = "SPECIMEN — DEMO").
    "DRIVER LICENSE SPECIMEN — DEMO",
    "Name JOHN DOE",
    "DOB 04/12/1988",
    "License No D1234-5678-90",
    "Address 100 Sample Ave",
    "City Demo City, DC",
    "Expires 04/12/2032",
    "NOT A REAL DOCUMENT",
  ].join("\n");
  const m = asMap(text);
  assert.equal(m.first_name, "JOHN");
  assert.equal(m.last_name, "DOE");
  assert.equal(m.date_of_birth, "04/12/1988");
  assert.equal(m.license_no, "D1234-5678-90");
  assert.equal(m.address_1, "100 Sample Ave");
  assert.equal(m.city, "Demo City, DC");
  assert.equal(m.expiry_date, "04/12/2032");
  // The licence number must NOT have been mistaken for a phone number.
  assert.equal(m.cell_phone, undefined);
  // Multiple fields, not one.
  assert.ok(Object.keys(m).length >= 6, `expected >=6 fields, got ${Object.keys(m).length}`);
});

// The longest matching label must win: "License No" over "License".
test("longest label wins so the value is not truncated", () => {
  const m = asMap("License No D1234-5678-90");
  assert.equal(m.license_no, "D1234-5678-90");
});

// Colon/dash separated forms (business cards, printed forms) still work, and a REAL phone is read.
test("colon-separated form fields still parse, including a real phone", () => {
  const m = asMap(["Full Name: Asha Rao", "Email: asha@example.com", "Phone: +1 (415) 555-0132"].join("\n"));
  assert.equal(m.first_name, "Asha");
  assert.equal(m.last_name, "Rao");
  assert.equal(m.email_address, "asha@example.com");
  assert.equal(m.cell_phone, "+1 (415) 555-0132");
});

// A label with no value on its line (a header) must not produce a phantom field.
test("label-only header lines produce no field", () => {
  const m = asMap("Name\nAddress");
  assert.equal(Object.keys(m).length, 0);
});

import { documentImageKey } from "./ocr.ts";

// The whole source document image is retained under the SAME ontology the browser extension writes
// (shared vault, single source of truth). Classification: a decoded back barcode → back; a passport
// number → passport; a licence number → front; anything else → a generic document image.
test("documentImageKey aligns with the extension's shared ontology", () => {
  const f = (k) => [{ ontology_key: k, value: "x" }];
  assert.equal(documentImageKey(f("license_no"), true).key, "driver_license_back"); // barcode wins
  assert.equal(documentImageKey(f("passport_no"), false).key, "passport_image");
  assert.equal(documentImageKey(f("license_no"), false).key, "driver_license_front");
  assert.equal(documentImageKey(f("first_name"), false).key, "document_image");
  assert.equal(documentImageKey([], false).key, "document_image");
});
