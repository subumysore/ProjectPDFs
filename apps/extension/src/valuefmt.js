// Deciding whether a filled field VALUE should be machine-translated for the bilingual
// side panel. A value is the user's own DATA: names, numbers, IDs, emails and dates are
// the SAME in every language, and running them through the MT model produces garbage
// (a name "Pranav Subramanya" once hallucinated into "Mexico"). Only genuine word-
// phrases (option choices, marital status, occupations…) are translated; everything else
// is shown verbatim. Pure + unit-tested.
export function isTranslatableValue(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return false;
  if (/[@]|https?:|www\./i.test(s)) return false;            // emails / URLs
  if (/^[\d\s.,:/+()#-]+$/.test(s)) return false;            // numbers, dates, phones, IDs
  if (/^[A-Z0-9][A-Z0-9\s.,'’&/-]*$/.test(s)) return false;  // ALL-CAPS → name / code / ID
  const words = s.split(/\s+/);
  // Proper-case, ≤4 words → a personal / place name → show verbatim (never translate).
  if (words.length <= 4 && words.every((w) => /^[A-Z][a-z0-9’'.-]*$/.test(w))) return false;
  return true;
}
