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

const norm = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const stem = (t) => t.replace(/s$/, "");

// A box that belongs to a DIFFERENT entity than the applicant (employer / ship / hotel /
// guarantor / inviter / partner …) must never be filled from the user's own identity.
const ENTITY = ["employer", "company", "organization", "organisation", "ship", "airline", "vessel", "flight", "hotel", "guarantor", "sponsor", "inviter", "invitee", "reference", "referee", "emergency", "next of kin", "host", "partner", "parent", "spouse", "school", "university", "institution", "person", "relative", "friend"];
export function isEntityText(s) {
  const g = norm(s); const toks = new Set(g.split(" ").filter(Boolean).map(stem));
  return ENTITY.some((e) => (e.includes(" ") ? g.includes(e) : toks.has(stem(e))));
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
  for (const f of fields) {
    const T = byPage(f.page);
    const isChoice = f.kind === "choice";
    const isRadio = isChoice && (f.widgets && f.widgets.length > 1);
    const caption = captionFor(T, f.rect, { preferColon: isRadio });
    if (isEntityText(caption + " " + headerAbove(T, f.rect))) { skipped++; continue; }
    const value = resolveFields(vault, [{ label: caption }])[0];
    if (!value) continue;

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
