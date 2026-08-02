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
    const sur = (p[0] || "").replace(/</g, " ").trim();
    if (sur) out.last_name = sur;
    const g = (p[1] || "").replace(/</g, " ").trim().split(/\s+/).filter((w) => w.length > 1);
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
  // TD1 — ID card (3×30): name on line 3, numbers on lines 1–2.
  const t1 = lines.filter((l) => l.length >= 28 && l.length <= 32);
  if (t1.length >= 3) {
    const nameLine = t1.find((l) => l.includes("<<") && !/\d/.test(l)) || t1[2] || "";
    const l1 = t1.find((l) => /^[A-Z<]{2}[A-Z]{3}\d/.test(l)) || t1[0];
    const l2 = t1.find((l) => /^\d{6}\d[MF<]/.test(l));
    setName(nameLine);
    if (l1) out.id_no = l1.slice(5, 14).replace(/</g, "");
    if (l2) { setDob(l2.slice(0, 6)); setSex(l2[7] ?? ""); setExp(l2.slice(8, 14)); setNat(l2.slice(15, 18)); }
    return fin();
  }
  // TD2 — 2×36: name on line 1, numbers on line 2.
  const t2 = lines.filter((l) => l.length >= 34 && l.length <= 38);
  if (t2.length >= 2) {
    const l1 = t2.find((l) => l.includes("<<") && !/\d/.test(l)) || t2[0] || "";
    const l2 = t2.find((l) => l !== l1 && /^[A-Z0-9<]{9}\d[A-Z<]{3}\d{6}/.test(l)) || t2[1] || "";
    setName(l1.slice(5));
    if (l2) { out.id_no = l2.slice(0, 9).replace(/</g, ""); setNat(l2.slice(10, 13)); setDob(l2.slice(13, 19)); setSex(l2[20] ?? ""); setExp(l2.slice(21, 27)); }
    return fin();
  }
  return [];
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

  // Label-free formats anywhere in the document — but never overwrite a labelled value, and
  // don't mistake a licence/ID number for a phone number (that was the classic misread).
  const email = text.match(/\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/);
  if (email) put("email_address", email[0] ?? "");
  if (!out["cell_phone"] && !out["license_no"] && !out["id_no"] && !out["passport_no"]) {
    const numMatch = text.match(/(?:\+?\d[\d\s\-()]{7,}\d)/);
    if (numMatch) {
      const raw = (numMatch[0] ?? "").replace(/\s+/g, " ").trim();
      const digits = raw.replace(/\D/g, "");
      // On an ID document a bare number is the DOCUMENT number, not a phone — and phone numbers never
      // begin with several zeros. Route it to the right ID field instead of mislabelling a licence or
      // passport number as "cell_phone" (the exact misread this guard is meant to prevent: a licence
      // number like 000026610696 was landing in cell_phone).
      const idContext = DL_MARKERS.test(text) || PASSPORT_MARKERS.test(text);
      const looksLikeIdNumber = /^0{2,}/.test(digits);
      if (idContext || looksLikeIdNumber) {
        if (PASSPORT_MARKERS.test(text)) put("passport_no", raw);
        else if (DL_MARKERS.test(text)) put("license_no", raw);
        else put("id_no", raw);
      } else {
        put("cell_phone", raw);
      }
    }
  }

  return Object.entries(out).map(([ontology_key, value]) => ({ ontology_key, value }));
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
    const { data } = await worker.recognize(file);
    onProgress?.(100);
    const text = data.text ?? "";
    return { text, fields: parseFields(text) };
  } finally {
    /* worker is cached and reused — do not terminate */
  }
}
