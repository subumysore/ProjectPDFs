// Fuzzy option matching for dropdowns / list boxes / option checkboxes: pick the item
// whose text corresponds to the user's value even when it isn't an exact string —
// "Indian" ↔ "India", "Male" ↔ "M". Prefix matching is allowed only when the shorter
// token is ≥3 chars, so a single letter ("M") can't wrongly match "Married". Pure + tested.
export const normOpt = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, "");

export function fuzzyOptionMatch(optionText, value) {
  const x = normOpt(optionText), y = normOpt(value);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && long.startsWith(short);
}

export function pickOption(options, value) {
  if (value == null || value === "") return null;
  return (options || []).find((o) => fuzzyOptionMatch(o, value)) || null;
}

/**
 * The user's ENUMERABLE values — the concepts that turn up as list options or as option-style
 * checkboxes ("Male", "Married", "Indian"). Used to tick or select a control whose own field name
 * says nothing useful ("Group1"), by matching an OPTION against something the user actually is.
 *
 * Lives here, in the engine, because both platforms need it: it used to be a private helper inside
 * the extension's pdffill.js, which is why the desktop silently filled no dropdowns, radio groups
 * or checkboxes at all — it had the resolver but not this. `resolve` is injected so this module
 * stays free of any pdf-lib or platform dependency.
 */
export function userOptionValues(vault, resolve) {
  const ask = (label) => resolve(vault, [{ label, maxLength: -1 }])[0];
  const out = [];
  for (const c of ["salutation", "nationality", "country", "state", "marital status", "gender"]) {
    const v = ask(c);
    if (v) out.push(String(v));
  }
  // A stored "M"/"F" has to be able to match a "Male"/"Female" option.
  const g = normOpt(ask("gender"));
  if (g === "m" || g === "male") out.push("male");
  if (g === "f" || g === "female") out.push("female");
  return out;
}

/**
 * Decide what a NON-TEXT field should become, given its options and the value (if any) the
 * resolver produced for its label. Returns:
 *   { select: "<option>" }  choose this option
 *   { check: true }         tick this checkbox
 *   null                    leave it alone
 * Shared so a radio group behaves identically in the browser and in the desktop app.
 */
export function decideChoice({ kind, label, value, options, optionValues }) {
  const opts = options || [];
  if (kind === "choice") {
    const match = (value != null && value !== "" ? pickOption(opts, value) : null)
      || opts.find((o) => (optionValues || []).some((uv) => fuzzyOptionMatch(o, uv)))
      || null;
    return match ? { select: match } : null;
  }
  if (kind === "check") {
    const truthy = value != null && value !== "" && /^(y|yes|true|1|on|x|checked)$/i.test(String(value));
    const optMatch = (optionValues || []).some((uv) => fuzzyOptionMatch(label, uv));
    return truthy || optMatch ? { check: true } : null;
  }
  return null;
}
