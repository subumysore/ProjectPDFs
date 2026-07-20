// Data-driven form-template registry — the "know the form" layer.
//
// For NAMED forms (IRS W-2/W-9/W-4, Form I-9, …) generic label-matching is not
// enough: the boxes carry form-specific meaning (box "a" is the *employee's* SSN,
// not the employer's), labels are compound, and most cells are data the user
// doesn't own. A template says, per form, WHICH concept each printed label wants —
// and the value is still derived through the shared semantic resolver, so nothing
// about the user's own vault-key naming is hardcoded. OCR supplies WHERE each box
// is; the template supplies WHAT goes there. Adding a new form = adding one entry
// here — no code changes — which is what keeps this future-proof.
//
// A rule:  { on: /regex tested against the printed label/, ask: "canonical concept",
//            place: "below" | "right" }
// `ask` is fed to resolveFields() exactly like a form field label, so "name",
// "first name", "last name", "social security number", "address" all resolve with
// the same intelligence used everywhere else.

export const FORMS = [
  {
    id: "irs-w2",
    name: "IRS W-2 (Wage and Tax Statement)",
    // Identify by things unique to the form, tolerant of OCR noise.
    detect: [/wage and tax statement/i, /1545-?0029/, /\bform\s*w-?2\b/i],
    minDetect: 1,
    rules: [
      { on: /employee.{0,3}s?\s+social security number/i, ask: "social security number", place: "below" },
      // Box e is OCR'd as one row: "Employee's first name and initial | Last name | Suff."
      // First name draws at the row start; last name pins to the "Last" sub-word.
      { on: /employee.{0,3}s?\s+first name and initial/i, ask: "first name", place: "below" },
      { on: /first name and initial.*last name/i, col: /last/i, ask: "last name", place: "below" },
      { on: /employee.{0,3}s?\s+address and zip/i, ask: "address", place: "below" },
    ],
  },
  // W-9 and W-4 are RECOGNISED but deliberately have NO label-anchored rules. They
  // are dense XFA-hybrid forms whose AcroForm names don't resolve (0–2 fills) AND
  // whose printed field captions blur into surrounding instruction prose, so OCR
  // can't isolate a clean caption to anchor to (verified: label-anchoring either
  // fills nothing or risks landing on an instruction paragraph). Recognising them
  // with empty rules keeps them OUT of the generic strict-OCR path (which could
  // misfire on their prose) — they degrade safely to "recognised, not filled". The
  // foolproof path for these is a FIXED-COORDINATE template (record each box's
  // position for the form version, calibrated to a detected landmark), the approach
  // commercial tax software uses. Tracked as follow-up.
  { id: "irs-w9", name: "IRS W-9 (Request for Taxpayer ID)", detect: [/request for taxpayer/i, /\bform\s*w-?9\b/i], minDetect: 1, rules: [] },
  { id: "irs-w4", name: "IRS W-4 (Employee's Withholding)", detect: [/employee.{0,3}s? withholding certificate/i, /\bform\s*w-?4\b/i], minDetect: 1, rules: [] },
  {
    id: "uscis-i9",
    name: "Form I-9 (Employment Eligibility)",
    detect: [/employment eligibility verification/i, /\bform\s*i-?9\b/i],
    minDetect: 1,
    rules: [
      { on: /last name.*family name/i, ask: "last name", place: "below" },
      { on: /first name.*given name/i, ask: "first name", place: "below" },
      { on: /middle initial/i, ask: "middle initial", place: "below" },
      { on: /address.*street number and name/i, ask: "street address", place: "below" },
      { on: /^city or town$/i, ask: "city", place: "below" },
      { on: /^zip code$/i, ask: "zip", place: "below" },
      { on: /date of birth/i, ask: "date of birth", place: "below" },
      { on: /social security number/i, ask: "social security number", place: "below" },
      { on: /e.?mail address/i, ask: "email", place: "below" },
    ],
  },
];

/** Identify a form from all OCR'd text on the document. Returns the form or null. */
export function identifyForm(fullText) {
  const t = (fullText || "").replace(/\s+/g, " ");
  for (const form of FORMS) {
    const hits = form.detect.filter((re) => re.test(t)).length;
    if (hits >= (form.minDetect || 1)) return form;
  }
  return null;
}
