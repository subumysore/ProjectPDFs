// Regression suite for the on-device ID/document text parsers (parse.js). These are
// the exact scenarios that used to be verified by hand on real IDs — now automated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFields, parseMrz, parseAamva } from "./parse.js";

const map = (pairs) => Object.fromEntries(pairs.map((p) => [p.ontology_key, p.value]));

// ---- AAMVA (US/Canada driver's-licence PDF417 barcode, back of card) ----------
test("AAMVA: US licence — name, address, DOB (MMDDCCYY), sex", () => {
  const payload = [
    "DCSDOE", "DACJOHN", "DADQUINCY",
    "DAG123 MAPLE ST", "DAISPRINGFIELD", "DAJIL", "DAK627040000",
    "DAQD1234567", "DBC1", "DBB01151985", "DCGUSA",
  ].join("\n");
  const r = map(parseAamva(payload));
  assert.equal(r.last_name, "DOE");
  assert.equal(r.first_name, "JOHN");
  assert.equal(r.middle_name, "QUINCY");
  assert.equal(r.address_1, "123 MAPLE ST");
  assert.equal(r.city, "SPRINGFIELD");
  assert.equal(r.state, "IL");
  assert.equal(r.zip, "62704-0000");
  assert.equal(r.license_number, "D1234567");
  assert.equal(r.gender, "M");
  assert.equal(r.date_of_birth, "01/15/1985");
});

test("AAMVA: Canadian licence uses CCYYMMDD DOB order", () => {
  const payload = ["DCSTREMBLAY", "DACMARIE", "DBB19900228", "DCGCAN", "DBC2"].join("\n");
  const r = map(parseAamva(payload));
  assert.equal(r.date_of_birth, "02/28/1990");
  assert.equal(r.gender, "F");
});

test("AAMVA: legacy DAA packed name 'LAST,FIRST,MIDDLE'", () => {
  const r = map(parseAamva("DAASMITH,JANE,ANN\nDBB03031975"));
  assert.equal(r.last_name, "SMITH");
  assert.equal(r.first_name, "JANE");
  assert.equal(r.middle_name, "ANN");
});

// ---- MRZ (ICAO 9303 — international passports & ID cards) -----------------------
test("MRZ TD3: passport (2×44) — name, number, nationality, DOB, sex, expiry", () => {
  const mrz =
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\n" +
    "L898902C36UTO7408122F1204159ZE184226B<<<<<10";
  const r = map(parseMrz(mrz));
  assert.equal(r.last_name, "ERIKSSON");
  assert.equal(r.first_name, "ANNA");
  assert.equal(r.middle_name, "MARIA");
  assert.equal(r.passport_no, "L898902C3");
  assert.equal(r.nationality, "UTO");
  assert.equal(r.date_of_birth, "08/12/1974");
  assert.equal(r.gender, "F");
  assert.equal(r.expiry_date, "04/15/2012");
});

test("MRZ TD1: national ID card (3×30)", () => {
  const mrz =
    "IDUTOD231458907<<<<<<<<<<<<<<<\n" +
    "7408122F1204159UTO<<<<<<<<<<<6\n" +
    "ERIKSSON<<ANNA<MARIA<<<<<<<<<<";
  const r = map(parseMrz(mrz));
  assert.equal(r.last_name, "ERIKSSON");
  assert.equal(r.first_name, "ANNA");
  assert.equal(r.date_of_birth, "08/12/1974");
  assert.equal(r.gender, "F");
  assert.equal(r.nationality, "UTO");
});

test("MRZ: plain OCR text with no '<' filler is NOT parsed as an MRZ", () => {
  // A driver's-licence FRONT has no filler chars — must not false-match.
  assert.equal(parseMrz("JOHN DOE\n123 MAPLE STREET\nSPRINGFIELD IL 62704").length, 0);
});

// ---- parseFields: labelled + heuristic behaviour ------------------------------
test("parseFields: a long DLN is NOT captured as a phone number", () => {
  const r = map(parseFields("Name: John Doe\nDLN: 123456789012\nPhone: (217) 555-0143"));
  assert.equal(r.cell_phone, "(217) 555-0143");
});

test("parseFields: passport MRZ is authoritative (DL heuristics skipped)", () => {
  const text =
    "PASSPORT\n" +
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\n" +
    "L898902C36UTO7408122F1204159ZE184226B<<<<<10";
  const r = map(parseFields(text));
  assert.equal(r.last_name, "ERIKSSON");
  assert.equal(r.first_name, "ANNA");
  assert.equal(r.passport_no, "L898902C3");
});

test("parseFields: splits a packed 'City: .. State: .. Zip: ..' line", () => {
  const r = map(parseFields("City: Springfield State: IL Zip: 62704"));
  assert.equal(r.city, "Springfield");
  assert.equal(r.state, "IL");
  assert.equal(r.zip, "62704");
});
