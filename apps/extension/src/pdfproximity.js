// Proximity form-filling for PDFs whose AcroForm field NAMES are meaningless (XFA/LiveCycle
// exports like "T2", "RB3", "emp_adr", and scanned-then-OCR'd forms). The true caption of each
// box is PRINTED TEXT positioned near it, so we label every field geometrically — no per-form
// rules — and resolve caption->value with the shared semantic resolver.
//
// Pure & framework-agnostic: the caller supplies
//   fields : [{ id, kind:'text'|'choice', page, rect:{x,y,width,height}, options?, widgets?:[{page,rect}] }]
//   texts  : [{ page, x, y, w, h, s }]   (PDF user-space, bottom-left origin — pdf.js text layer)
//   resolveFields : the resolver.resolveFields function
// and gets back { assignments:[{ id, caption, value, option? }], skipped }. It mutates nothing,
// so it is trivially testable; pdffill.js wires it to pdf-lib + pdf.js.

// Split camelCase FIRST so programmatic field names tokenise ("EmployerName" -> "employer name",
// "P10_Line4a" -> untouched) — otherwise a compound like "EmployerName" hides the "employer" token
// and an entity box slips through as fillable.
const norm = (s) => (s || "").toString().replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const stem = (t) => t.replace(/s$/, "");

// A box that belongs to a DIFFERENT entity than the applicant (employer / ship / hotel /
// guarantor / inviter / partner …) must never be filled from the user's own identity.
const ENTITY = ["employer", "company", "organization", "organisation", "ship", "airline", "vessel", "flight", "hotel", "guarantor", "sponsor", "inviter", "invitee", "reference", "referee", "emergency", "next of kin", "host", "partner", "parent", "spouse", "school", "university", "college", "institution", "person", "relative", "friend", "interpreter", "preparer", "translator", "attorney", "representative", "witness", "decedent", "deceased", "delegate"];
export function isEntityText(s) {
  const g = norm(s); const toks = new Set(g.split(" ").filter(Boolean).map(stem));
  return ENTITY.some((e) => (e.includes(" ") ? g.includes(e) : toks.has(stem(e))));
}

// A box asking for the applicant's OTHER / FORMER / MAIDEN names (aliases they have used) is NOT their
// CURRENT legal name — filling it with the current name is wrong (USCIS N-400 "Other Names You Have Used
// Since Birth", passport "previous names", etc.). Unless the vault holds an explicit alias, leave the box
// BLANK — the field still exists to fill by hand. Matched on whole words so "mother name" ≠ "other name".
const OTHER_NAME = ["other name", "other names", "names you have used", "name you have used", "maiden name",
  "name at birth", "birth name", "former name", "former names", "previous name", "previous names",
  "prior name", "also known as", "alias", "aliases", "married name", "names used", "used since birth"];
export function isOtherNameText(s) {
  const g = " " + norm(s) + " ";
  return OTHER_NAME.some((e) => g.includes(" " + e + " "));
}

// The NAME SECTION a field sits under: scan upward for the NEAREST name-section heading and report
// whether it's the applicant's CURRENT legal name or their OTHER/FORMER/MAIDEN names. headerAbove()
// returns the field's own column label ("Family Name") so it can't tell these apart; this walks the
// text above (any column) and returns the first heading that names a section. → "other" | "current" | null.
const CURRENT_NAME = ["current legal name", "your current legal name", "your name", "your legal name",
  "full legal name", "name of applicant", "applicant s name", "applicant name", "legal name"];
function nameSectionKind(texts, r) {
  const cy = r.y + r.height / 2;
  const above = texts.filter((t) => t.y > cy).sort((a, b) => (a.y - cy) - (b.y - cy)); // nearest-above first
  for (const t of above) {
    if (isOtherNameText(t.s)) return "other";
    const g = " " + norm(t.s) + " ";
    if (CURRENT_NAME.some((c) => g.includes(" " + c + " "))) return "current";
  }
  return null;
}

// ── OWNERSHIP: the fundamental pattern, not a per-form list ──────────────────────────────────────
// A box belongs to the APPLICANT (fill it from their identity) UNLESS its label/section shows it is about
// a DIFFERENT subject. Two general, grammar-level signals catch this across every form:
//
//   (1) A NON-SELF POSSESSIVE — "Spouse's / Interpreter's / Decedent's / Son or Daughter's / Employer's
//       <field>". English marks "whose field is this?" with 's; if the possessor isn't the applicant
//       (your/applicant/petitioner/my/our) it's someone else's box → leave blank. This one rule replaces
//       spouse+interpreter+preparer+decedent+delegate+… — we detect the GRAMMAR, not the nouns.
//
//   (2) A REPEATING-HISTORY row we have no data for — a numbered enumeration (…Name1/Name2/Name3, row
//       index [1]/[2]) or a section that says to LIST/PROVIDE multiple entries (employment/residence
//       history, list of children). A single identity value smeared down every row is noise, not a fill.
const SELF_POSS = new Set(["applicant", "petitioner", "your", "my", "our", "yours"]);
export function otherSubject(caption, tip, header) {
  const blob = `${caption || ""} . ${tip || ""} . ${header || ""}`;
  for (const m of blob.matchAll(/\b([A-Za-z]{3,})['’]s\b/g)) { if (!SELF_POSS.has(m[1].toLowerCase())) return true; }
  return false;
}
export function repeatingHistoryRow(field, tip, header) {
  const id = field.id || "";
  // Look ONLY at the field's own LEAF name — not the XFA container path. A full pdf name like
  // "form1[0].#subform[2].P4_Line1_StreetName[0]" carries "#subform[2]" (a structural index, NOT a row)
  // and a "[0]" widget suffix; both would false-trigger the row-index check.
  const leaf = (id.replace(/\[\d+\]$/, "").split(".").pop() || "");
  // A repeating ROW is marked by a row index in the LEAF name — an explicit "…[1]/[2]", a "Line2/Name3"
  // style token, OR (USCIS tables) a trailing digit on the leaf ("PhysicalAddress2", "CityTown3",
  // "State1"). The CURRENT single address ends in a WORD ("StreetName", "City", "State") → not a row.
  const numbered = /[A-Za-z]\d$/.test(leaf)
    || /(?:name|line|row|entry)\s*[2-9]\b/i.test(leaf)
    || /[_.]?\d?\[[1-9]\]/.test(leaf);
  const listLead = /\b(list (all|every|where)|provide the following information about|during the (last|past)\s*\d|every (location|address|place) where you have (lived|resided)|information about your (children|employment|marital))\b/i.test(`${tip} ${header}`);
  return numbered && listLead;
}

const rowMatch = (t, cy) => Math.abs((t.y + t.h / 2) - cy) <= 7;

// The box's own caption = same-row printed text that BEGINS to its left (a long label can extend
// under/past the box's left edge); nearest by start-x. Else the nearest text directly above.
export function captionFor(texts, r, { preferColon = false } = {}) {
  const cy = r.y + r.height / 2;
  const row = texts.filter((t) => rowMatch(t, cy) && t.x <= r.x - 2);
  if (row.length) {
    if (preferColon) { const c = row.filter((t) => /[:：]\s*$/.test(t.s)).sort((a, b) => b.x - a.x)[0]; if (c) return c.s; }
    return row.sort((a, b) => b.x - a.x)[0].s;
  }
  const above = texts.filter((t) => t.y >= r.y + r.height - 2 && t.y <= r.y + r.height + 26 && t.x < r.x + r.width && t.x + t.w > r.x);
  return above.length ? above.sort((a, b) => a.y - b.y)[0].s : "";
}

// The SECTION a box is in = nearest LEFT-MARGIN heading above it (sub-fields are indented; the
// heading sits at the margin). Used to attribute e.g. a bare "Nationality" to the Guarantor block.
export function headerAbove(texts, r) {
  const c = texts.filter((t) => t.x <= 80 && t.y > r.y + r.height - 2 && t.s.length >= 3);
  return c.length ? c.sort((a, b) => a.y - b.y)[0].s : "";
}

// The section INSTRUCTIONS printed above a field (any x, within a vertical band). Gov forms put the
// defining sentence — "List every location where you have lived during the last 5 years" — as an
// indented paragraph well ABOVE the table it governs, so it lands in neither the left-margin header nor
// the widget tooltip. This wider window lets the history/list detector see it. (PDF y grows upward, so
// "above" = larger y.) Cheap: a specific-phrase match, not used to fill anything.
export function instructionsAbove(texts, r, up = 540) {
  return texts
    .filter((t) => t.y >= r.y && t.y <= r.y + up)
    .map((t) => t.s)
    .join(" ");
}

// The printed label for a single radio/checkbox option — usually immediately to the LEFT of the
// box ("Male ☐"); fall back to the nearest label on either side.
export function optionLabel(texts, r) {
  const cy = r.y + r.height / 2, cx = r.x + r.width / 2;
  const row = texts.filter((t) => Math.abs((t.y + t.h / 2) - cy) <= 8);
  if (!row.length) return "";
  const left = row.filter((t) => (t.x + t.w / 2) < cx).sort((a, b) => (b.x + b.w / 2) - (a.x + a.w / 2))[0];
  if (left && (cx - (left.x + left.w / 2)) < 70) return left.s;
  return row.sort((a, b) => Math.abs((a.x + a.w / 2) - cx) - Math.abs((b.x + b.w / 2) - cx))[0].s;
}

export const scoreOption = (val, cand) => {
  const nv = norm(val), nc = norm(cand); if (!nv || !nc) return 0;
  if (nv === nc) return 3; if (nc.startsWith(nv) || nv.startsWith(nc)) return 2; return (nc.includes(nv) || nv.includes(nc)) ? 1 : 0;
};

// Reformat MM/DD/YYYY -> DD/MM/YYYY when the box's context says (Day)/(Month)/(Year).
export const toDMY = (v) => { const m = String(v).match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); return m ? `${m[2].padStart(2, "0")}/${m[1].padStart(2, "0")}/${m[3]}` : v; };
export function dayFirstNear(texts, r) {
  return texts.some((t) => /day.*month.*year/i.test(t.s.replace(/[()\/]/g, " ")) && Math.abs(t.y - r.y) < 22 && Math.abs(t.x - r.x) < 260);
}

// Plan the fill: decide a caption + value (and chosen option) for every field, purely from
// geometry + the resolver. Returns assignments the caller applies to the real form object.
export function planProximityFill(fields, texts, vault, resolveFields) {
  const assignments = []; let skipped = 0;
  const byPage = (pi) => texts.filter((t) => t.page === pi);
  // The applicant's own name in every rendered form — so we can detect it landing in a box that is
  // NOT a name box (e.g. "Street Number and Name", "In Care Of Name") and suppress that mis-fill.
  const nm = (lbl) => (resolveFields(vault, [{ label: lbl }])[0] || "");
  const nameVals = new Set([nm("full name"), nm("first name"), nm("last name"), nm("given and middle names"),
    [nm("first name"), nm("middle name"), nm("last name")].filter(Boolean).join(" ")].filter(Boolean).map(norm));
  // A repeating TABLE column, detected GEOMETRY-FREE from the field names: the same leaf enumerated across
  // rows ("…PhysicalAddress1/2/3", "…State1/2/3", "…CityTown1/2/3"). When a leaf-base (trailing digits
  // stripped) recurs with 2+ distinct row indices, those indexed fields are history-table rows we have no
  // data for — a single identity value smeared down every row is noise, not a fill. The CURRENT single
  // field ("…StreetName", "…State", "…City" — no trailing digit) is in no such group and still fills.
  const leafOf = (id) => ((id || "").replace(/\[\d+\]$/, "").split(".").pop() || "");
  // Precompute each field's caption once (reused in the loop).
  const capOf = new Map();
  for (const f of fields) { try { capOf.set(f.id, captionFor(byPage(f.page), f.rect, { preferColon: f.kind === "choice" && f.widgets && f.widgets.length > 1 })); } catch { capOf.set(f.id, ""); } }
  // A repeating TABLE column, detected GEOMETRY-FREE of any instruction text: fields sharing a leaf-base
  // ("…PhysicalAddress", "…State") whose rects are X-ALIGNED and stacked = one column of a grid, so the
  // indexed rows are history entries we have no data for (a single value smeared down them is noise).
  // The X-alignment requirement is what separates a real table from a form whose DISTINCT fields merely
  // carry sequential opaque names (T1=surname, T2=given, T3=dob…) at different positions.
  const colGroup = new Map();
  for (const f of fields) { const m = leafOf(f.id).match(/^(.*[^\d])(\d+)$/); if (m) { const arr = colGroup.get(m[1]) || []; arr.push({ x: f.rect.x, page: f.page }); colGroup.set(m[1], arr); } }
  const repeatingColumnRow = (f) => {
    const m = leafOf(f.id).match(/^(.*[^\d])(\d+)$/); if (!m) return false;
    const aligned = (colGroup.get(m[1]) || []).filter((o) => o.page === f.page && Math.abs(o.x - f.rect.x) <= 12);
    return aligned.length >= 2;
  };
  for (const f of fields) {
    const T = byPage(f.page);
    const isChoice = f.kind === "choice";
    const isRadio = isChoice && (f.widgets && f.widgets.length > 1);
    const caption = capOf.get(f.id) ?? captionFor(T, f.rect, { preferColon: isRadio });
    // A different entity (employer/guarantor/interpreter/preparer/decedent/…) OR the applicant's OTHER/
    // FORMER/MAIDEN names — never fill either from the user's CURRENT identity. Leave the field blank (it
    // still exists to fill by hand). The field's TOOLTIP (/TU) — which these gov forms carry and which
    // names the section ("Part 7 … Marital History", "Interpreter's …") — is folded into the context so a
    // spouse/preparer box is recognised even when its own visible label is just "Family Name".
    const ctx = caption + " " + headerAbove(T, f.rect) + " " + (f.id || "");
    // The tooltip names the SECTION on gov forms ("Part 7 … Marital History", "Interpreter's …",
    // "Information About Your Children"). We DON'T fold it into the broad entity check (benign tooltips
    // like "Information About You (Person applying…)" would false-trigger on "person"); instead we match
    // a tight set of OTHER-PERSON section keywords, and only skip NAME boxes on that basis.
    const tip = f.tooltip || "";
    const capIsName = /\b(family|last|given|first|middle|maiden|surname|forename|name)\b/i.test(caption);
    const otherPersonSection = /\b(spouse|marital history|husband|wife|interpreter|preparer|decedent|deceased|delegate|employer or school|about your children|your children)\b/i.test(tip + " " + caption + " " + headerAbove(T, f.rect));
    // REPEATING HISTORY TABLES (children, employment/schools) enumerate rows we have no data for — a
    // single identity value (occupation, a name) smeared across every row is noise, not a fill. Leave the
    // WHOLE section blank for manual entry. Keyed on the tooltip that names the section, so it can't catch
    // an unrelated single field. (NOT marital-history — its status radio should still fill; only its
    // spouse NAME boxes are skipped, via otherPersonSection above.)
    const header = headerAbove(T, f.rect);
    // Field-specific section tooltips (children / employment-schools) mark EVERY field in those tables,
    // including non-numbered ones, so keep them here. The RESIDENCE ("every location where you have
    // lived") table — and any indexed grid — is caught GEOMETRY-FREE by repeatingColumnRow (a leaf
    // enumerated across 2+ rows), which is robust to where the section instruction is printed.
    const historyTable = /information about your children|information about your employment and sch|employment and schools you attended/i.test(tip);
    if (isEntityText(ctx) || isOtherNameText(ctx) || isOtherNameText(tip)
        || otherSubject(caption, tip, header)                 // GENERAL: someone else's box (possessive)
        || repeatingColumnRow(f)                              // GENERAL: an indexed, x-aligned table column
        || repeatingHistoryRow(f, tip, header) || historyTable // GENERAL: a repeating history row / table
        || (capIsName && otherPersonSection) || (capIsName && nameSectionKind(T, f.rect) === "other")) { skipped++; continue; }
    let value = resolveFields(vault, [{ label: caption, name: f.id }])[0];
    if (!value) continue;
    // The applicant's NAME resolved into an ADDRESS box ("Street Number and Name", "In Care Of Name") is a
    // mis-resolution — the word "Name" in the label pulled a name concept. For a STREET line, fill the real
    // street instead of blanking it; for a courtesy "In Care Of" line, leave it blank.
    const addrCtx = /\b(street|address|city|town|state|province|zip|postal|country|apt|suite|floor|care of)\b/i.test(caption + " " + (f.tooltip || ""));
    if (addrCtx && nameVals.has(norm(value))) {
      const isStreetLine = /\bstreet\b|address line|residence address|mailing address|home address/i.test(caption) && !/care of|in care/i.test(caption);
      const streetVal = isStreetLine ? (resolveFields(vault, [{ label: "street address" }])[0] || "") : "";
      if (streetVal && !nameVals.has(norm(streetVal))) value = streetVal;
      else { skipped++; continue; }
    }

    if (isChoice) {
      const opts = f.options || [];
      let best = null, bestS = 0;
      if (!f.widgets || f.widgets.length <= 1) {
        for (const o of opts) { const s = scoreOption(value, o); if (s > bestS) { bestS = s; best = o; } } // dropdown/list
      } else {
        f.widgets.forEach((w, i) => { const wl = optionLabel(byPage(w.page), w.rect); for (const c of [opts[i], wl]) { const s = scoreOption(value, c); if (s > bestS) { bestS = s; best = opts[i]; } } }); // radio
      }
      if (best != null && bestS >= 2) assignments.push({ id: f.id, caption, value, option: best });
      continue;
    }
    let v = String(value); if (dayFirstNear(T, f.rect)) v = toDMY(v);
    assignments.push({ id: f.id, caption, value: v });
  }
  return { assignments, skipped };
}
