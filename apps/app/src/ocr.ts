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
// writes (apps/extension/src/capture.js docImageKey) — one shared vault, one source of truth.
export function documentImageKey(
  fields: ReadonlyArray<ExtractedField>,
  isBarcodeBack: boolean,
): { key: string; label: string } {
  const keys = new Set(fields.map((f) => f.ontology_key));
  if (isBarcodeBack) return { key: "driver_license_back", label: "Driver’s licence — back (barcode)" };
  if (keys.has("passport_no")) return { key: "passport_image", label: "Passport" };
  if (keys.has("license_no")) return { key: "driver_license_front", label: "Driver’s licence — front" };
  return { key: "document_image", label: "ID document" };
}


// Label -> canonical vault key. Keys match the seeded vault ontology so an image can
// CREATE or UPDATE the user's existing fields (name parts, address, contact, etc.).
const LABELS: ReadonlyArray<readonly [readonly string[], string]> = [
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
    const phone = text.match(/(?:\+?\d[\d\s\-()]{7,}\d)/);
    if (phone) put("cell_phone", (phone[0] ?? "").replace(/\s+/g, " ").trim());
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
