// Structured education from vault keys like "masters" / "bachelors" whose value is a comma-list.
// Each part is classified by PATTERN — degree, field of study, school, year, GPA — so the user does
// NOT have to remember a fixed column order. One entry per education-level key; the fill then routes
// each entry to the matching block on a form (a "Master's" section gets the masters entry, etc.).
//
// Pure + unit-tested; shared by the browser extension (pagefill) and the desktop app (resolver).

// Vault-key aliases → the canonical education LEVEL they represent.
const LEVEL_ALIASES = {
  doctorate:  ["phd", "ph d", "doctorate", "doctoral", "dphil"],
  master:     ["masters", "master", "masters degree", "master degree", "post graduate", "postgraduate", "pg", "ms", "msc", "m tech", "mtech", "ma", "mba", "m ed", "mphil", "m phil"],
  bachelor:   ["bachelors", "bachelor", "bachelors degree", "bachelor degree", "under graduate", "undergraduate", "ug", "graduation", "degree", "bs", "bsc", "b tech", "btech", "ba", "be", "b com", "bcom", "b ed"],
  diploma:    ["diploma", "associate", "associate degree", "pg diploma"],
  highschool: ["high school", "highschool", "secondary school", "senior secondary", "higher secondary", "12th", "hsc", "intermediate"],
};

const norm = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// A single comma token → { kind, value }. Order-independent classification.
export function classifyToken(tok) {
  const t = (tok || "").trim();
  if (!t) return null;
  const n = norm(t);
  // GPA / grade: "3.8", "3.8/4.0", "8.5/10", "85%", "First Class".
  if (/^\d(\.\d{1,2})?\s*\/\s*\d{1,2}(\.\d{1,2})?$/.test(t)) return { kind: "gpa", value: t };
  if (/^\d{1,3}(\.\d+)?\s*%$/.test(t)) return { kind: "gpa", value: t };
  if (/^\d(\.\d{1,2})?$/.test(t) && parseFloat(t) <= 10) return { kind: "gpa", value: t };
  if (/\b(first class|second class|distinction|honou?rs|cum laude|merit)\b/i.test(t)) return { kind: "gpa", value: t };
  // Year (or a range/month-year) → keep the LAST 4-digit year (graduation year).
  const years = t.match(/(19|20)\d{2}/g);
  if (years && /^[a-z]*\s*[\d\s\-–—to/.,]*$/i.test(t)) return { kind: "year", value: years[years.length - 1] };
  // School / institution.
  if (/\b(university|college|institute|institut|school|academy|polytechnic|vidyalaya|iit|nit|iiit|bits)\b/i.test(n)) return { kind: "school", value: t };
  // Degree name.
  if (/^(ph\s?d|doctorate|m\s?b\s?a|m\s?s\s?c?|master'?s?|m\s?tech|m\s?a|m\s?e|m\s?ed|m\s?phil|b\s?s\s?c?|bachelor'?s?|b\s?tech|b\s?a|b\s?e|b\s?com|b\s?ed|diploma|associate|high school|hsc|ssc)$/i.test(n)
      || /\b(bachelor|master|doctor|degree)\b/i.test(n) && t.length <= 30) return { kind: "degree", value: t };
  // Anything else is the field of study / major.
  return { kind: "field", value: t };
}

// Which education LEVEL does a vault key (or a form's section heading) denote? null if none.
export function levelOf(text) {
  const n = norm(text);
  if (!n) return null;
  const words = n.split(" ");
  for (const [level, aliases] of Object.entries(LEVEL_ALIASES)) {
    for (const a of aliases) {
      // A single-word alias must match a WHOLE word (so "ma"/"be" don't hit "email"/"number");
      // a multi-word alias ("post graduate") is matched as a phrase.
      if (a.includes(" ") ? n.includes(a) : words.includes(a)) return level;
    }
  }
  return null;
}

// Parse the whole vault into structured education entries, one per education-level key.
// Returns e.g. [{ level:"master", degree:"MS", field:"Computer Science", school:"Stanford University",
//                 year:"2015", gpa:"3.8", raw:"MS, Computer Science, ..." }, ...].
export function parseEducation(vault) {
  const out = [];
  for (const [key, value] of Object.entries(vault || {})) {
    const level = levelOf(key);
    if (!level || value == null || !String(value).trim()) continue;
    const entry = { level, degree: "", field: "", school: "", year: "", gpa: "", raw: String(value) };
    for (const part of String(value).split(",")) {
      const c = classifyToken(part);
      if (!c) continue;
      // First value of each kind wins (a field of study can have commas → keep the first "field").
      if (!entry[c.kind]) entry[c.kind] = c.value;
      else if (c.kind === "field") entry.field += (entry.field ? ", " : "") + c.value; // join multi-word majors
    }
    // If no explicit degree token was found, fall back to a readable name from the level key.
    if (!entry.degree) entry.degree = String(key).trim();
    out.push(entry);
  }
  // Highest level first (doctorate → high school) so "highest qualification" fields get the top one.
  const RANK = { doctorate: 5, master: 4, bachelor: 3, diploma: 2, highschool: 1 };
  out.sort((a, b) => (RANK[b.level] || 0) - (RANK[a.level] || 0));
  return out;
}

// The five education field concepts and the phrases that identify each on a form.
export const EDU_FIELD_SYNS = {
  degree: ["degree", "qualification", "level of education", "education level", "degree type", "degree obtained", "highest qualification", "highest degree", "course"],
  field:  ["field of study", "major", "specialization", "specialisation", "branch", "stream", "discipline", "subject", "area of study", "concentration"],
  school: ["university", "institution", "college", "school name", "name of institution", "name of university", "name of college", "institution name", "university name", "alma mater", "school college university"],
  year:   ["year of passing", "graduation year", "year of graduation", "year of completion", "passing year", "year completed", "completion year", "year of award", "end year", "to year"],
  gpa:    ["gpa", "cgpa", "grade", "grade point average", "percentage", "marks", "score", "result", "class obtained"],
};

// Pick the education entry that best matches a form field's SECTION context (its surrounding text /
// a degree-level hint). Falls back to the highest-ranked entry when the context is silent.
export function entryForContext(entries, contextText) {
  if (!entries || !entries.length) return null;
  const level = levelOf(contextText);
  if (level) { const hit = entries.find((e) => e.level === level); if (hit) return hit; }
  return entries[0]; // highest qualification by default
}
