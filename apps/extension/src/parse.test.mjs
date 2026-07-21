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
  assert.equal(r.zip, "62704"); // ZIP+4 with a 0000 filler collapses to the 5-digit zip
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
  assert.equal(r.passport_expiry_date, "04/15/2012"); // document-qualified (passport)
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

test("DL front OCR: EXP/ISS -> dl dates, no date digits misread as a phone", () => {
  const dl = "NORTH CAROLINA DRIVER LICENSE\n4d DLN 000026610696\n3 DOB 11/30/1968\n4b EXP 11/30/2029\n1 MYSORE\n2 SUBRAMANYA\n4a ISS 03/16/2023";
  const r = map(parseFields(dl));
  assert.equal(r.dl_expiry_date, "11/30/2029");
  assert.equal(r.dl_issue_date, "03/16/2023");
  assert.equal(r.date_of_birth, "11/30/1968");
  assert.equal(r.cell_phone, undefined); // a licence has no phone number
});

test("DL OCR: a fused CLASS letter is stripped from a name", () => {
  const r = map(parseFields("DRIVER LICENSE\n1 MYSORE\n2 SUBRAMANYA VISHWANATHANC\n9 CLASS C\n15 SEX M"));
  assert.equal(r.middle_name, "VISHWANATHAN");
  assert.equal(r.first_name, "SUBRAMANYA");
});

test("parseFields: splits a packed 'City: .. State: .. Zip: ..' line", () => {
  const r = map(parseFields("City: Springfield State: IL Zip: 62704"));
  assert.equal(r.city, "Springfield");
  assert.equal(r.state, "IL");
  assert.equal(r.zip, "62704");
});
