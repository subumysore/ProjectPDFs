// Locks the GENERIC proximity labeler against the hard cases seen on the real Japan MOFA visa
// form (XFA field names like T2/RB3), using synthetic geometry so no PDF/pdf.js is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planProximityFill, isEntityText, toDMY } from "./pdfproximity.js";
import { resolveFields } from "./resolver.js";

const T = (page, x, y, s, w = s.length * 5) => ({ page, x, y, w, h: 10, s });
// One synthetic page mirroring the tricky rows: long dropdown label, sex + marital radios whose
// export values are opaque, an employer "Name" that must be skipped, and a day-first DOB.
const texts = [
  T(0, 65, 620, "Surname (as shown in passport)"),
  T(0, 65, 601, "Given and middle names (as shown in passport)"),
  T(0, 65, 552, "Date of birth"), T(0, 130, 543, "(Day)/(Month)/(Year)"),
  T(0, 65, 532, "Sex:"), T(0, 86, 532, "Male", 20), T(0, 132, 532, "Female", 28),
  T(0, 229, 532, "Marital status:"), T(0, 294, 532, "Single", 26), T(0, 348, 532, "Married", 30), T(0, 408, 532, "Widowed", 34), T(0, 476, 532, "Divorced", 34),
  T(0, 65, 509, "Nationality or citizenship", 118), // long: extends past the box's left edge
  T(0, 65, 113, "Name and address of employer"), T(0, 94, 90, "Name", 22), // employer section
];
const fields = [
  { id: "surname", kind: "text", page: 0, rect: { x: 211, y: 620, width: 300, height: 12 } },
  { id: "given", kind: "text", page: 0, rect: { x: 283, y: 601, width: 260, height: 12 } },
  { id: "dob", kind: "text", page: 0, rect: { x: 123, y: 549, width: 78, height: 12 } },
  { id: "sex", kind: "choice", page: 0, rect: { x: 114, y: 530, width: 10, height: 10 }, options: ["M", "F"],
    widgets: [{ page: 0, rect: { x: 114, y: 530, width: 10, height: 10 } }, { page: 0, rect: { x: 171, y: 530, width: 10, height: 10 } }] },
  { id: "marital", kind: "choice", page: 0, rect: { x: 331, y: 530, width: 10, height: 10 }, options: ["1", "2", "4", "3"],
    widgets: [{ page: 0, rect: { x: 331, y: 530, width: 10, height: 10 } }, { page: 0, rect: { x: 390, y: 530, width: 10, height: 10 } }, { page: 0, rect: { x: 458, y: 530, width: 10, height: 10 } }, { page: 0, rect: { x: 524, y: 530, width: 10, height: 10 } }] },
  { id: "nationality", kind: "choice", page: 0, rect: { x: 184, y: 509, width: 366, height: 12 }, options: ["  ", "INDIA", "JAPAN", "USA"], widgets: [{ page: 0, rect: { x: 184, y: 509, width: 366, height: 12 } }] },
  { id: "employer_name", kind: "text", page: 0, rect: { x: 121, y: 88, width: 285, height: 12 } },
];
const VAULT = { first_name: "SUBRAMANYA", middle_name: "VISHWANATHAN", last_name: "MYSORE", date_of_birth: "11/30/1968", gender: "M", marital_status: "Married", nationality: "INDIA" };

const plan = planProximityFill(fields, texts, VAULT, resolveFields);
const get = (id) => plan.assignments.find((a) => a.id === id);

test("citizenship is NOT mistaken for a 'ship' entity (whole-word/stem guard)", () => {
  assert.equal(isEntityText("Nationality or citizenship"), false);
  assert.equal(isEntityText("Names and addresses of hotels or persons"), true); // plural stems
});
test("surname / given+middle resolve by nearest printed caption", () => {
  assert.equal(get("surname").value, "MYSORE");
  assert.equal(get("given").value, "SUBRAMANYA VISHWANATHAN");
});
test("DOB reformats to day-first because the box says (Day)/(Month)/(Year)", () => {
  assert.equal(get("dob").value, "30/11/1968");
  assert.equal(toDMY("11/30/1968"), "30/11/1968");
});
test("sex radio selects M by export value", () => { assert.equal(get("sex").option, "M"); });
test("marital radio maps 'Married' to its OPAQUE export value via the printed label", () => {
  assert.equal(get("marital").option, "2");
});
test("long-label dropdown selects INDIA among many options", () => {
  assert.equal(get("nationality").option, "INDIA");
});
test("employer 'Name' is SKIPPED (different entity), never the applicant's name", () => {
  assert.equal(get("employer_name"), undefined);
  assert.ok(plan.skipped >= 1);
});

// The owner's rule (2026-08-03): a name box under "Other Names You Have Used" / interpreter / preparer
// is a DIFFERENT concept than the applicant's CURRENT legal name — leave it blank, don't fill the
// current name. Uses the nearest name-SECTION heading above (headerAbove sees only the column label).
test("name fields: current legal name fills; Other Names / interpreter left blank", () => {
  const V = { first_name: "SUBRAMANYA", last_name: "MYSORE" };
  const tx = [
    T(0, 40, 700, "1. Your Current Legal Name"),
    T(0, 60, 685, "Family Name (Last Name)"),
    T(0, 40, 600, "2. Other Names You Have Used Since Birth"),
    T(0, 60, 585, "Family Name (Last Name)"),
    T(0, 60, 500, "Interpreter's Family Name (Last Name)"),
  ];
  const F = (id, y) => ({ id, kind: "text", page: 0, rect: { x: 60, y, width: 120, height: 14 } });
  const fields = [F("P2_Line1_FamilyName", 668), F("Line2_FamilyName1", 568), F("Interp_FamilyName", 483)];
  const plan = planProximityFill(fields, tx, V, resolveFields);
  const val = (id) => (plan.assignments.find((a) => a.id === id) || {}).value;
  assert.equal(val("P2_Line1_FamilyName"), "MYSORE", "current legal name fills");
  assert.equal(val("Line2_FamilyName1"), undefined, "Other Names last name left blank");
  assert.equal(val("Interp_FamilyName"), undefined, "interpreter name left blank");
});

// Precision fixes (2026-08-05) from the engine benchmark + the owner's live N-400 report: a field's
// TOOLTIP names the section, so a spouse/marital-history name box stays blank; the applicant's own name
// must NOT land in an ADDRESS box ("Street Number and Name", "In Care Of Name"); and a benign tooltip
// ("… Person applying …") must NOT false-trigger the entity guard on the applicant's own name.
test("tooltip section + address-name guard (N-400 over-fills)", () => {
  const V = { first_name: "SUBRAMANYA", last_name: "MYSORE", address_1: "4308 ALBINO DEER WAY", city: "WAKE FOREST" };
  const tx = [
    T(0, 60, 700, "Family Name (Last Name)"),
    T(0, 60, 640, "Family Name (Last Name)"),
    T(0, 60, 580, "Street Number and Name"),
    T(0, 60, 520, "In Care Of Name (if any)"),
    T(0, 60, 460, "City or Town"),
  ];
  const F = (id, y, tip) => ({ id, kind: "text", page: 0, rect: { x: 60, y, width: 140, height: 14 }, tooltip: tip });
  const fields = [
    F("P2_FamilyName", 683, "Part 2. Information About You (Person applying for naturalization)"),
    F("P10_Line4a_FamilyName", 623, "Part 7. Information About Your Marital History"),
    F("P4_StreetName", 563, "Part 4. Current Mailing Address"),
    F("P4_InCareOfName", 503, "Part 4. Current Mailing Address"),
    F("P4_City", 443, "Part 4. Current Mailing Address"),
  ];
  const plan = planProximityFill(fields, tx, V, resolveFields);
  const val = (id) => (plan.assignments.find((a) => a.id === id) || {}).value;
  assert.equal(val("P2_FamilyName"), "MYSORE", "applicant family name fills (not blocked by 'person')");
  assert.equal(val("P10_Line4a_FamilyName"), undefined, "spouse family name blank (marital-history tooltip)");
  assert.notEqual(val("P4_StreetName"), "MYSORE", "applicant name not in street box");
  assert.notEqual(val("P4_InCareOfName"), "MYSORE", "applicant name not in in-care-of box");
  assert.equal(val("P4_City"), "WAKE FOREST", "city still fills");
});
