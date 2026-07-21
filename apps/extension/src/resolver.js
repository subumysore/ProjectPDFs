// Shared on-device semantic resolver — the same intelligence the page-fill uses, but
// as a reusable module so PDF form fields (by field name) resolve identically:
// meaning-matching (given/middle/family/email/…), value derivation (compose a full
// name, take an initial), and context-aware composites (a lone Address absorbs the
// parts no finer field claims). No rules per form.

// A ready-to-place bundle of the user's own identity values, each derived through
// the same semantic resolver (so vault-key naming stays irrelevant) plus the small
// compositions that fixed government-form templates need (name+initial, one-line
// city/state/ZIP, split SSN parts). Used by AcroForm field-name templates.
export function resolveBundle(vault) {
  const ask = (label, maxLength = -1) => resolveFields(vault, [{ label, maxLength }])[0] || "";
  const first = ask("first name");
  const mi = ask("middle initial", 1);
  const middle = ask("middle name");
  const last = ask("last name");
  const full = ask("full name") || [first, middle, last].filter(Boolean).join(" ");
  const city = ask("city");
  const state = ask("state");
  const zip = ask("zip");
  const ssnRaw = ask("social security number");
  const ssnDigits = ssnRaw.replace(/[^0-9]/g, "");
  return {
    firstName: first,
    firstMiddle: [first, mi].filter(Boolean).join(" "),
    lastName: last,
    fullName: full,
    street: ask("street address"),
    city, state, zip,
    cityStateZip: [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    email: ask("email"),
    ssn: ssnRaw,
    ssn1: ssnDigits.slice(0, 3),
    ssn2: ssnDigits.slice(3, 5),
    ssn3: ssnDigits.slice(5, 9),
  };
}

export function resolveFields(vault, fields) {
  // Normalise a label/field-name to space-separated lowercase WORDS. Split camelCase
  // ("dateOfBirth" -> "date of birth") and letter/digit boundaries BEFORE lowercasing, so
  // programmatic field names and abbreviations ("D.O.B." -> "d o b") match their aliases.
  const norm = (s) => (s || "").toString()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const initial = (s) => { const m = (s || "").trim().match(/\p{L}/u); return m ? m[0].toUpperCase() : ""; };

  const ALIASES = {
    given:    ["given name", "given", "first name", "first", "forename", "fname", "christian name"],
    middle:   ["middle name", "middle", "mname", "middle names", "middle initial", "mi", "m i"],
    family:   ["family name", "last name", "last", "surname", "lname", "family"],
    full:     ["full name", "name", "complete name", "legal name", "applicant name", "your name"],
    street1:  ["address line 1", "address 1", "address1", "street address", "street address 1", "addr1", "address line one", "house number", "house no", "flat no"],
    street2:  ["address line 2", "address 2", "address2", "addr2", "apartment", "apt", "suite", "unit", "address line two", "landmark"],
    city:     ["city", "town", "city town", "village"],
    state:    ["state", "province", "region", "state province"],
    zip:      ["zip", "zip code", "postal code", "pincode", "pin code", "postcode", "post code"],
    country:  ["country", "nation"],
    nationality: ["nationality", "citizenship"],
    email:    ["email", "e mail", "mail", "email address"],
    phonecc:  ["phone country code", "country code", "dialing code", "dial code", "isd code", "std code"],
    cellphone: ["cell phone", "cell", "mobile", "mobile number", "mobile phone", "cell number", "cellphone"],
    homephone: ["home phone", "landline", "home number", "residence phone", "home telephone"],
    phone:    ["phone", "telephone", "tel", "contact number", "phone number", "phone no", "contact no"],
    gender:   ["gender", "sex"],
    marital:  ["marital status", "marital", "civil status", "relationship status", "marital state", "marital condition"],
    salutation: ["salutation", "title", "prefix", "honorific"],
    dob:      ["date of birth", "dob", "d o b", "birth date", "birthday", "born", "birthdate"],
    passport: ["passport", "passport no", "passport number"],
    // Document-qualified dates (a DL, passport, and other IDs each have their OWN expiry).
    passport_expiry: ["passport expiry date", "passport expiry", "passport expiration date", "passport expiration", "date of expiry", "expiry date", "expiration date", "expires", "valid until", "date of expiration"],
    passport_issue:  ["passport issue date", "passport issuance date", "passport issuance", "date of issue", "issue date", "issuance date", "date of issuance", "issued on", "valid from", "passport valid from"],
    dl_expiry:       ["dl expiry date", "driver license expiry date", "drivers license expiry date", "driving licence expiry date", "license expiry date", "licence expiry date", "license expiry", "licence expiry", "dl expiry", "dl exp", "license expiration date", "driver license expiration", "licence expiration"],
    dl_issue:        ["dl issue date", "driver license issue date", "drivers license issue date", "driving licence issue date", "license issue date", "licence issue date", "license issue", "licence issue", "dl issue", "licence valid from", "license valid from"],
    photo:    ["photo", "photograph", "picture", "image", "passport photo", "profile photo", "profile picture", "profile pic", "profile image", "user photo", "user picture", "applicant photo", "applicant picture", "your photo", "your picture", "headshot", "photo id", "avatar", "portrait"],
    signature: ["signature", "sign", "sign here", "signed", "autograph", "applicant signature"],
    // Document IMAGES to attach into a form (values are data:image URIs). Vault keys
    // drivers_license_image / passport_image map here; form labels asking to ATTACH a
    // copy resolve to the stored image (drawn into the field). Bare "passport" stays the
    // passport NUMBER, so passport_copy uses only copy/scan/attach phrasings.
    // FRONT (photo side) — also the target for a generic "attach a copy of your licence".
    drivers_license: ["driver license front", "drivers license front", "dl front", "front of driver license", "front of drivers license",
      "drivers license image", "driver license image", "dl image", "drivers license copy", "driver license copy", "copy of driver license", "copy of drivers license", "attach driver license", "attach drivers license", "driving license", "driver license", "drivers license", "license copy", "dl copy",
      "driving licence", "driver licence", "drivers licence", "driving licence copy", "copy of driving licence", "licence copy"],
    // BACK (barcode side) — for a form that specifically asks for the back/reverse.
    drivers_license_back: ["driver license back", "drivers license back", "dl back", "back of driver license", "back of drivers license", "driver license reverse", "licence back", "reverse of driver license"],
    passport_copy: ["passport image", "passport copy", "copy of passport", "attach passport", "passport scan", "passport photo page"],
    ssn:      ["ssn", "social security number", "social security no", "ss number", "social security", "sin", "social insurance number"],
    taxid:    ["tax id", "taxpayer id", "taxpayer identification number", "taxpayer identification", "tin", "itin"],
    organization: ["company", "company name", "organization", "organisation", "employer", "business name", "firm"],
    username: ["username", "user name", "login", "user id", "userid", "handle"],
    // A DIFFERENT person's name (dependent/nominee/etc.) — filled from the user's own
    // dependent-name key if they have one, and skipped (never the user's name) if not.
    dependent_name: ["name of dependent", "dependent name", "dependant name", "nominee name", "nominee", "guardian name", "beneficiary name", "next of kin", "spouse name", "emergency contact name",
      "dependent 1", "dependent1", "dependant 1", "dependent 2", "dependent2", "first dependent", "second dependent", "child name", "child 1", "child 1 name"],
    dependent_dob: ["dependent dob", "dependant dob", "dependent date of birth", "dependant date of birth",
      "dependent 1 dob", "dependent1 dob", "dependant 1 dob", "dependent 2 dob", "dependent 1 date of birth"],
    // Derived from a date of birth (age isn't stored — it's computed from the DOB).
    age:           ["age", "your age", "current age", "age in years", "age yrs"],
    dependent_age: ["age of dependent", "age of dependant", "dependent age", "dependant age", "child age", "age of child"],
  };
  const rawVault = {};
  for (const [k, v] of Object.entries(vault)) rawVault[norm(k)] = v;
  const atoms = {};
  for (const [canon, al] of Object.entries(ALIASES)) {
    for (const key of Object.keys(rawVault)) {
      if (al.some((a) => key === norm(a))) { atoms[canon] = rawVault[key]; break; }
    }
  }
  const withCC = (num) => {
    const n = (num || "").toString().trim();
    if (!n) return "";
    const cc = (atoms.phonecc || "").toString().trim();
    return cc && !n.startsWith("+") ? cc + " " + n : n;
  };
  // Age isn't stored — DERIVE it from a date of birth (full years to today).
  const ageFrom = (dob) => {
    const m = String(dob || "").match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
    if (!m) return null;
    let y = parseInt(m[3], 10);
    if (y < 100) y += y > 30 ? 1900 : 2000;
    const birth = new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10)); // assume MM/DD/YYYY
    if (isNaN(birth.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
    return age >= 0 && age < 150 ? String(age) : null;
  };
  const atomVal = (key) => {
    if (key === "given")  return atoms.given ?? (atoms.full || "").split(/\s+/)[0];
    if (key === "family") return atoms.family ?? ((atoms.full || "").split(/\s+/).slice(-1)[0]);
    if (key === "nationality") return atoms.nationality ?? atoms.country;
    if (key === "cellphone") return withCC(atoms.cellphone);
    if (key === "homephone") return withCC(atoms.homephone);
    if (key === "phone")     return withCC(atoms.cellphone ?? atoms.phone ?? atoms.homephone);
    if (key === "age")           return atoms.age ?? ageFrom(atoms.dob);
    if (key === "dependent_age") return atoms.dependent_age ?? ageFrom(atoms.dependent_dob);
    return atoms[key];
  };

  const COMPOSITES = {
    full:    { syn: ALIASES.full, members: ["given", "middle", "family"], sep: " ", name: true, fallback: () => atoms.full },
    address: { syn: ["address", "mailing address", "residential address", "postal address", "full address", "permanent address", "current address"], members: ["street1", "street2", "city", "state", "zip", "country"], sep: ", " },
  };

  const CONCEPTS = [];
  for (const [k, syn] of Object.entries(ALIASES)) {
    if (k === "full") continue;
    CONCEPTS.push({ key: k, syn, kind: "atom", name: ["given", "middle", "family"].includes(k) });
  }
  for (const [k, c] of Object.entries(COMPOSITES)) CONCEPTS.push({ key: k, syn: c.syn, kind: "composite", cmp: c, name: !!c.name });

  const score = (label, syn) => {
    const lt = new Set(norm(label).split(" ").filter(Boolean));
    let best = 0;
    for (const phrase of syn) {
      const pt = norm(phrase).split(" ").filter(Boolean);
      if (!pt.length) continue;
      let hit = 0;
      for (const t of pt) if (lt.has(t)) hit++;
      const s = hit * (hit / pt.length) * (hit === pt.length ? 1.6 : 1);
      if (s > best) best = s;
    }
    return best;
  };
  const wantsInitial = (label, maxLength) => /\binitial\b|\binit\b/.test(norm(label)) || maxLength === 1;

  // Pass 1: pick a concept per field.
  const picks = fields.map((f) => {
    let pick = null, top = 0;
    for (const c of CONCEPTS) { const s = score(f.label, c.syn); if (s > top) { top = s; pick = c; } }
    return top >= 1.5 ? pick : null;
  });
  const claimed = new Set(picks.filter((p) => p && p.kind === "atom").map((p) => p.key));

  // Pass 2: compute the value for each field.
  return fields.map((f, i) => {
    const pick = picks[i];
    if (!pick) return null;
    let value;
    if (pick.kind === "composite") {
      const parts = pick.cmp.members.filter((m) => !claimed.has(m)).map(atomVal).filter(Boolean);
      value = parts.length ? parts.join(pick.cmp.sep) : (pick.cmp.fallback ? pick.cmp.fallback() : "");
    } else {
      value = atomVal(pick.key);
    }
    if (!value) return null;
    if (pick.name && wantsInitial(f.label, f.maxLength)) value = initial(value);
    return value;
  });
}
