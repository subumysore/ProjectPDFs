// Shared on-device semantic resolver — the same intelligence the page-fill uses, but
// as a reusable module so PDF form fields (by field name) resolve identically:
// meaning-matching (given/middle/family/email/…), value derivation (compose a full
// name, take an initial), and context-aware composites (a lone Address absorbs the
// parts no finer field claims). No rules per form.

export function resolveFields(vault, fields) {
  const norm = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
    salutation: ["salutation", "title", "prefix", "honorific"],
    dob:      ["date of birth", "dob", "birth date", "birthday", "born"],
    passport: ["passport", "passport no", "passport number"],
    organization: ["company", "company name", "organization", "organisation", "employer", "business name", "firm"],
    username: ["username", "user name", "login", "user id", "userid", "handle"],
    // "Someone else" name fields — must NOT be filled with the user's own name.
    other_person: ["dependent", "nominee", "guardian", "spouse", "beneficiary", "next of kin", "emergency contact", "father", "mother", "witness"],
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
  const atomVal = (key) => {
    if (key === "given")  return atoms.given ?? (atoms.full || "").split(/\s+/)[0];
    if (key === "family") return atoms.family ?? ((atoms.full || "").split(/\s+/).slice(-1)[0]);
    if (key === "nationality") return atoms.nationality ?? atoms.country;
    if (key === "cellphone") return withCC(atoms.cellphone);
    if (key === "homephone") return withCC(atoms.homephone);
    if (key === "phone")     return withCC(atoms.cellphone ?? atoms.phone ?? atoms.homephone);
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
