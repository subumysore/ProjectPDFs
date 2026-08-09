// On-device OCR data-source extraction (REQ-10), fully SELF-HOSTED: the worker,
// WASM core, and language model are served from the app origin (public/tesseract),
// so connect-src stays 'self' — zero third-party egress. The image and text never
// leave the device. Recognised text maps to canonical vault keys with explainable
// heuristics; the user reviews before saving to the vault.

export interface ExtractedField {
  ontology_key: string;
  value: string;
}

// The canonical key + human label under which the WHOLE source document image is retained in the
// vault, alongside the recognised fields. These keys are the SAME ontology the browser extension
// writes, and the classification MIRRORS apps/extension/src/capture.js docImageKey() so the desktop
// and extension agree on a shared vault (one source of truth): a decoded PDF417 barcode is the BACK;
// otherwise the printed side is classified from the OCR TEXT — identity markers (name/DOB/address) =
// FRONT, the boilerplate side (class/restrictions/endorsements) = BACK.
const BACK_MARKERS = /\b(class|restr|restrictions|endorsement|gvwr|commercial|legal presence|organ donor|noncommercial)\b/i;
const DL_MARKERS = /driver|licen[sc]e|\bdln\b/i;
const PASSPORT_MARKERS = /passport|passeport|pasaporte/i;
export function documentImageKey(
  fields: ReadonlyArray<ExtractedField>,
  opts: { isBarcodeBack?: boolean; text?: string } = {},
): { key: string; label: string } {
  const keys = new Set(fields.map((f) => f.ontology_key));
  const text = opts.text || "";
  if (opts.isBarcodeBack) return { key: "driver_license_back", label: "Driver’s licence — back (barcode)" };
  if (keys.has("passport_no") || PASSPORT_MARKERS.test(text)) return { key: "passport_image", label: "Passport" };
  // The number-vs-ID-number fix in parseFields now captures a bare licence number as license_no, so a
  // front whose name/DOB OCR is weak still lands here as identity -> front (that was the real bug: a
  // licence number was going to cell_phone, leaving NO identity, so the front fell through to "back").
  const hasIdentity = ["first_name", "last_name", "date_of_birth", "address_1"].some((k) => keys.has(k)) || keys.has("license_no");
  if (hasIdentity) return { key: "driver_license_front", label: "Driver’s licence — front" };
  if (BACK_MARKERS.test(text)) return { key: "driver_license_back", label: "Driver’s licence — back" };
  if (DL_MARKERS.test(text)) return { key: "driver_license_front", label: "Driver’s licence — front" };
  return { key: "document_image", label: "ID document" };
}


// Label -> canonical vault key. Keys match the seeded vault ontology so an image can
// CREATE or UPDATE the user's existing fields (name parts, address, contact, etc.).
const LABELS: ReadonlyArray<readonly [readonly string[], string]> = [
  [["first name", "given name", "forename", "given"], "first_name"],
  [["middle name", "middle"], "middle_name"],
  [["last name", "surname", "family name"], "last_name"],
  // "given names" (plural, as passports print it) carries first + middle together — split it, so it
  // is NOT swallowed by the "given" prefix into first_name = "names: JOHN QUINCY".
  [["full name", "name", "given names", "forenames"], "__full"], // split into first/middle/last
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
  // Field labels only — NOT document titles. "driver license"/"driving licence" are the card's
  // banner, not a field, and OCR often merges the banner with nearby text ("DRIVER LICENSE
  // SPECIMEN"), which would then be captured as the licence number and crowd out the real one.
  [["license no", "licence no", "license number", "licence number", "dl no", "dl number", "license", "licence"], "license_no"],
  [["id no", "id number", "identification no", "identity no"], "id_no"],
  [["expires", "expiry", "expiration", "expiry date", "valid until", "valid thru", "exp"], "expiry_date"],
  [["issued", "issue date", "date of issue"], "issue_date"],
];

const normLabel = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Known labels, longest first, for cards that print "Label value" with a SINGLE space and no colon
// (driver licences, ID cards). Longest-first so "license no" wins over "license".
const PREFIX_ALIASES: ReadonlyArray<readonly [string, string]> = LABELS
  .flatMap(([aliases, key]) => aliases.map((a) => [a, key] as const))
  .sort((a, b) => b[0].length - a[0].length);

/** Parse an ICAO-9303 MRZ (TD3 passport 2×44, TD1 ID 3×30, TD2 2×36) — exact, checksummed, OCR-B,
 *  language-independent. Desktop port of the extension's parse.js parseMrz (shared-vault parity). */
export function parseMrz(text: string): ExtractedField[] {
  const out: Record<string, string> = {};
  const setName = (field: string) => {
    const p = field.split("<<");
    const sur = (p[0] || "").replace(/[<CLKX]{3,}[A-Z]*$/i, "").replace(/</g, " ").trim();
    if (sur) out.last_name = sur;
    // Given names: cut a trailing MRZ-filler run that OCR misread as letters ("<<<" → "CCLLLLLS").
    const g = (p[1] || "").replace(/[<CLKX]{3,}[A-Z]*$/i, "").replace(/</g, " ").trim().split(/\s+/).filter((w) => w.length > 1);
    if (g.length) { out.first_name = g[0] ?? ""; if (g.length > 1) out.middle_name = g.slice(1).join(" "); }
  };
  const setDob = (s: string) => { const m = (s || "").match(/^(\d{2})(\d{2})(\d{2})$/); if (m) { const yy = +(m[1] ?? "0"); out.date_of_birth = `${m[2]}/${m[3]}/${yy > 30 ? 1900 + yy : 2000 + yy}`; } };
  const setExp = (s: string) => { const m = (s || "").match(/^(\d{2})(\d{2})(\d{2})$/); if (m) { const yy = +(m[1] ?? "0"); out.passport_expiry_date = `${m[2]}/${m[3]}/${yy < 70 ? 2000 + yy : 1900 + yy}`; } };
  const setNat = (s: string) => { const n = (s || "").replace(/</g, ""); if (/^[A-Z]{3}$/.test(n)) out.nationality = n; };
  const setSex = (s: string) => { if (s === "M" || s === "F") out.gender = s; };
  const lines = (text || "").toUpperCase().split(/\r?\n/)
    .map((l) => l.replace(/[^A-Z0-9<]/g, ""))
    .filter((l) => l.length >= 28 && l.length <= 46 && l.includes("<"));
  const fin = (): ExtractedField[] => Object.entries(out).map(([ontology_key, value]) => ({ ontology_key, value }));
  // TD3 — passport (2×44): line 1 = "P<" + name; line 2 = number + nationality + dob + sex + expiry.
  const p1 = lines.find((l) => l.length >= 40 && /^P[A-Z<]/.test(l) && l.includes("<<"));
  const p2 = lines.find((l) => l.length >= 40 && l !== p1 && /^[A-Z0-9<]{9}\d?[A-Z<]{3}\d{6}/.test(l));
  if (p1 && p2) {
    setName(p1.slice(5));
    out.passport_no = p2.slice(0, 9).replace(/</g, "");
    setNat(p2.slice(10, 13)); setDob(p2.slice(13, 19)); setSex(p2[20] ?? ""); setExp(p2.slice(21, 27));
    return fin();
  }
  // TD1 — ID card (3×30): name on line 3, numbers on lines 1–2. NOT for passports (they are TD3) — the
  // ID-card parsers false-match a passport MRZ and produce a bogus id_no, so skip them for passports.
  const isPassport = /passport|passeport|pasaporte/i.test(text || "");
  const t1 = isPassport ? [] : lines.filter((l) => l.length >= 28 && l.length <= 32);
  if (t1.length >= 3) {
    const nameLine = t1.find((l) => l.includes("<<") && !/\d/.test(l)) || t1[2] || "";
    const l1 = t1.find((l) => /^[A-Z<]{2}[A-Z]{3}\d/.test(l)) || t1[0];
    const l2 = t1.find((l) => /^\d{6}\d[MF<]/.test(l));
    setName(nameLine);
    if (l1) out.id_no = l1.slice(5, 14).replace(/</g, "");
    if (l2) { setDob(l2.slice(0, 6)); setSex(l2[7] ?? ""); setExp(l2.slice(8, 14)); setNat(l2.slice(15, 18)); }
    return fin();
  }
  // TD2 — 2×36: name on line 1, numbers on line 2. Also skipped for passports (TD3).
  const t2 = isPassport ? [] : lines.filter((l) => l.length >= 34 && l.length <= 38);
  if (t2.length >= 2) {
    const l1 = t2.find((l) => l.includes("<<") && !/\d/.test(l)) || t2[0] || "";
    const l2 = t2.find((l) => l !== l1 && /^[A-Z0-9<]{9}\d[A-Z<]{3}\d{6}/.test(l)) || t2[1] || "";
    setName(l1.slice(5));
    if (l2) { out.id_no = l2.slice(0, 9).replace(/</g, ""); setNat(l2.slice(10, 13)); setDob(l2.slice(13, 19)); setSex(l2[20] ?? ""); setExp(l2.slice(21, 27)); }
    return fin();
  }
  // LENIENT recovery: a real passport ALWAYS prints the MRZ, but OCR often misreads the leading 'P'
  // (→ B/D/8) and the '<' filler, so the strict TD3 checks above miss it. Scan the raw text for the two
  // MRZ signatures anywhere — this is exact, checksummed data and beats the noisy visual zone.
  const J = (text || "").toUpperCase().replace(/[^A-Z0-9<\n]/g, "").split(/\n/).map((l) => l.replace(/\s+/g, ""));
  for (const l of J) {
    // Name line: <CCC SURNAME << GIVEN (the 3 letters after a '<' are the issuing-country code).
    const m = l.match(/<([A-Z]{3})([A-Z]{2,})<<([A-Z][A-Z<]+)/);
    if (m) { setNat(m[1] ?? ""); setName(`${m[2]}<<${m[3]}`); break; }
  }
  for (const l of J) {
    // Data line: passport# (6-9) + nationality(3) + DOB(6) + check + sex + expiry(6).
    const m = l.match(/(\d{6,9})[<A-Z0-9]{0,2}([A-Z]{3})(\d{6})\d?([MFX<])(\d{6})/);
    if (m) { if (!out.passport_no) out.passport_no = m[1] ?? ""; setNat(m[2] ?? ""); setDob(m[3] ?? ""); setSex(m[4] ?? ""); setExp(m[5] ?? ""); break; }
  }
  return Object.keys(out).length ? fin() : [];
}

/** Pure text → vault fields. Exported for unit testing (no OCR needed). */
export function parseFields(text: string): ExtractedField[] {
  const out: Record<string, string> = {};
  const put = (k: string, v: string) => {
    const val = (v || "").trim();
    if (val && !out[k]) out[k] = val;
  };
  const putName = (val: string) => {
    const parts = val.split(/\s+/).filter(Boolean);
    if (parts.length) put("first_name", parts[0] ?? "");
    if (parts.length >= 3) {
      put("middle_name", parts.slice(1, -1).join(" "));
      put("last_name", parts[parts.length - 1] ?? "");
    } else if (parts.length === 2) {
      put("last_name", parts[1] ?? "");
    }
  };

  const assign = (key: string, value: string) => {
    if (key === "__full") putName(value);
    else put(key, value);
  };

  // ICAO-9303 MRZ (the "<<<<" strip on passports and most national IDs) is EXACT, checksummed,
  // language-independent structured data. Read it FIRST and treat it as authoritative — the printed
  // visual zone OCRs to garbage (labels like "Prénoms/Nombres" landing in first_name). Seeding out[]
  // here means the label loop below (put-guarded) can only fill gaps, never overwrite the MRZ. This is
  // the desktop port of the extension's parse.js parseMrz — the real "works regardless of the image".
  for (const { ontology_key, value } of parseMrz(text)) out[ontology_key] = value;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // 1) "Label: value", "Label - value", or "Label   value" (2+ spaces).
    const m = line.match(/^(.{2,30}?)\s*[:\-–—]\s*(.+)$/) || line.match(/^([A-Za-z][A-Za-z .]{1,28}?)\s{2,}(.+)$/);
    if (m) {
      const label = normLabel(m[1] ?? "");
      const value = (m[2] ?? "").trim();
      if (value) {
        let matched = false;
        for (const [aliases, key] of LABELS) {
          if (aliases.some((a) => label === a || label.endsWith(" " + a) || label === a.replace(/ /g, ""))) {
            assign(key, value);
            matched = true;
            break;
          }
        }
        // Only stop here if a label really matched; otherwise the "separator" was just a hyphen
        // inside the value (e.g. a licence number), so fall through to the single-space matcher.
        if (matched) continue;
      }
    }
    // 2) "Label value" with a SINGLE space and no separator — the common ID-card layout.
    //    Match the longest known label at the start of the line; the rest is the value.
    const norm = normLabel(line);
    for (const [alias, key] of PREFIX_ALIASES) {
      if (norm === alias) break; // label with no value on the line
      if (norm.startsWith(alias + " ")) {
        // Slice the value off the ORIGINAL line (preserve case/punctuation), not the normalised one.
        const value = line.slice(line.toLowerCase().indexOf(alias) + alias.length).replace(/^[\s:.\-–—]+/, "").trim();
        if (value) assign(key, value);
        break;
      }
    }
  }

  // PAYMENT CARD (credit/debit): a 13–19 digit Luhn-valid number (spaces/dashes ok) is unmistakably a
  // card number, so detect it UP-FRONT — before the label-free grabber would mis-file it as a licence/ID.
  // Expiry = MM/YY near "valid thru/expires"; cardholder = an all-caps name line. Best-effort; the user
  // reviews before saving. CVV is never on the front and is deliberately not captured.
  {
    const luhn = (d: string) => { let s = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = +(d[i] ?? "0"); if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return d.length > 0 && s % 10 === 0; };
    const pan = (text.match(/\b(?:\d[ -]?){13,19}\b/g) || []).map((m) => m.replace(/\D/g, "")).find((d) => d.length >= 13 && d.length <= 19 && luhn(d));
    if (pan) {
      out["card_number"] = pan.replace(/(\d{4})(?=\d)/g, "$1 ").trim(); // grouped in 4s
      const exp = text.match(/\b(0[1-9]|1[0-2])\s*[/\-]\s*(\d{4}|\d{2})\b/);
      if (exp && exp[1] && exp[2]) out["card_expiry"] = `${exp[1]}/${exp[2].length === 4 ? exp[2].slice(2) : exp[2]}`;
      const BANKWORD = /\b(VISA|MASTERCARD|DEBIT|CREDIT|BANK|VALID|THRU|MEMBER|EXPIRES|CARDHOLDER|PLATINUM|GOLD|SIGNATURE|WORLD|ELITE)\b/;
      const nameLine = text.split(/\r?\n/).map((l) => l.trim())
        .find((l) => /^[A-Z][A-Z .'-]{4,30}$/.test(l) && l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 3 && !BANKWORD.test(l));
      if (nameLine) out["card_name"] = nameLine;
    }
  }
  // Label-free formats anywhere in the document — but never overwrite a labelled value, and
  // don't mistake a licence/ID number for a phone number (that was the classic misread).
  const email = text.match(/\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/);
  if (email) put("email_address", email[0] ?? "");
  if (!out["cell_phone"] && !out["license_no"] && !out["id_no"] && !out["passport_no"] && !out["card_number"]) {
    // A single number token — separators allowed WITHIN a line (space/dash/paren) but NOT across a
    // newline, so two separate numbers on adjacent lines never fuse into one garbled value.
    const numMatch = text.match(/(?:\+?\d[\d \-()]{7,}\d)/);
    if (numMatch) {
      const raw = (numMatch[0] ?? "").replace(/\s+/g, " ").trim();
      const digits = raw.replace(/\D/g, "");
      // On an ID document a bare number is the DOCUMENT number, not a phone — and phone numbers never
      // begin with several zeros. Route it to the right ID field instead of mislabelling a licence or
      // passport number as "cell_phone" (the exact misread this guard is meant to prevent: a licence
      // number like 000026610696 was landing in cell_phone).
      const idContext = DL_MARKERS.test(text) || PASSPORT_MARKERS.test(text);
      const looksLikeIdNumber = /^0{2,}/.test(digits);
      // A US ZIP+4 ("27587-3971") is 9 digits in a 5-4 group — it is an ADDRESS, never a licence/ID or
      // phone number. The label-free grabber used to seize it as the licence number; exclude that shape.
      const isZip4 = /^\d{5}[-\s]\d{4}$/.test(raw);
      if (isZip4) {
        // leave it for the ZIP extractor below; do not route to any ID/phone field
      } else if (idContext || looksLikeIdNumber) {
        if (PASSPORT_MARKERS.test(text)) put("passport_no", raw);
        else if (DL_MARKERS.test(text)) put("license_no", raw);
        else put("id_no", raw);
      } else {
        put("cell_phone", raw);
      }
    }
  }

  // --- Messy real-world ID heuristics: a licence FRONT and a passport visual zone rarely OCR as clean
  //     "Label: value" — the name is on its own line, dates are fused with field codes, and passport
  //     labels ("Surname/Nom/Apellidos") sit ABOVE their value on a later line. These only fill GAPS
  //     the clean label pass + MRZ left, so nothing here overwrites a confidently-parsed field. ---
  const lr = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const STOP = /\b(DRIVER|LICEN[SC]E|CAROLINA|COMMISSIONER|MOTOR|VEHICLE|DEPARTMENT|PASSPORT|PASAPORTE|PASSEPORT|CLASS|ENDORSE|ENDORSEMENT|RESTR|NATIONALITY|SURNAME|GIVEN|NAMES|NORTH|SOUTH|WEST|EAST|SIGNATURE|TITULAIRE|ANNOTATION|MENTION|BEARER|ISSUING|AUTHORITY|TIPO)\b/;
  // "Name-like" caps tokens: >=4 letters (drops 2-3 char OCR noise), not document boilerplate. Garbage
  // prefixes ("; >") are ignored because we filter tokens, not whole lines.
  const nameToks = (l: string) => l.split(/\s+/).filter((t) => /^[A-Z][A-Z'-]{3,}$/.test(t) && !STOP.test(t));
  const toksAfter = (re: RegExp): string[] => {
    const i = lr.findIndex((l) => re.test(l.toLowerCase()));
    if (i < 0) return [];
    for (let j = i + 1; j < Math.min(i + 6, lr.length); j++) { const t = nameToks(lr[j] ?? ""); if (t.length) return t; }
    return [];
  };
  const looksGarbled = (v?: string) => !v || /[\/<>]/.test(v) || v.replace(/[A-Za-z ]/g, "").length > 1 || v.trim().length < 2;

  if (PASSPORT_MARKERS.test(text)) {
    // Passport visual zone is AUTHORITATIVE over the clean-label pass here — the multilingual label
    // ("Given names/Prénoms/Nombres") fools that pass into first_name="/Prénoms/Nombres", so overwrite
    // any garbled name with the real caps value that sits below the label.
    const sur = toksAfter(/surname|apellidos|\bnom\b/);
    if (sur[0] && (looksGarbled(out["last_name"]))) out["last_name"] = sur[0];
    const giv = toksAfter(/given names|pr[eé]noms|nombres/);
    if (giv.length) { if (looksGarbled(out["first_name"])) out["first_name"] = giv[0] ?? ""; if (giv.length > 1 && looksGarbled(out["middle_name"])) out["middle_name"] = giv.slice(1).join(" "); }
    // Nationality: first up-to-4 caps words on the line after the label (skip trailing OCR noise).
    const wordsAfter = (re: RegExp, n: number) => { const i = lr.findIndex((l) => re.test(l.toLowerCase())); if (i < 0) return ""; for (let j = i + 1; j < Math.min(i + 4, lr.length); j++) { const ws = (lr[j] ?? "").split(/\s+/).filter((t) => /^[A-Z]{2,}$/.test(t)); if (ws.length) return ws.slice(0, n).join(" "); } return ""; };
    const nat = wordsAfter(/nationality|nationalit|nacionalidad/, 4);
    if (nat && looksGarbled(out["nationality"])) out["nationality"] = nat;
    const pob = toksAfter(/place of birth|lieu de naissance|lugar de nacimiento/)[0];
    if (pob && looksGarbled(out["place_of_birth"])) out["place_of_birth"] = pob;
  }

  // AAMVA numbered fields on a US licence FRONT: field 1 = family name, field 2 = given names. Sparse-
  // text OCR (PSM 11) reads these isolated label lines as "1 MYSORE" / "2 SUBRAMANYA ..." even when the
  // default layout pass mangles them. Field 1 is the AUTHORITATIVE surname source — the front print
  // rarely OCRs cleanly any other way. Match only a line that STARTS with the bare field number.
  const numberedName = (n: string): string[] => {
    for (const l of lr) {
      const m = l.match(new RegExp(`^${n}[\\s.:_-]+(.+)$`));
      if (m) { const t = nameToks(m[1] ?? ""); if (t.length) return t; }
    }
    return [];
  };
  const fam = numberedName("1");
  if (fam.length && looksGarbled(out["last_name"])) { delete out["last_name"]; put("last_name", fam.join(" ")); }

  // GIVEN names: a line of 2–3 name-like caps words. Noise lines ("BEAST TRIE ... NORD") and street/city
  // lines also look name-ish, so pick the candidate with the MOST total letters — a real name outweighs
  // short dictionary/street words. Run whenever the first name is missing, independent of the surname.
  if (looksGarbled(out["first_name"])) {
    const cands = lr.map((l, i) => ({ i, t: nameToks(l) })).filter((c) => c.t.length >= 2 && c.t.length <= 3);
    const best = cands.sort((a, b) => b.t.join("").length - a.t.join("").length)[0];
    if (best) {
      delete out["first_name"]; delete out["middle_name"];
      const given = best.t;
      put("first_name", given[0] ?? "");
      if (given.length > 1) put("middle_name", given.slice(1).join(" "));
      // Only if field 1 gave us nothing, fall back to the US layout convention that the SURNAME sits on
      // the line ABOVE the given names (a clean 1–2 token line that isn't part of the given names).
      if (looksGarbled(out["last_name"])) {
        const above = nameToks(lr[best.i - 1] ?? "");
        if (above.length >= 1 && above.length <= 2 && !above.some((w) => given.includes(w))) {
          delete out["last_name"]; put("last_name", above.join(" "));
        }
      }
    }
  }

  // A date_of_birth MUST be a plausible birth date — in the PAST, holder ~13–120 years old. A licence's
  // EXPIRY is in the FUTURE and commonly falls on the birthday (same MM/DD), so when the printed DOB
  // OCRs garbled the expiry (e.g. 11/30/2029) used to masquerade as the birth date. Reject any
  // implausible DOB and pick the earliest BIRTH-PLAUSIBLE date instead.
  const nowY = new Date().getFullYear();
  const birthYearOk = (d?: string) => { const y = +((d || "").split("/")[2] ?? 0); return y >= nowY - 120 && y <= nowY - 13; };
  if (out["date_of_birth"] && !birthYearOk(out["date_of_birth"])) delete out["date_of_birth"];
  // Dates MM/DD/YYYY anywhere: earliest birth-plausible = DOB, latest = expiry. A licence has THREE dates
  // (DOB, ISS issue, EXP expiry); the middle one chronologically is the issue date. A labelled
  // "ISS <date>" wins if present.
  const ds = [...new Set([...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)].map((m) => m[0]))]
    .sort((a, b) => +(a.split("/")[2] ?? 0) - +(b.split("/")[2] ?? 0));
  const births = ds.filter(birthYearOk);
  if (births.length && !out["date_of_birth"]) out["date_of_birth"] = births[0] ?? "";
  if (ds.length > 1 && !out["expiry_date"]) out["expiry_date"] = ds[ds.length - 1] ?? "";
  const issM = text.match(/\b(?:4A\s*)?ISS\.?\s*[:.]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (issM && issM[1] && !out["issue_date"]) out["issue_date"] = issM[1];
  else if (ds.length >= 3 && !out["issue_date"]) out["issue_date"] = ds[1] ?? ""; // middle date = issue

  // AAMVA-coded front fields (US licences print "15SEX M", "8 <address>", "18EYES HAZ", "19HAIR BLK",
  // "16HGT 5-06", "0 CLASS C"). Capture every one we can read so the profile fills as fully as possible.
  const grab = (re: RegExp, key: string, up = true) => { const m = text.match(re); if (m && m[1] && !out[key]) out[key] = up ? m[1].trim().toUpperCase() : m[1].trim(); };
  // NOTE: no leading \b — the AAMVA code sits flush against the label ("15SEX", "18EYES"), so a word
  // boundary before the label never matches.
  grab(/SEX\s*[:.]?\s*([MF])\b/i, "gender");
  grab(/CLASS\s+([A-Z0-9]{1,3})\b/i, "license_class");
  grab(/EYES?\.?\s*[:.]?\s*([A-Z]{3})\b/i, "eye_color");
  grab(/HAIR\.?\s*[:.]?\s*([A-Z]{3})\b/i, "hair_color");
  grab(/9A?\s*END\.?[:. ]*\s*(NONE|[A-Z0-9]{1,5})\b/i, "endorsements");
  grab(/(?:12\s*)?RESTR(?:ICTIONS?)?\.?[:. ]*\s*([A-Z0-9*-]{1,8})/i, "restrictions", false);
  grab(/\bH[EG]T\.?\s*[:.]?\s*(\d\s*['’]\s*-?\s*\d{2}\s*["”]?)/i, "height", false);
  // AAMVA address element "8" then the street.
  const addr = text.match(/(?:^|\s)8\s+(\d{2,6}\s+[A-Z][A-Z .'-]{2,})/m);
  if (addr && addr[1] && !out["address_1"]) out["address_1"] = addr[1].trim();
  // City / State / ZIP sit on the line(s) AFTER the street — NOT in the header. Anchor the search to
  // the address block so the state NAME in the header ("NORTH CAROLINA") can't be misread as a bogus
  // city/state. State must be a valid 2-letter code; OCR garbage glued after it is tolerated ("NCATE"→NC).
  const ST = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
  const streetIdx = lr.findIndex((l) => /\b8\s+\d{2,6}\s+[A-Z]/.test(l) || (!!out["address_1"] && l.toUpperCase().includes((out["address_1"].split(/\s+/)[1] || "###").toUpperCase())));
  if (streetIdx >= 0) {
    for (let j = streetIdx; j < Math.min(streetIdx + 3, lr.length); j++) {
      const m = (lr[j] ?? "").toUpperCase().match(new RegExp(`\\b([A-Z][A-Z]{2,}(?:\\s[A-Z]{2,})?)[,\\s]+(${ST})[A-Z]{0,3}\\s*(\\d{5})?`));
      if (m && m[1] && !/DEER|ALBINO|STREET|\bAVE\b|ROAD|LANE|DRIVE|\bWAY\b|BLVD|COURT/.test(m[1])) {
        if (!out["city"]) out["city"] = m[1].trim();
        if (m[2] && !out["state"]) out["state"] = m[2];
        if (m[3] && !out["zip"]) out["zip"] = m[3];
        break;
      }
    }
  }
  // Expand a 3-letter nationality/country code (from the MRZ) to its full name, and clean a garbled
  // visual-zone nationality (OCR "INITED STATES OF AMER").
  const COUNTRY: Record<string, string> = { USA: "UNITED STATES OF AMERICA", GBR: "UNITED KINGDOM", IND: "INDIA", CAN: "CANADA", AUS: "AUSTRALIA", DEU: "GERMANY", FRA: "FRANCE", ITA: "ITALY", ESP: "SPAIN", CHN: "CHINA", JPN: "JAPAN", KOR: "SOUTH KOREA", MEX: "MEXICO", BRA: "BRAZIL" };
  if (out["nationality"]) {
    const n = out["nationality"].toUpperCase().trim();
    if (COUNTRY[n]) out["nationality"] = COUNTRY[n];
    else if (/[UI]N[IL]?TED\s*STATES|AMER/.test(n)) out["nationality"] = "UNITED STATES OF AMERICA";
  }

  // Passport visual-zone extras (type/country, issuing authority, issue+expiry dates as "DD MON YYYY").
  const MON: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
  const monDates = [...text.toUpperCase().matchAll(/\b(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*[^\d]{0,3}(\d{4})\b/g)]
    .map((m) => ({ d: `${MON[m[2] ?? ""]}/${(m[1] ?? "").padStart(2, "0")}/${m[3]}`, y: +(m[3] ?? 0) })).filter((x) => x.y > 1900 && x.y < 2100);
  if (PASSPORT_MARKERS.test(text)) {
    const tc = text.match(/\bP\s+([A-Z]{3})\b/);
    if (tc) { if (!out["passport_type"]) out["passport_type"] = "P"; if (!out["country_code"]) out["country_code"] = tc[1] ?? ""; }
    const auth = text.match(/((?:UNITED STATES )?DEPARTMENT OF STATE|MINISTRY OF[A-Z ]{3,}|PASSPORT OFFICE)/i);
    if (auth && auth[1] && !out["issuing_authority"]) out["issuing_authority"] = auth[1].trim().replace(/\s+/g, " ");
    const now = 2026;
    for (const md of monDates) {
      if (md.y > now && !out["passport_expiry_date"] && !out["expiry_date"]) out["passport_expiry_date"] = md.d;
      else if (md.y <= now && md.y >= now - 15 && !out["issue_date"]) out["issue_date"] = md.d;
    }
  }
  // Reject a garbled/label date_of_birth (the multilingual "Date of birth/Date de naissance/..." label
  // can leak through the generic label pass) so a real date can take its place.
  if (out["date_of_birth"] && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(out["date_of_birth"])) delete out["date_of_birth"];
  // …and reject an implausible birth date (a future/expiry year that slipped through the generic pass).
  if (out["date_of_birth"] && !birthYearOk(out["date_of_birth"])) delete out["date_of_birth"];
  // DOB as "DD MON YYYY" (30 NOV 1968) if no slash-date/MRZ set one — earliest BIRTH-PLAUSIBLE mon-date.
  if (!out["date_of_birth"] && monDates.length) {
    const mb = [...monDates].filter((x) => birthYearOk(x.d)).sort((a, b) => a.y - b.y);
    if (mb[0]) out["date_of_birth"] = mb[0].d;
  }

  // ── FINAL SANITY PASS (applies to EVERY document/image, not one form) ──────────────────────────
  // Field values must satisfy their MEANING no matter which extraction path filled them. A value that
  // violates its field's invariant is dropped — a blank the user fills is always better than a
  // confident wrong value. This is the general guard behind the DL bugs (future "DOB", ZIP-as-licence).
  const digitsOnly = (s?: string) => (s || "").replace(/\D/g, "");
  // 1. A birth date is in the PAST, holder ~13–120 (never a future/expiry year).
  if (out["date_of_birth"] && !birthYearOk(out["date_of_birth"])) delete out["date_of_birth"];
  // 2. An ID / licence / passport NUMBER is not an ADDRESS: never a bare ZIP / ZIP+4, never equal to
  //    the extracted ZIP.
  for (const k of ["license_no", "id_no", "passport_no"]) {
    const v = out[k]; if (!v) continue;
    const d = digitsOnly(v);
    // A US ZIP+4 has a SEPARATOR ("27587-3971"); a bare 9-digit run (352279543) is a valid passport/ID
    // number, NOT a zip — so require the dash/space, or an exact match to the already-extracted ZIP.
    if (/^\d{5}[-\s]\d{4}$/.test(v.trim()) || (out["zip"] && d.length > 0 && d === digitsOnly(out["zip"]))) delete out[k];
  }
  // 3. An expiry / issue date must be a real date (a 4-digit year in a sane range) — drop noise.
  for (const k of ["expiry_date", "issue_date", "passport_expiry_date", "passport_issue_date", "dl_expiry_date", "dl_issue_date"]) {
    const v = out[k]; if (!v) continue;
    const y = +((v.match(/\b(\d{4})\b/) || [])[1] || 0);
    if (y && (y < 1900 || y > nowY + 30)) delete out[k];
  }
  return Object.entries(out).map(([ontology_key, value]) => ({ ontology_key, value }));
}

// Preprocess for OCR ("polaroid filter"): upscale small captures so text is large enough, grayscale,
// stretch contrast (1st–99th percentile), and — for over-exposed/glary images — apply a gamma>1 curve
// to darken blown-out highlights and pull washed-out text back. Ported from the extension's capture.js
// so desktop and extension read glossy IDs identically. Browser-only (canvas), fully on-device.
function preprocessCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const MIN_W = 1700;
  const scale = src.width < MIN_W ? MIN_W / src.width : 1;
  const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;
  const hist = new Uint32Array(256);
  const gray = new Uint8Array(w * h);
  let sum = 0, bright = 0;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) | 0;
    gray[j] = g; hist[g]!++; sum += g; if (g > 225) bright++;
  }
  const total = w * h;
  let lo = 0, hi = 255, cum = 0;
  for (let v = 0; v < 256; v++) { cum += hist[v]!; if (cum > total * 0.01) { lo = v; break; } }
  cum = 0;
  for (let v = 255; v >= 0; v--) { cum += hist[v]!; if (cum > total * 0.01) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  const overexposed = sum / total > 170 || bright / total > 0.35;
  const gamma = overexposed ? 1.8 : 1.0;
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    let g = (v - lo) * 255 / range;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    if (gamma !== 1) g = 255 * Math.pow(g / 255, gamma);
    lut[v] = (g < 0 ? 0 : g > 255 ? 255 : g) | 0;
  }
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const g = lut[gray[j]!]!; d[i] = d[i + 1] = d[i + 2] = g; }
  ctx.putImageData(im, 0, 0);
  return c;
}
async function fileToProcessedCanvas(file: File | Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const src = document.createElement("canvas");
  src.width = bmp.width; src.height = bmp.height;
  src.getContext("2d", { willReadFrequently: true })!.drawImage(bmp, 0, 0);
  return preprocessCanvas(src);
}

/** OCR an image on-device and pull out recognised data points for user review. */
export async function extractFromImage(
  file: File | Blob,
  onProgress?: (pct: number) => void,
  lang = "en",
): Promise<{ text: string; fields: ExtractedField[] }> {
  // Language-aware, and the worker is CACHED (shared factory) — re-scanning no longer
  // re-downloads and re-initialises the model every time. Imported lazily so the pure
  // parser (parseFields) stays testable without the Tesseract worker in scope.
  const { getTessWorker } = await import("./tessworker");
  const worker = await getTessWorker(lang);
  try {
    onProgress?.(0);
    // Read the RAW image AND a glare/contrast-preprocessed copy, then combine both OCR passes — a field
    // that garbles in one pass is often clean in the other, and parseFields (first-good-match-wins)
    // picks the best of both. This beats relying on either pass alone.
    const rawText = (await worker.recognize(file)).data.text ?? "";
    onProgress?.(40);
    let procText = "";
    let canvas: Awaited<ReturnType<typeof fileToProcessedCanvas>> | null = null;
    try {
      canvas = await fileToProcessedCanvas(file);
      procText = (await worker.recognize(canvas as Parameters<typeof worker.recognize>[0])).data.text ?? "";
    } catch { /* canvas unavailable — raw pass alone */ }
    onProgress?.(70);
    // THIRD PASS — sparse-text segmentation (PSM 11). The default "auto" layout analysis (PSM 3)
    // mis-groups the widely-spaced label lines on a driver's licence and mangles them (e.g. the
    // surname line "1 MYSORE" OCRs to garbage). PSM 11 treats the card as scattered text and reads
    // those isolated labels cleanly. We merge it in so parseFields (first-good-match-wins) can pick
    // the surname up. Restored to the default mode afterward so cached-worker reuse is unaffected.
    let sparseText = "";
    try {
      await worker.setParameters({ tessedit_pageseg_mode: "11" as never });
      sparseText = (await worker.recognize(file)).data.text ?? "";
      if (canvas) {
        const s2 = (await worker.recognize(canvas as Parameters<typeof worker.recognize>[0])).data.text ?? "";
        sparseText = s2 ? `${sparseText}\n${s2}` : sparseText;
      }
    } catch { /* sparse pass unavailable — the two default-mode passes still stand */
    } finally {
      try { await worker.setParameters({ tessedit_pageseg_mode: "3" as never }); } catch { /* leave as-is */ }
    }
    onProgress?.(100);
    const text = [rawText, procText, sparseText].filter(Boolean).join("\n");
    return { text, fields: parseFields(text) };
  } finally {
    /* worker is cached and reused — do not terminate */
  }
}
