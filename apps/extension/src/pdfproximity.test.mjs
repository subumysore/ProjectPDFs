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

// Ownership as a GENERAL rule (2026-08-05), not per-form keyword lists (owner's ask: "fix the pattern,
// build intelligence"). A non-self POSSESSIVE ("X's field", X≠you/applicant) marks someone else's box.
import { otherSubject } from "./pdfproximity.js";
test("ownership: a non-self possessive marks another subject's field", () => {
  assert.equal(otherSubject("Interpreter's Family Name (Last Name)", "", ""), true);
  assert.equal(otherSubject("Family Name", "Part 12. Preparer's Contact Information", ""), true);
  assert.equal(otherSubject("Current Spouse's Current Employer", "", ""), true);
  assert.equal(otherSubject("Son or Daughter's Name", "", ""), true);
  assert.equal(otherSubject("Decedent's name", "", ""), true);
  assert.equal(otherSubject("Applicant's Signature", "", ""), false, "applicant IS self");
  assert.equal(otherSubject("Your Current Legal Name", "", ""), false, "your = self");
  assert.equal(otherSubject("Family Name (Last Name)", "Part 2. Information About You", ""), false);
});

// ── Regression: N-400 Part 3/4 address bugs (owner-reported 2026-08-06) ───────────────────────────
// (1) State DROPDOWN must select the option (not stay blank while Province filled).
// (2) The current "Street Number and Name" must get the STREET — the word "Name" in the label
//     mis-pulled the applicant's name, which the addr-guard then blanked.
// (3) The residence "list every location where you have lived during the last 5 years" TABLE rows must
//     stay blank (numbered leaf) while the current (non-numbered) address fills.
import { repeatingHistoryRow } from "./pdfproximity.js";

test("repeatingHistoryRow: XFA container index (#subform[2]) is NOT a row; leaf digit IS", () => {
  const lead = "List every location where you have lived during the last 5 years";
  // current address — leaf ends in a word => fills even inside the residence section
  assert.equal(repeatingHistoryRow({ id: "form1[0].#subform[2].P4_Line1_StreetName[0]" }, "", lead), false);
  assert.equal(repeatingHistoryRow({ id: "form1[0].#subform[2].P4_Line1_City[0]" }, "", lead), false);
  // table rows — leaf ends in a digit => blank
  assert.equal(repeatingHistoryRow({ id: "form1[0].#subform[2].P4_Line3_PhysicalAddress2[0]" }, "", lead), true);
  assert.equal(repeatingHistoryRow({ id: "form1[0].#subform[2].P4_Line3_State1[0]" }, "", lead), true);
  // …but only when the section actually says to LIST history (no lead => a lone "Address2" still fills)
  assert.equal(repeatingHistoryRow({ id: "x.Address2[0]" }, "", "Current Mailing Address"), false);
});

test("N-400 address: street fills, State dropdown selects, history rows blank", () => {
  const V = { full_name: "SUBRAMANYA VISHWANATHAN MYSORE", first_name: "SUBRAMANYA", middle_name: "VISHWANATHAN", last_name: "MYSORE", street_address: "4308 ALBINO DEER WAY", city: "WAKE FOREST", state: "NC", zip_code: "27587-3971", country: "USA" };
  const tx = [
    T(0, 60, 700, "List every location where you have lived during the last 5 years."),
    T(0, 60, 660, "Current Physical Address"),
    T(0, 60, 636, "Street Number and Name"),           // label left of the street box
    T(0, 60, 600, "City or Town"), T(0, 470, 600, "State"),
    T(0, 60, 300, "Physical Address (Street Number and Name)"), // table header
  ];
  // Boxes sit to the RIGHT of their labels (same row) so captionFor picks the label.
  const F = (id, y, extra = {}) => ({ id, kind: "text", page: 0, rect: { x: 260, y, width: 200, height: 12 }, ...extra });
  const fields = [
    F("form1[0].#subform[2].P4_Line1_StreetName[0]", 634),
    F("form1[0].#subform[2].P4_Line1_City[0]", 598),
    { id: "form1[0].#subform[2].P4_Line1_State[0]", kind: "choice", page: 0, rect: { x: 510, y: 598, width: 60, height: 12 }, options: [" ", " NC", " NY", " CA"], widgets: [{ page: 0, rect: { x: 510, y: 598, width: 60, height: 12 } }] },
    F("form1[0].#subform[2].P4_Line3_PhysicalAddress2[0]", 296),
    F("form1[0].#subform[2].P4_Line3_PhysicalAddress3[0]", 268),
  ];
  const plan = planProximityFill(fields, tx, V, resolveFields);
  const a = (frag) => plan.assignments.find((x) => x.id.includes(frag)) || {};
  assert.equal(a("P4_Line1_StreetName").value, "4308 ALBINO DEER WAY", "current street fills (not blank/name)");
  assert.equal(a("P4_Line1_City").value, "WAKE FOREST", "current city fills");
  assert.match(String(a("P4_Line1_State").option || ""), /NC/, "State dropdown selects the NC option");
  assert.equal(a("P4_Line3_PhysicalAddress2").value, undefined, "history table row 2 stays blank");
  assert.equal(a("P4_Line3_PhysicalAddress3").value, undefined, "history table row 3 stays blank");
});
