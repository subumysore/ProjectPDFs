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
