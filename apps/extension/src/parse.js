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
  // Phone — but ONLY if it looks like one AND the document plausibly has a phone. IDs /
  // driver's licences carry NO phone number, so their date/ID digits (e.g. an EXP date
  // "11/30/2029" fused with a field number) must never be misread as one.
  const isIdDoc = /driver|licen[sc]e|\bdln\b|\bdob\b|\bexp\b|\biss\b|identification|passport|\bclass\b|endors|restr/i.test(text || "");
  if (!isIdDoc) {
    for (const pm of (text || "").match(/\+?\d[\d\s().-]{7,}\d/g) || []) {
      const digits = pm.replace(/\D/g, "");
      const hasSep = /[\s().-]/.test(pm.trim());
      // A phone is 10 digits (US) or 11 starting with country-code 1 — and must be
      // FORMATTED (has separators); a bare 10-digit run is too easily an ID/date artefact.
      const phoneLen = digits.length === 10 || (digits.length === 11 && digits[0] === "1");
      if (phoneLen && hasSep) {
        put("cell_phone", pm.trim().replace(/\s+/g, " "));
        break;
      }
    }
  }

  // Passport MRZ (ICAO 9303) is exact structured data — use it and treat it as
  // AUTHORITATIVE. Only run the driver's-licence heuristics for NON-passports (they
  // produce garbage on a passport's layout).
  const mrz = parseMrz(text);
  if (mrz.length) {
    for (const { ontology_key, value } of mrz) out[ontology_key] = value;
    // Issue date isn't in the MRZ — best-effort from the printed zone: a "DD MON YYYY"
    // date that is neither the DOB nor the (MRZ) expiry, with a recent-past year.
    const MON = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
    const known = new Set([out.date_of_birth, out.passport_expiry_date]);
    const thisYear = new Date().getFullYear();
    for (const mm of (text || "").matchAll(/\b(\d{1,2})\s+([A-Z]{3})[A-Z.]*\s+(\d{4})\b/gi)) {
      const mo = MON[mm[2].toUpperCase()];
      if (!mo) continue;
      const d = `${mo}/${mm[1].padStart(2, "0")}/${mm[3]}`;
      const yr = Number(mm[3]);
      if (!known.has(d) && yr >= 2000 && yr <= thisYear && !out.passport_issue_date) out.passport_issue_date = d;
    }
  } else if (!/passport|travel document|pasaporte|passeport/i.test(text)) {
    idHeuristics(text, out, put);
  }

  // Expand a 3-letter nationality/country code (from the MRZ) to the full name; clean a garbled
  // visual-zone nationality (OCR "INITED STATES OF AMER").
  const COUNTRY = { USA: "UNITED STATES OF AMERICA", GBR: "UNITED KINGDOM", IND: "INDIA", CAN: "CANADA", AUS: "AUSTRALIA", DEU: "GERMANY", FRA: "FRANCE", ITA: "ITALY", ESP: "SPAIN", CHN: "CHINA", JPN: "JAPAN", KOR: "SOUTH KOREA", MEX: "MEXICO", BRA: "BRAZIL" };
  if (out.nationality) { const n = out.nationality.toUpperCase().trim(); if (COUNTRY[n]) out.nationality = COUNTRY[n]; else if (/[UI]N[IL]?TED\s*STATES|AMER/.test(n)) out.nationality = "UNITED STATES OF AMERICA"; }
  if (/passport|passeport|pasaporte/i.test(text)) {
    const tc = text.match(/\bP\s+([A-Z]{3})\b/); if (tc) { if (!out.passport_type) out.passport_type = "P"; if (!out.country_code) out.country_code = tc[1]; }
    const auth = text.match(/((?:UNITED STATES )?DEPARTMENT OF STATE|MINISTRY OF[A-Z ]{3,}|PASSPORT OFFICE)/i);
    if (auth && !out.issuing_authority) out.issuing_authority = auth[1].trim().replace(/\s+/g, " ");
    const M = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
    const md = [...text.toUpperCase().matchAll(/\b(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*[^\d]{0,3}(\d{4})\b/g)].map((m) => ({ d: `${M[m[2]]}/${m[1].padStart(2, "0")}/${m[3]}`, y: +m[3] })).filter((x) => x.y > 1900 && x.y < 2100);
    const now = new Date().getFullYear();
    for (const x of md) { if (x.y > now && !out.passport_expiry_date) out.passport_expiry_date = x.d; else if (x.y <= now && x.y >= now - 15 && !out.passport_issue_date) out.passport_issue_date = x.d; }
    if (!out.date_of_birth && md.length) out.date_of_birth = [...md].sort((a, b) => a.y - b.y)[0].d;
  }

  return Object.entries(out).map(([ontology_key, value]) => ({ ontology_key, value }));
}

// Parse an ICAO-9303 MRZ — the INTERNATIONAL standard on every country's passport and
// most national ID cards. Handles all three formats: TD3 (passport, 2×44), TD1 (ID
// card, 3×30), TD2 (2×36). Exact, checksummed, OCR-friendly (OCR-B). The number field
// is `passport_no` for a passport (P…) else `id_number`.
export function parseMrz(text) {
  const out = {};
  const setName = (field) => {
    const p = field.split("<<");
    const sur = (p[0] || "").replace(/[<CLKX]{3,}[A-Z]*$/i, "").replace(/</g, " ").trim();
    if (sur) out.last_name = sur;
    // Strip a trailing MRZ-filler run that OCR misread as letters ("<<<" -> "CCLLLLLS").
    const g = (p[1] || "").replace(/[<CLKX]{3,}[A-Z]*$/i, "").replace(/</g, " ").trim().split(/\s+/).filter((w) => w.length > 1);
    if (g.length) { out.first_name = g[0]; if (g.length > 1) out.middle_name = g.slice(1).join(" "); }
  };
  const setDob = (yymmdd) => {
    const m = (yymmdd || "").match(/^(\d{2})(\d{2})(\d{2})$/);
    if (m) { const yy = +m[1]; out.date_of_birth = `${m[2]}/${m[3]}/${yy > 30 ? 1900 + yy : 2000 + yy}`; }
  };
  const setNat = (s) => { const n = (s || "").replace(/</g, ""); if (/^[A-Z]{3}$/.test(n)) out.nationality = n; };
  const setSex = (s) => { if (s === "M" || s === "F") out.gender = s; };
  // Expiry years are in the future, so a 2-digit year pivots to 20xx (unlike DOB).
  const setExp = (yymmdd) => {
    const m = (yymmdd || "").match(/^(\d{2})(\d{2})(\d{2})$/);
    if (m) { const yy = +m[1]; out.passport_expiry_date = `${m[2]}/${m[3]}/${yy < 70 ? 2000 + yy : 1900 + yy}`; }
  };

  // A real MRZ line contains filler '<' (ordinary OCR text — e.g. a licence front — has
  // NONE), which prevents false MRZ matches; the strict per-format checks below do the rest.
  const lines = (text || "").toUpperCase().split(/\r?\n/)
    .map((l) => l.replace(/[^A-Z0-9<]/g, ""))
    .filter((l) => l.length >= 28 && l.length <= 46 && l.includes("<"));

  // TD3 — passport: line 1 starts with the document code then a filler/subtype (P<, PA…).
  const p1 = lines.find((l) => l.length >= 40 && /^P[A-Z<]/.test(l) && l.includes("<<"));
  const p2 = lines.find((l) => l.length >= 40 && l !== p1 && /^[A-Z0-9<]{9}\d?[A-Z<]{3}\d{6}/.test(l));
  if (p1 && p2) {
    setName(p1.slice(5));
    out.passport_no = p2.slice(0, 9).replace(/</g, "");
    setNat(p2.slice(10, 13)); setDob(p2.slice(13, 19)); setSex(p2[20]); setExp(p2.slice(21, 27));
    return finalMrz(out);
  }
  // TD1 — ID card (NOT passports, which are TD3 — the ID-card parsers false-match a passport MRZ).
  const _isPass = /passport|passeport|pasaporte/i.test(text || "");
  const t1 = _isPass ? [] : lines.filter((l) => l.length >= 28 && l.length <= 32);
  if (t1.length >= 3) {
    // The name line has "<<" and NO digits; the doc-number/data lines carry digits.
    const nameLine = t1.find((l) => l.includes("<<") && !/\d/.test(l)) || t1[2];
    const l1 = t1.find((l) => /^[A-Z<]{2}[A-Z]{3}\d/.test(l)) || t1[0];
    const l2 = t1.find((l) => /^\d{6}\d[MF<]/.test(l));
    setName(nameLine);
    if (l1) out.id_number = l1.slice(5, 14).replace(/</g, "");
    if (l2) { setDob(l2.slice(0, 6)); setSex(l2[7]); setExp(l2.slice(8, 14)); setNat(l2.slice(15, 18)); }
    return finalMrz(out);
  }
  // TD2 — 2 lines of ~36; name on line 1, numbers on line 2.
  const t2 = _isPass ? [] : lines.filter((l) => l.length >= 34 && l.length <= 38);
  if (t2.length >= 2) {
    const l1 = t2.find((l) => l.includes("<<") && !/\d/.test(l)) || t2[0]; // name line (no digits)
    const l2 = t2.find((l) => l !== l1 && /^[A-Z0-9<]{9}\d[A-Z<]{3}\d{6}/.test(l)) || t2[1];
    setName(l1.slice(5));
    if (l2) { out.id_number = l2.slice(0, 9).replace(/</g, ""); setNat(l2.slice(10, 13)); setDob(l2.slice(13, 19)); setSex(l2[20]); setExp(l2.slice(21, 27)); }
    return finalMrz(out);
  }
  // LENIENT recovery: a real passport ALWAYS prints the MRZ, but OCR often misreads the leading 'P'
  // (-> B/D/8) and the '<' filler, so the strict TD3 checks above miss it. Scan the raw text for the
  // two MRZ signatures anywhere — exact, checksummed data that beats the noisy visual zone.
  const J = (text || "").toUpperCase().replace(/[^A-Z0-9<\n]/g, "").split(/\n/).map((l) => l.replace(/\s+/g, ""));
  for (const l of J) {
    const m = l.match(/<([A-Z]{3})([A-Z]{2,})<<([A-Z][A-Z<]+)/);
    if (m) { setNat(m[1]); setName(`${m[2]}<<${m[3]}`); break; }
  }
  for (const l of J) {
    const m = l.match(/(\d{6,9})[<A-Z0-9]{0,2}([A-Z]{3})(\d{6})\d?([MFX<])(\d{6})/);
    if (m) { if (!out.passport_no) out.passport_no = m[1]; setNat(m[2]); setDob(m[3]); setSex(m[4]); setExp(m[5]); break; }
  }
  return Object.keys(out).length ? finalMrz(out) : [];
}
function finalMrz(out) {
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
  // US ZIP+4 is 9 digits -> "12345-6789" (drop a "-0000" filler). A Canadian postal code
  // is alphanumeric ("M5H2N2") and must be left as-is (never dashed like a US zip).
  if (zip) {
    if (/^\d{9}$/.test(zip)) put("zip", /0000$/.test(zip) ? zip.slice(0, 5) : `${zip.slice(0, 5)}-${zip.slice(5, 9)}`);
    else put("zip", zip);
  }
  const country = get("DCG");
  put("country", country);
  put("license_number", get("DAQ"));
  put("gender", ({ 1: "M", 2: "F" })[get("DBC")] || "");
  // Dates: US = MMDDCCYY, Canada = CCYYMMDD. DBB = date of birth, DBA = licence expiry,
  // DBD = licence issue. Expiry/issue are DOCUMENT-QUALIFIED (dl_*) since a passport/other
  // ID carries its own expiry — the vault must not conflate them.
  const usa = !/CAN/i.test(country);
  const fmtDate = (code) => {
    const s = get(code).replace(/\D/g, "");
    if (s.length !== 8) return "";
    return usa ? `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4, 8)}`
               : `${s.slice(4, 6)}/${s.slice(6, 8)}/${s.slice(0, 4)}`;
  };
  put("date_of_birth", fmtDate("DBB"));
  put("dl_expiry_date", fmtDate("DBA"));
  put("dl_issue_date", fmtDate("DBD"));
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
  // AUTHORITATIVE: AAMVA field 1 = family name. A line that BEGINS with the bare field number "1" is
  // a stronger signal than line order — a dual-pass OCR can surface the surname line ("1 MYSORE") and
  // the given-names line in either order, so anchor on the number, not the sequence.
  const cleanToks = (s) => (s || "").split(/\s+/).filter(
    (t) => /^[A-Z][A-Z'’.]{1,}$/.test(t) && !STOP.test(t) && !STATE_RE.test(t) && !STREET.test(t),
  );
  const famLine = lines.find((l) => /^1[\s.:_-]+[A-Z]/.test(l));
  if (famLine && !out.last_name) { const t = cleanToks((famLine.match(/^1[\s.:_-]+(.+)$/) || [])[1]); if (t.length) put("last_name", t.join(" ")); }

  // GIVEN names: the caps candidate line with the MOST letters (a real name outweighs short noise and
  // the possibly-truncated "2 …" field line). Runs whenever the first name is still missing, even if
  // the surname is already known from field 1.
  if (nameCands.length && !out.first_name) {
    const surTok = (out.last_name || "").split(/\s+/)[0];
    const givenCand = nameCands
      .filter((n) => n.split(/\s+/)[0] !== surTok)
      .sort((a, b) => b.replace(/[^A-Z]/g, "").length - a.replace(/[^A-Z]/g, "").length)[0] || nameCands[0];
    const parts = givenCand.split(/\s+/);
    put("first_name", parts[0]);
    if (out.last_name) {
      if (parts.length > 1) put("middle_name", parts.slice(1).join(" "));
    } else if (nameCands.length >= 2 && givenCand === nameCands[nameCands.length - 1]) {
      // Surname line above + given-names line below (classic US licence layout): first / middle / last.
      put("last_name", nameCands[0].split(/\s+/)[0]);
      if (parts.length > 1) put("middle_name", parts.slice(1).join(" "));
    } else if (parts.length >= 3) {
      put("middle_name", parts.slice(1, -1).join(" ")); put("last_name", parts[parts.length - 1]);
    } else if (parts.length === 2) {
      put("last_name", parts[1]);
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

  // Surname (AAMVA field 1) when we have given names but the "1" marker was garbled:
  // it's on the line just BEFORE the given-names line — take its all-caps name token.
  if (out.first_name && !out.last_name) {
    const gi = lines.findIndex((l) => l.includes(out.first_name));
    if (gi > 0) {
      const tok = lines[gi - 1].split(/[^A-Za-z]+/).find(
        (t) => /^[A-Z]{3,}$/.test(t) && !STOP.test(t) && !STATE_RE.test(t) && !STREET.test(t) && t !== out.first_name,
      );
      if (tok) put("last_name", tok);
    }
  }

  // Address: a house number + street type ANYWHERE in a line (the AAMVA "8" marker
  // often OCRs to junk, so don't require the line to start with the number).
  for (const l of lines) {
    if (out.address_1) break;
    const m = l.match(new RegExp(`(\\d{2,6}\\s+[A-Z][A-Za-z .]*?${STREET.source})`));
    if (m) put("address_1", m[1].replace(/\s+/g, " ").trim());
  }
  // …or anchor on AAMVA field 8 (address) when the street word is mangled.
  if (!out.address_1) {
    const a = text.match(/(?:^|\s)8\s+(\d{2,6}[\sA-Za-z'.!-]+?)(?:\||$)/m);
    if (a) put("address_1", a[1].replace(/[!|]/g, "").replace(/\s+/g, " ").trim());
  }
  // A plausible city is multi-word or ≥5 chars — reject 3-letter OCR garbage ("INS").
  const okCity = (c) => c && !STOP.test(c) && !STREET.test(c) && (/\s/.test(c.trim()) || c.trim().length >= 5);
  // City + state: "<CITY WORDS> <ST>" (state may be fused to the ZIP, e.g. "NC27587").
  for (const l of lines) {
    if (out.city) break;
    const m = l.match(new RegExp(`([A-Z][A-Za-z]+(?:\\s+[A-Z][A-Za-z]+){0,3}?)[,\\s]+(${STATE})(?=\\d|\\b)`));
    if (m && okCity(m[1])) { put("city", m[1].trim()); put("state", m[2]); }
  }
  // Fallback: "<City>, <XX> <5-digit ZIP>" — recover the CITY even when the state OCRs
  // wrong (e.g. "WAKE FOREST, No 27587"); only accept the state if it's a real US state.
  if (!out.city) {
    const m = (text || "").match(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}),?\s+([A-Za-z]{2})\s+\d{5}/);
    if (m && okCity(m[1])) {
      put("city", m[1].trim());
      if (STATE_RE.test(m[2].toUpperCase())) put("state", m[2].toUpperCase());
    }
  }
  // ZIP: 5 digits, possibly fused to the state ("NC27587") or as ZIP+4.
  const zip = (text || "").match(/\b(?:[A-Z]{2})?(\d{5})(?:-\d{4})?\b/);
  if (zip) put("zip", zip[1]);

  // Classify the dates on a driver's licence by their YEAR — robust to messy OCR that
  // garbles the "EXP"/"ISS" markers. DOB = oldest birth-plausible year; EXPIRY = a date in
  // the FUTURE (licence validity); ISSUE = a recent PAST date that isn't the DOB. A cleanly
  // read EXP/ISS marker takes priority when present. Keys are document-qualified (dl_*).
  const thisYear = new Date().getFullYear();
  const yearOf = (dm) => { const y = +dm.match(/(\d{2,4})$/)[1]; return String(dm.match(/(\d{2,4})$/)[1]).length <= 2 ? (y > thisYear % 100 ? 1900 + y : 2000 + y) : y; };
  const dates = ((text || "").match(/\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/g) || []).map((dm) => ({ raw: dm, year: yearOf(dm) }));
  const births = dates.filter((d) => d.year >= 1900 && d.year <= thisYear - 14).sort((a, b) => a.year - b.year);
  if (births[0]) put("date_of_birth", births[0].raw);
  const dob = births[0] && births[0].raw;

  const DATE = "(\\d{1,2}[/\\-.]\\d{1,2}[/\\-.]\\d{2,4})";
  const expM = text.match(new RegExp(`\\bEXP\\b[^0-9]{0,8}${DATE}`, "i"));
  const issM = text.match(new RegExp(`\\bISS\\b[^0-9]{0,8}${DATE}`, "i"));
  const future = dates.filter((d) => d.year > thisYear).sort((a, b) => b.year - a.year);
  const recentPast = dates.filter((d) => d.raw !== dob && d.year <= thisYear && d.year > thisYear - 20).sort((a, b) => b.year - a.year);
  const expiry = (expM && expM[1]) || (future[0] && future[0].raw);
  if (expiry) put("dl_expiry_date", expiry);
  const issue = (issM && issM[1]) || (recentPast.find((d) => d.raw !== expiry) || {}).raw;
  if (issue) put("dl_issue_date", issue);

  // OCR artifact cleanup: a driver's licence prints "CLASS <X>" (e.g. C) right beside the
  // name, and OCR can FUSE that class letter onto the end of a name ("VISHWANATHAN" -> the
  // stored "VISHWANATHANC"). If a name ends with the class letter AND stripping it still
  // leaves a real (≥5-char) name with no trailing space, drop the stray letter.
  const cls = (text.match(/\bCLASS\s*([A-EM])\b/i) || [])[1];
  if (cls) {
    const C = cls.toUpperCase();
    for (const k of ["first_name", "middle_name", "last_name"]) {
      const v = out[k];
      if (v && v.length >= 6 && v.toUpperCase().endsWith(C) && !/\s/.test(v.slice(-2))) {
        out[k] = v.slice(0, -1);
      }
    }
  }
}
