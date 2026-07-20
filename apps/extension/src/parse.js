// Pure text → vault fields, ported from the desktop app's ocr.ts so an IMAGE (camera
// or file) can CREATE or UPDATE the user's profile keys. On-device, explainable
// heuristics; the user reviews every extracted pair before saving. No network, no
// meaning beyond label→key mapping. Keys match the seeded vault ontology.

const LABELS = [
  [["first name", "given name", "forename", "given"], "first_name"],
  [["middle name", "middle"], "middle_name"],
  [["last name", "surname", "family name"], "last_name"],
  [["full name", "name"], "__full"], // split into first/middle/last
  [["salutation", "title", "prefix"], "salutation"],
  [["gender", "sex"], "gender"],
  [["email", "e-mail", "e mail", "email address", "mail"], "email_address"],
  [["mobile", "cell", "cell phone", "mobile number", "cellphone"], "cell_phone"],
  [["home phone", "landline", "residence phone"], "home_phone"],
  [["phone", "telephone", "tel", "contact", "contact number", "phone number"], "cell_phone"],
  [["date of birth", "dob", "d.o.b", "birth date", "born", "birthday"], "date_of_birth"],
  [["address line 1", "address 1", "address", "addr", "street", "residential address"], "address_1"],
  [["address line 2", "address 2", "apartment", "apt", "suite", "landmark"], "address_2"],
  [["city", "town"], "city"],
  [["state", "province", "region"], "state"],
  [["zip", "zip code", "postal code", "pincode", "pin code", "postcode", "pin"], "zip"],
  [["country"], "country"],
  [["nationality", "citizenship"], "nationality"],
  [["passport", "passport no", "passport number"], "passport_no"],
];

const normLabel = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Pure text → [{ ontology_key, value }]. */
export function parseFields(text) {
  const out = {};
  const put = (k, v) => {
    const val = (v || "").trim();
    if (val && !out[k]) out[k] = val;
  };
  const putName = (val) => {
    const parts = val.split(/\s+/).filter(Boolean);
    if (parts.length) put("first_name", parts[0] ?? "");
    if (parts.length >= 3) {
      put("middle_name", parts.slice(1, -1).join(" "));
      put("last_name", parts[parts.length - 1] ?? "");
    } else if (parts.length === 2) {
      put("last_name", parts[1] ?? "");
    }
  };

  // Split lines that pack several "Label: value" pairs (common on IDs, e.g.
  // "City: Springfield State: IL Zip: 62704") so each label is captured on its own
  // instead of the first swallowing the rest. Only split before a KNOWN field label
  // (safe — arbitrary "Word:" text won't fragment a normal value).
  const NEXT_LABEL = /\s+(?=(?:name|first name|middle name|last name|dob|date of birth|address|city|town|state|province|zip|zip code|postal code|country|nationality|sex|gender|phone|mobile|email)\s*[:\-]\s)/i;
  const rawLines = [];
  for (const l of (text || "").split(/\r?\n/)) {
    for (const seg of l.split(NEXT_LABEL)) rawLines.push(seg);
  }
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    // "Label: value", "Label - value", or "Label   value" (2+ spaces).
    const m = line.match(/^(.{2,30}?)\s*[:\-–—]\s*(.+)$/) || line.match(/^([A-Za-z][A-Za-z .]{1,28}?)\s{2,}(.+)$/);
    if (!m) continue;
    const label = normLabel(m[1] ?? "");
    const value = (m[2] ?? "").trim();
    if (!value) continue;
    for (const [aliases, key] of LABELS) {
      if (aliases.some((a) => label === a || label.endsWith(" " + a) || label === a.replace(/ /g, ""))) {
        if (key === "__full") putName(value);
        else put(key, value);
        break;
      }
    }
  }

  // Label-free formats anywhere in the text.
  const email = (text || "").match(/\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/);
  if (email) put("email_address", email[0] ?? "");
  // Phone — but ONLY if it looks like one: a formatted number, or exactly 10 digits.
  // (Avoids grabbing a long unformatted ID/licence number as a phone.)
  for (const pm of (text || "").match(/\+?\d[\d\s().-]{7,}\d/g) || []) {
    const digits = pm.replace(/\D/g, "");
    const hasSep = /[\s().-]/.test(pm.trim());
    if (digits.length >= 10 && digits.length <= 13 && (hasSep || digits.length === 10)) {
      put("cell_phone", pm.trim().replace(/\s+/g, " "));
      break;
    }
  }

  idHeuristics(text, out, put);

  return Object.entries(out).map(([ontology_key, value]) => ({ ontology_key, value }));
}

// Parse the AAMVA payload decoded from a US/Canada driver's-licence PDF417 barcode
// (the barcode on the BACK). This is STRUCTURED data — exact, no OCR guessing.
// Elements are 3-letter codes followed by their value, one per line.
export function parseAamva(text) {
  const out = {};
  const put = (k, v) => { const val = (v || "").replace(/[,]+$/, "").trim(); if (val && !out[k]) out[k] = val; };
  const get = (code) => {
    const m = (text || "").match(new RegExp(`(?:^|[\\n\\r])${code}([^\\n\\r]*)`));
    return m ? m[1].trim() : "";
  };

  put("last_name", get("DCS") || get("DAB"));
  put("first_name", get("DAC") || get("DCT"));
  put("middle_name", get("DAD"));
  // Older licences pack the whole name into DAA as "LAST,FIRST,MIDDLE".
  if (!out.last_name && !out.first_name) {
    const daa = get("DAA");
    if (daa) { const p = daa.split(/,/); put("last_name", p[0]); put("first_name", p[1]); put("middle_name", p.slice(2).join(" ")); }
  }
  put("address_1", get("DAG"));
  put("address_2", get("DAH"));
  put("city", get("DAI"));
  put("state", get("DAJ"));
  const zip = get("DAK").replace(/\s/g, "");
  if (zip) put("zip", zip.length > 5 ? `${zip.slice(0, 5)}-${zip.slice(5, 9)}` : zip);
  const country = get("DCG");
  put("country", country);
  put("license_number", get("DAQ"));
  put("gender", ({ 1: "M", 2: "F" })[get("DBC")] || "");
  // DOB: US = MMDDCCYY, Canada = CCYYMMDD.
  const dbb = get("DBB").replace(/\D/g, "");
  if (dbb.length === 8) {
    const usa = !/CAN/i.test(country);
    const dob = usa
      ? `${dbb.slice(0, 2)}/${dbb.slice(2, 4)}/${dbb.slice(4, 8)}`
      : `${dbb.slice(4, 6)}/${dbb.slice(6, 8)}/${dbb.slice(0, 4)}`;
    put("date_of_birth", dob);
  }
  return Object.entries(out).map(([ontology_key, value]) => ({ ontology_key, value }));
}

// Extract identity fields from UNLABELLED documents — driver's licences / ID cards
// (AAMVA field numbers, name/address on bare lines). Fills only gaps the label parser
// left, so it never overrides a labelled form. Best-effort against noisy OCR.
function idHeuristics(text, out, put) {
  const lines = (text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const STREET = /\b(WAY|ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|LN|LANE|BLVD|BOULEVARD|CT|COURT|CIR|PL|PLACE|TER|TERRACE|HWY|PKWY|TRL|LOOP)\b/;
  const STATE = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";
  const STATE_RE = new RegExp(`\\b(${STATE})\\b`);
  const STOP = /DRIVER|LICEN[SC]E|IDENTIFICATION|CLASS|RESTR|ENDORS|DONOR|ORGAN|EYES|HAIR|\bSEX\b|HGT|WGT|\bISS\b|\bEXP\b|\bDLN\b|\bDOB\b|\bUSA\b|VETERAN|COMMISSIONER/i;

  // Name: mostly-uppercase alpha lines (an optional leading AAMVA field number), not
  // an address/state/keyword line. Surname line first, given-names line next.
  const nameCands = [];
  for (const l of lines) {
    const m = l.match(/^(?:\d{1,2}[a-z]?\s+)?([A-Z][A-Z'’.]+(?:\s+[A-Z][A-Z'’.]+){0,3})$/);
    if (!m) continue;
    const name = m[1];
    if (STREET.test(name) || STATE_RE.test(name) || STOP.test(name)) continue;
    if (name.replace(/[^A-Z]/g, "").length < 3) continue;
    nameCands.push(name);
  }
  if (nameCands.length && !out.first_name && !out.last_name) {
    if (nameCands.length >= 2) {
      put("last_name", nameCands[0].split(/\s+/)[0]);
      const given = nameCands[1].split(/\s+/);
      put("first_name", given[0]);
      if (given.length > 1) put("middle_name", given.slice(1).join(" "));
    } else {
      const parts = nameCands[0].split(/\s+/);
      put("first_name", parts[0]);
      if (parts.length >= 3) { put("middle_name", parts.slice(1, -1).join(" ")); put("last_name", parts[parts.length - 1]); }
      else if (parts.length === 2) put("last_name", parts[1]);
    }
  }

  // Fallback for NOISY scans (lowercase junk around the caps): anchor on the AAMVA
  // field numbers, which survive OCR noise. 1 = surname, 2 = first + middle.
  if (!out.first_name && !out.last_name) {
    const sur = text.match(/(?:^|[\s—-])1\s+([A-Z][A-Z'’]{2,})\b/);
    if (sur && !STOP.test(sur[1])) put("last_name", sur[1]);
    const giv = text.match(/(?:^|\s)2\s+([A-Z][A-Z'’]{2,}(?:\s+[A-Z][A-Z'’]{1,})*)/);
    if (giv) {
      const g = giv[1].split(/\s+/);
      put("first_name", g[0]);
      if (g.length > 1) put("middle_name", g.slice(1).join(" "));
    }
  }

  // Address: a line beginning with a house number and ending in a street type…
  for (const l of lines) {
    if (out.address_1) break;
    const m = l.match(new RegExp(`^(\\d{2,6}\\s+[A-Z0-9].*?${STREET.source})`));
    if (m) put("address_1", m[1].replace(/\s+/g, " ").trim());
  }
  // …or anchor on AAMVA field 8 (address) when the street word is mangled.
  if (!out.address_1) {
    const a = text.match(/(?:^|\s)8\s+(\d{2,6}[\sA-Za-z'.!-]+?)(?:\||$)/m);
    if (a) put("address_1", a[1].replace(/[!|]/g, "").replace(/\s+/g, " ").trim());
  }
  // City + state: "<CITY WORDS> <ST>" (state may be fused to the ZIP, e.g. "NC27587").
  for (const l of lines) {
    if (out.city) break;
    const m = l.match(new RegExp(`([A-Z][A-Za-z]+(?:\\s+[A-Z][A-Za-z]+){0,3}?)[,\\s]+(${STATE})(?=\\d|\\b)`));
    if (m && !STOP.test(m[1]) && !STREET.test(m[1])) {
      put("city", m[1].replace(/^[A-Z]{1,3}\s+(?=[A-Z][a-z])/, "").trim()); // drop a stray leading token
      put("state", m[2]);
    }
  }
  // ZIP: 5 digits, possibly fused to the state ("NC27587") or as ZIP+4.
  const zip = (text || "").match(/\b(?:[A-Z]{2})?(\d{5})(?:-\d{4})?\b/);
  if (zip) put("zip", zip[1]);

  // Date of birth: pick the date whose year is a plausible birth year (oldest wins).
  const thisYear = new Date().getFullYear();
  let bestDob = null;
  let bestYear = Infinity;
  for (const dm of (text || "").match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g) || []) {
    const y = parseInt(dm.match(/(\d{2,4})$/)[1], 10);
    const year = y < 100 ? (y > (thisYear % 100) ? 1900 + y : 2000 + y) : y;
    if (year >= 1900 && year <= thisYear - 14 && year < bestYear) { bestYear = year; bestDob = dm; }
  }
  if (bestDob) put("date_of_birth", bestDob);
}
