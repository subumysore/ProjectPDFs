// Identity matching for "create/overwrite a profile from an ID scan" (RFC-0007).
// Match key = full name + date of birth (normalised). Pure + unit-tested.

const normName = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Canonicalise a date of birth to MMDDYYYY digits so "11/30/1968" == "11/30/68".
export function normDob(s) {
  const m = (s || "").toString().match(/(\d{1,2})\D+(\d{1,2})\D+(\d{2,4})/);
  if (!m) return "";
  let y = m[3];
  if (y.length === 2) y = (Number(y) > 30 ? "19" : "20") + y;
  return m[1].padStart(2, "0") + m[2].padStart(2, "0") + y;
}

/** Identity {name, dob} derived from a profile's data map. Keyed on FIRST + LAST only
 * (middle names vary in presence, so including them would miss real matches). */
export function identityOf(data) {
  const d = data || {};
  let first = d.first_name;
  let last = d.last_name;
  if ((!first || !last) && (d.full_name || d.name)) {
    const parts = normName(d.full_name || d.name).split(" ").filter(Boolean);
    if (parts.length) { first = first || parts[0]; last = last || parts[parts.length - 1]; }
  }
  return { name: normName([first, last].filter(Boolean).join(" ")), dob: normDob(d.date_of_birth || d.dob) };
}

/** Two identities are the same person: names equal AND (DOBs equal, or one lacks a DOB). */
export function sameIdentity(a, b) {
  if (!a.name || !b.name || a.name !== b.name) return false;
  return a.dob && b.dob ? a.dob === b.dob : true;
}

/**
 * Find the id of an existing profile matching `data`'s person, or null.
 * `profiles` is { <id>: { name, data } }.
 */
export function findMatch(profiles, data) {
  const id = identityOf(data);
  if (!id.name) return null;
  for (const [pid, p] of Object.entries(profiles || {})) {
    if (sameIdentity(id, identityOf(p && p.data))) return pid;
  }
  return null;
}

/** A human profile name from scanned data ("First Last"), else a fallback. */
export function profileNameFrom(data) {
  const d = data || {};
  const nm = [d.first_name, d.last_name].filter(Boolean).join(" ").trim()
    || d.full_name || d.name || "";
  return nm || "New profile";
}
