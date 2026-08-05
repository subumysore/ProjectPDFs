// Scoring for the engine benchmark. A GROUND-TRUTH file lists assertions: locate a field (by exact
// fieldName, an id regex, or a tooltip/caption regex) and state its EXPECTED value — a vault value it
// should carry, or "" meaning it must stay BLANK (the critical negative cases: Other Names, interpreter,
// preparer, the other person's section). We then compare what an engine actually assigned.
//
//   precision = correct fills / (correct + wrong) fills, over labeled fields   (are the fills right?)
//   recall    = correct fills / fields that SHOULD be filled                    (did we get them all?)
//   blankOk   = labeled-blank fields left blank / labeled-blank fields          (do we avoid over-fill?)
//
// When no ground truth exists yet, we still report COVERAGE: distinct vault values that landed anywhere
// (proof the right data reached the form), so every form yields a number even before full labeling.

// Mirrors the owner's real vault closely enough to REPRODUCE the live bugs (e.g. occupation leaking
// into the N-400 children/employment columns), so the benchmark measures what users actually hit.
export const VAULT = {
  first_name: "SUBRAMANYA", middle_name: "VISHWANATHAN", last_name: "MYSORE",
  date_of_birth: "11/30/1968", address_1: "4308 ALBINO DEER WAY", city: "WAKE FOREST",
  state: "NC", zip: "27587", ssn: "123-45-6789", email: "subumysore@gmail.com", phone: "919-555-0100",
  occupation: "ENTERPRISE ARCHITECT", marital_status: "Married",
};

const norm = (s) => (s || "").toString().toUpperCase().replace(/[^A-Z0-9@]/g, "");
const digits = (s) => (s || "").toString().replace(/\D/g, "");
// Loose equality: names/text compared normalized; SSN/phone/zip/date compared by digits.
function valuesEqual(a, b) {
  if (norm(a) === norm(b)) return true;
  const da = digits(a), db = digits(b);
  return da.length >= 4 && da === db;
}

// Find the fields a locator matches. Locator keys: id (exact), idRe (regex on fieldName),
// tipRe (regex on tooltip), capRe (regex on proximity caption from the field's own printed label).
function matchFields(form, loc) {
  return form.fields.filter((f) => {
    if (loc.id) return f.id === loc.id;
    if (loc.idRe) return new RegExp(loc.idRe, "i").test(f.id || "");
    if (loc.tipRe) return new RegExp(loc.tipRe, "i").test(f.tooltip || "");
    if (loc.capRe) return new RegExp(loc.capRe, "i").test(f.__caption || "");
    return false;
  });
}

export function scoreForm(assignments, gt, form) {
  const byId = new Map(assignments.map((a) => [a.id, a.value]));

  // Always-available coverage: distinct vault values that appear anywhere in the output.
  const landed = new Set();
  for (const a of assignments) for (const [k, v] of Object.entries(VAULT)) if (valuesEqual(a.value, v)) landed.add(k);
  const coverage = landed.size;

  if (!gt || !Array.isArray(gt.assertions) || gt.assertions.length === 0) {
    return { precision: null, recall: null, blankOk: null, labeled: 0, coverage };
  }

  let TP = 0, WRONG = 0, MISS = 0, expectFill = 0, blankTotal = 0, blankKept = 0;
  const failures = [];
  for (const asrt of gt.assertions) {
    const matches = matchFields(form, asrt);
    if (matches.length === 0) { failures.push({ ...asrt, why: "locator matched no field" }); continue; }
    // Assertion holds against ANY matched widget getting the expected value (or ALL staying blank).
    const vals = matches.map((f) => byId.get(f.id) || "");
    if (asrt.expect === "" || asrt.expect == null) {
      blankTotal++;
      const anyFilled = vals.some((v) => v !== "");
      if (anyFilled) failures.push({ ...asrt, why: "should be BLANK but was filled", got: vals.filter(Boolean) });
      else blankKept++;
    } else {
      expectFill++;
      const ok = (v) => asrt.mode === "contains" ? (norm(asrt.expect).length > 0 && norm(v).includes(norm(asrt.expect))) : valuesEqual(v, asrt.expect);
      const hit = vals.some(ok);
      if (hit) TP++;
      else if (vals.every((v) => v === "")) { MISS++; failures.push({ ...asrt, why: "not filled", got: "" }); }
      else { WRONG++; failures.push({ ...asrt, why: "wrong value", got: vals.filter(Boolean) }); }
    }
  }
  const precision = (TP + WRONG) ? TP / (TP + WRONG) : null;
  const recall = expectFill ? TP / expectFill : null;
  const blankOk = blankTotal ? blankKept / blankTotal : null;
  return { precision, recall, blankOk, labeled: gt.assertions.length, coverage, TP, WRONG, MISS, blankTotal, blankKept, failures };
}
