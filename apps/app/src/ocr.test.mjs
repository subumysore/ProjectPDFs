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
  assert.equal(documentImageKey(f("license_no"), { isBarcodeBack: true }).key, "driver_license_back"); // barcode wins
  assert.equal(documentImageKey(f("passport_no")).key, "passport_image");
  assert.equal(documentImageKey(f("license_no")).key, "driver_license_front");
  assert.equal(documentImageKey(f("first_name")).key, "driver_license_front"); // identity present
  assert.equal(documentImageKey([]).key, "document_image");
});

// REGRESSION: a licence FRONT whose name/DOB OCR is weak, leaving only the banner + a bare licence
// number (e.g. 000026610696). The number must be captured as license_no (NOT cell_phone), which in
// turn makes the card classify as driver_license_front — not "back". Before the fix the number went
// to cell_phone, so there was no identity and the front fell through to driver_license_back.
test("licence front: bare id number → license_no (not cell_phone) → classifies as front", () => {
  const m = asMap("DRIVER LICENSE\n000026610696\nSAMPLE STATE\nDONOR");
  assert.equal(m.license_no, "000026610696", "leading-zero number on a DL is the licence number");
  assert.equal(m.cell_phone, undefined, "must NOT be mislabelled as a phone");
  assert.equal(documentImageKey(parseFields("DRIVER LICENSE\n000026610696"), { text: "DRIVER LICENSE\n000026610696" }).key, "driver_license_front");
});

// The BACK of a licence has NO identity fields but DOES carry class/restriction/endorsement text —
// OCR (no barcode) must still classify it as driver_license_back, so its image saves as a KV pair.
test("documentImageKey: OCR'd licence back (no barcode) → driver_license_back from text markers", () => {
  const backText = "The State of Florida\nDriver License (back)\nCLASS: E\nREST: None\nEND: None";
  assert.equal(documentImageKey([], { text: backText }).key, "driver_license_back");
  // a passport data page (text) → passport_image even without a parsed passport_no
  assert.equal(documentImageKey([], { text: "United States of America PASSPORT" }).key, "passport_image");
  // a plain document with no markers → generic
  assert.equal(documentImageKey([], { text: "Hello world" }).key, "document_image");
});

test("passport 'Given names' splits into first (+middle), not first_name='names: ...'", () => {
  const m = asMap(["Surname: DOE", "Given names: JOHN QUINCY", "Passport No: X1234567"].join("\n"));
  assert.equal(m.last_name, "DOE");
  assert.equal(m.first_name, "JOHN");
  assert.equal(m.passport_no, "X1234567");
  assert.ok(!/names:/i.test(m.first_name || ""));
});

// ── Regression: driver-licence FRONT OCR mis-attribution (owner-reported 2026-08-06) ──────────────
// A US licence's EXPIRY is in the future and often falls on the birthday (same MM/DD). When the printed
// DOB OCRs garbled, the expiry (11/30/2029) used to masquerade as the birth date; and a ZIP+4 used to
// be seized as the licence number.
test("licence OCR: a future expiry is NEVER adopted as the date_of_birth", () => {
  // Only the expiry OCR'd as a clean MM/DD/YYYY; the DOB came through in a different (dashed) form.
  const m = asMap(["NORTH CAROLINA DRIVER LICENSE", "MYSORE, SUBRAMANYA", "DOB 11-30-1968", "EXP 11/30/2029"].join("\n"));
  assert.notEqual(m.date_of_birth, "11/30/2029", "an expiry/future date must not be a birth date");
});

test("licence OCR: DOB is the earliest BIRTH-PLAUSIBLE slash-date (not merely the earliest date)", () => {
  const m = asMap(["DRIVER LICENSE", "DOB 11/30/1968", "ISS 11/30/2021", "EXP 11/30/2029"].join("\n"));
  assert.equal(m.date_of_birth, "11/30/1968");
  assert.equal(m.expiry_date, "11/30/2029");
});

test("licence OCR: a ZIP+4 is never kept as the licence number", () => {
  // The exact owner-reported failure: the ZIP+4 landed in license_no.
  const m = asMap(["NORTH CAROLINA DRIVER LICENSE", "License No 27587-3971"].join("\n"));
  assert.notEqual(m.license_no, "27587-3971", "a ZIP+4 is an address, not a licence number");
});

test("licence OCR: a real licence number IS kept", () => {
  const m = asMap(["DRIVER LICENSE", "License No D1234567"].join("\n"));
  assert.equal(m.license_no, "D1234567");
});

test("licence OCR: two numbers on adjacent lines never fuse into one value", () => {
  const m = asMap(["DRIVER LICENSE", "000026610696", "27587-3971"].join("\n"));
  assert.equal(m.license_no, "000026610696", "the licence number stands alone, not fused with the ZIP");
});

// Regression (caught by real-image testing 2026-08-06): the ZIP-shape guard must NOT delete a valid
// 9-digit passport/ID number — a US ZIP+4 has a SEPARATOR (27587-3971); a bare 9-digit run is an ID.
test("a bare 9-digit passport number is kept (not mistaken for a ZIP+4)", () => {
  const m = asMap(["UNITED STATES OF AMERICA PASSPORT", "Passport No 352279543", "DOB 30 NOV 1968"].join("\n"));
  assert.equal(m.passport_no, "352279543");
});

// ── Payment-card OCR (2026-08-06): scan a credit/debit card to pre-fill Saved cards ───────────────
test("payment card: a Luhn-valid number + expiry + name → card_* fields (not a licence)", () => {
  const m = asMap(["VISA", "4242 4242 4242 4242", "VALID THRU 08/27", "JOHN Q PUBLIC"].join("\n"));
  assert.equal(m.card_number, "4242 4242 4242 4242");
  assert.equal(m.card_expiry, "08/27");
  assert.equal(m.card_name, "JOHN Q PUBLIC");
  assert.equal(m.license_no, undefined, "a card number must not be mis-filed as a licence");
});

test("payment card: a non-Luhn 16-digit number is NOT treated as a card", () => {
  const m = asMap(["1234 5678 9012 3456"].join("\n"));
  assert.notEqual(m.card_number, "1234 5678 9012 3456");
});

test("payment card: 4-year expiry is normalised to MM/YY", () => {
  const m = asMap(["5555 5555 5555 4444", "Expires 11/2029"].join("\n"));
  assert.equal(m.card_number, "5555 5555 5555 4444"); // Mastercard test number (Luhn-valid)
  assert.equal(m.card_expiry, "11/29");
});
