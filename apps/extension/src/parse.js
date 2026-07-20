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

  for (const raw of (text || "").split(/\r?\n/)) {
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
  const phone = (text || "").match(/(?:\+?\d[\d\s\-()]{7,}\d)/);
  if (phone) put("cell_phone", (phone[0] ?? "").replace(/\s+/g, " ").trim());

  return Object.entries(out).map(([ontology_key, value]) => ({ ontology_key, value }));
}
