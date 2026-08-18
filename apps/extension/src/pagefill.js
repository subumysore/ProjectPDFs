// The page-fill function INJECTED into the target tab via chrome.scripting.executeScript.
// It must be fully SELF-CONTAINED (no imports/outer refs) because executeScript serializes
// its source. Kept in its own module so it can be unit-tested under jsdom (see pagefill.test.mjs).
export async function fillPage(vault, tLabels, eduEntries, opts) {
  const OPTS = opts || {};
  const norm = (s) => (s || "").toString()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Za-z])([0-9])/g, "$1 $2") // split camelCase / letter-digit
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Collect matching elements across the main DOM AND every OPEN shadow root — modern ATS forms (ADP,
  // some Workday/iCIMS) render fields inside web-component shadow trees that a plain
  // document.querySelectorAll cannot see. (Closed shadow roots stay unreachable — a browser limit.)
  const deepQSA = (sel, root) => {
    const out = [], seen = new Set();
    const visit = (node) => {
      let m = []; try { m = node.querySelectorAll ? [...node.querySelectorAll(sel)] : []; } catch (_) { m = []; }
      for (const el of m) if (!seen.has(el)) { seen.add(el); out.push(el); }
      let all = []; try { all = node.querySelectorAll ? node.querySelectorAll("*") : []; } catch (_) { all = []; }
      for (const el of all) if (el.shadowRoot) visit(el.shadowRoot);
    };
    visit(root || document);
    return out;
  };
  // US state full-name <-> 2-letter abbreviation, so a stored "NC" matches a "North Carolina" option and
  // a stored "North Carolina" matches an "NC" option — the same field, filled either way the form wants.
  const US_STATE_ABBR = { al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut", de: "Delaware", fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa", ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota", ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire", nj: "New Jersey", nm: "New Mexico", ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah", vt: "Vermont", va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming", dc: "District of Columbia" };
  // Extra candidate strings for matching a chooser option to a stored value: gender M<->Male,
  // country USA<->United States, US state name<->abbrev, phone country code. Centralised so the
  // <select>, custom-dropdown and radio matchers all behave identically.
  const expandCands = (pick, value) => {
    const cands = [value];
    const g = norm(value);
    const key = pick && pick.key;
    if (key === "gender") { if (g === "m" || g === "male") cands.push("male"); if (g === "f" || g === "female") cands.push("female"); }
    const SEL_COUNTRY = { usa: ["United States", "United States of America", "America"], us: ["United States"], american: ["United States"], uk: ["United Kingdom", "Great Britain"], british: ["United Kingdom"], england: ["United Kingdom"], uae: ["United Arab Emirates"], india: ["India"], indian: ["India"], rok: ["South Korea"], prc: ["China"], drc: ["Democratic Republic of the Congo"] };
    if (SEL_COUNTRY[g]) cands.push(...SEL_COUNTRY[g]);
    if (key === "state" || key === "billing_state" || key === "region") {
      if (US_STATE_ABBR[g]) cands.push(US_STATE_ABBR[g]);                                  // "nc" -> "North Carolina"
      const abbr = Object.keys(US_STATE_ABBR).find((k) => norm(US_STATE_ABBR[k]) === g);   // "north carolina" -> "NC"
      if (abbr) cands.push(abbr.toUpperCase());
    }
    if (key === "phonecc") { const d = String(value).replace(/\D/g, ""); if (d) cands.push(d, "+" + d); }
    return cands;
  };
  // ISO-3166 alpha-2 / alpha-3 for the countries a stored full name is likely to be. Only the short
  // codes a form would ever ask for in a 2-3 char box; anything unknown simply yields no abbreviation
  // and the field is left blank (the old behaviour), never a guess.
  const COUNTRY_ABBR = {
    "united states": ["US", "USA"], "united states of america": ["US", "USA"], "america": ["US", "USA"],
    "united kingdom": ["GB", "UK", "GBR"], "great britain": ["GB", "UK", "GBR"], "england": ["GB", "UK"],
    "india": ["IN", "IND"], "canada": ["CA", "CAN"], "australia": ["AU", "AUS"], "new zealand": ["NZ", "NZL"],
    "germany": ["DE", "DEU"], "france": ["FR", "FRA"], "spain": ["ES", "ESP"], "italy": ["IT", "ITA"],
    "netherlands": ["NL", "NLD"], "ireland": ["IE", "IRL"], "south africa": ["ZA", "ZAF"],
    "singapore": ["SG", "SGP"], "united arab emirates": ["AE", "ARE"], "saudi arabia": ["SA", "SAU"],
    "japan": ["JP", "JPN"], "china": ["CN", "CHN"], "south korea": ["KR", "KOR"], "brazil": ["BR", "BRA"],
    "mexico": ["MX", "MEX"], "nigeria": ["NG", "NGA"], "kenya": ["KE", "KEN"], "pakistan": ["PK", "PAK"],
    "bangladesh": ["BD", "BGD"], "sri lanka": ["LK", "LKA"], "nepal": ["NP", "NPL"], "philippines": ["PH", "PHL"],
    "switzerland": ["CH", "CHE"], "sweden": ["SE", "SWE"], "norway": ["NO", "NOR"], "denmark": ["DK", "DNK"],
    "poland": ["PL", "POL"], "portugal": ["PT", "PRT"], "hong kong": ["HK", "HKG"], "malaysia": ["MY", "MYS"],
  };
  // The short form of a state/country value that FITS a maxlength-limited box, or null when there is
  // none we are sure of. Used only to rescue a fill that would otherwise be skipped.
  const abbreviateFor = (key, label, value, maxL) => {
    const n = norm(value);
    const fits = (s) => s && s.length <= maxL ? s : null;
    // The concept may arrive as a matched key OR, when the value came straight from a vault key of the
    // same name ("state"), as nothing at all — in which case the field's own caption tells us.
    const cap = norm(label);
    if (!key && /\b(state|province|region)\b/.test(cap)) key = "state";
    if (!key && /\b(country|nationality)\b/.test(cap)) key = "country";
    if (key === "state" || key === "billing_state" || key === "region") {
      const abbr = Object.keys(US_STATE_ABBR).find((k) => norm(US_STATE_ABBR[k]) === n);
      return abbr ? fits(abbr.toUpperCase()) : null;
    }
    if (key === "country" || key === "nationality" || key === "billing_country") {
      // Longest code that still fits: a 3-char box wants the alpha-3 ("USA"), a 2-char box alpha-2 ("US").
      const cands = [...(COUNTRY_ABBR[n] || [])].sort((a, b) => b.length - a.length);
      for (const cand of cands) { const f = fits(cand); if (f) return f; }
      return null;
    }
    return null;
  };

  // EDUCATION (from parseEducation, passed in): map a form's Degree/Field/School/Year/GPA fields to
  // the right stored qualification (Master's block gets the masters entry, etc.). eduEntries are
  // pre-parsed in the popup (highest level first); here we only ROUTE them onto the live form.
  const EDU_FIELD_SYNS = {
    degree: ["degree", "qualification", "level of education", "education level", "degree type", "degree obtained", "highest qualification", "highest degree", "course"],
    field:  ["field of study", "major", "specialization", "specialisation", "branch", "stream", "discipline", "subject", "area of study", "concentration"],
    school: ["university", "institution", "college", "school name", "name of institution", "name of university", "name of college", "institution name", "university name", "alma mater", "school college university"],
    year:   ["year of passing", "graduation year", "year of graduation", "year of completion", "passing year", "year completed", "completion year", "year of award", "end year", "to year"],
    gpa:    ["gpa", "cgpa", "grade", "grade point average", "percentage", "marks", "score", "result", "class obtained"],
  };
  const edu = Array.isArray(eduEntries) ? eduEntries : [];
  // The education LEVEL implied by a section heading, using plain phrasing (a lighter version of
  // education.js levelOf — enough to route a field to the master's vs bachelor's block).
  const eduLevelOf = (t) => {
    const n = norm(t);
    if (/\b(phd|doctor|doctoral|dphil)\b/.test(n)) return "doctorate";
    if (/\b(master|masters|post graduate|postgraduate|pg|ms|msc|mtech|mba|ma|mphil)\b/.test(n)) return "master";
    if (/\b(bachelor|bachelors|under graduate|undergraduate|ug|graduation|bs|bsc|btech|ba|be|bcom|degree)\b/.test(n)) return "bachelor";
    if (/\b(diploma|associate)\b/.test(n)) return "diploma";
    if (/\b(high school|highschool|secondary|12th|hsc|intermediate)\b/.test(n)) return "highschool";
    return null;
  };
  // The section heading text around a field (climb ancestors for a legend/heading) — the routing hint.
  const sectionContext = (el) => {
    let txt = "";
    let node = el;
    for (let i = 0; i < 6 && node; i++) {
      node = node.parentElement; if (!node) break;
      const head = node.querySelector("legend, h1, h2, h3, h4, h5, h6, [class*='heading'], [class*='title'], [class*='legend']");
      if (head && head.textContent) txt = head.textContent.trim() + " " + txt;
      if (eduLevelOf(txt)) break;
    }
    return txt;
  };
  // The block index of a REPEATED education section: the trailing integer on the field's own id/name
  // (UltiPro `NewEducation_DegreeId0`/`1`, Workday `--education-1`), which lets us route indistinguishable
  // blocks by ORDER when there is no per-block level heading to match on.
  const eduBlockIndex = (el) => {
    const m = ((el.id || "") + " " + (el.name || "")).match(/(\d+)\D*$/);
    return m ? +m[1] : null;
  };
  const eduEntryFor = (el, contextText) => {
    if (!edu.length) return null;
    const lvl = eduLevelOf(contextText);                 // a real SECTION heading wins (Master's block → masters)
    if (lvl) { const e = edu.find((x) => x.level === lvl); if (e) return e; }
    const idx = eduBlockIndex(el);                        // else route repeated blocks by their order
    if (idx != null && idx < edu.length) return edu[idx];
    return edu[0];                                        // single/unknown block → highest by default
  };
  // The education value for a field (input OR dropdown): match its label to Degree/Field/School/
  // Year/GPA, then read that member from the block the field's section points at. null if not an
  // education field. (`score` is defined later but only READ at call time.)
  // Level routing reads the SECTION heading only — NOT the field's own label: the generic label word
  // "degree" (e.g. UltiPro "Level of Education / Degree") is not evidence of a *bachelor's*, and reading
  // it as one collapsed every block onto the bachelor entry ("Bachelors" filled twice).
  const eduValueFor = (el, label) => {
    if (!edu.length) return null;
    if (historyEntryIndex(el) != null) return null; // a WORK-experience field, not education — never route edu here
    let kind = null, t = 0;
    for (const [k, syn] of Object.entries(EDU_FIELD_SYNS)) { const s = score(label, syn); if (s > t) { t = s; kind = k; } }
    if (!kind || t < 1.5) return null;
    const entry = eduEntryFor(el, sectionContext(el));
    return (entry && entry[kind]) || null;
  };
  const initial = (s) => { const m = (s || "").trim().match(/\p{L}/u); return m ? m[0].toUpperCase() : ""; };

  // A field inside a REPEATED work-experience / employment-history ENTRY, and WHICH entry (0-based).
  // We hold ONE current role, so entries past the first are earlier jobs we have no data for — filling
  // them all with the same value (every "Job Title" → "Engineer", every employer the same) is wrong.
  // Returns the entry index for such a field (fill only entry 0), or null if it isn't one.
  const HISTORY_RE = /work experience|employment history|work history|employment|prior employment|previous employment/;
  const historyEntryIndex = (el) => {
    const idName = (el.id || "") + " " + (el.name || "");
    let inHistory = HISTORY_RE.test(norm(idName));
    if (!inHistory && el.closest) {
      inHistory = !!el.closest("[data-automation*='work-experience'], [class*='work-experience'], [class*='workExperience'], [id*='WorkExperience'], [id*='Employment']");
    }
    if (!inHistory) return null;
    const m = idName.match(/(\d+)\D*$/);
    return m ? +m[1] : 0;
  };

  // 1) Canonical "atoms" <- the many ways a user might have named a key.
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
    // Payment CARD + its BILLING address (from a saved card record) — mirrors resolver.js so web
    // payment forms fill too. Billing is kept separate from the mailing address.
    cardname:  ["card name", "name on card", "name on the card", "cardholder name", "card holder name", "cardholder", "card holder", "name as on card", "name as it appears on card"],
    cardnumber:["card number", "credit card number", "debit card number", "card no", "cc number", "card num", "pan", "primary account number", "credit card no", "debit card no"],
    cardexp:   ["card expiry", "card expiration", "card expiration date", "card expiry date", "valid thru", "valid through", "exp date", "mm yy", "expiry mm yy", "expiration mm yy"],
    cardcvv:   ["card cvv", "cvv", "cvc", "csc", "cvv2", "cid", "security code", "card security code", "card verification value", "card verification code"],
    cardtype:  ["card type", "type of card", "credit or debit"],
    billing_street1: ["billing address", "billing address 1", "billing address line 1", "billing street", "billing street address", "billing addr", "billing address one"],
    billing_street2: ["billing address 2", "billing address line 2", "billing apartment", "billing suite", "billing unit"],
    billing_city:  ["billing city", "billing town"],
    billing_state: ["billing state", "billing province", "billing region"],
    billing_zip:   ["billing zip", "billing zip code", "billing postal code", "billing postcode", "billing pin code"],
    country:  ["country", "nation"],
    nationality: ["nationality", "citizenship"],
    email:    ["email", "e mail", "mail", "email address"],
    // Fax is its OWN concept so a neighbouring "Email Address" or "Phone" label can never claim it
    // (label text bleeds between adjacent fields on dense forms). With no stored fax, it stays blank.
    fax:      ["fax", "fax number", "fax no", "facsimile"],
    // A phone EXTENSION is not a phone number. "Phone Extension" contains "phone", so the phone concept
    // claimed it and stamped the whole number into a 4-digit extension box (seen on a live Workday
    // application). It fills only from a stored extension, and stays blank when there is none.
    phone_ext: ["phone extension", "telephone extension", "phone ext", "extension", "ext", "ext no"],
    // Professional links — kept in step with resolver.js (the parity test enforces it).
    linkedin: ["linkedin", "linked in", "linkedin profile", "linkedin url", "linked in url", "linked in profile", "linkedin profile url", "linkedin link", "li profile"],
    website:  ["website", "personal website", "portfolio", "portfolio url", "portfolio link", "personal site", "web site", "blog url"],
    github:   ["github", "github profile", "github url", "git hub"],
    phonecc:  ["phone country code", "country code", "dialing code", "dial code", "isd code", "std code"],
    cellphone: ["cell phone", "cell", "mobile", "mobile number", "mobile phone", "cell number", "cellphone"],
    homephone: ["home phone", "landline", "home number", "residence phone", "home telephone"],
    phone:    ["phone", "telephone", "tel", "contact number", "phone number", "phone no", "contact no"],
    gender:   ["gender", "sex"],
    marital:  ["marital status", "marital", "civil status", "relationship status", "marital state", "marital condition"],
    salutation: ["salutation", "title", "prefix", "honorific"],
    suffix:   ["suffix", "name suffix", "generational suffix", "suffix jr sr", "post nominal", "post nominal letters"],
    language: ["language", "preferred language", "primary language", "native language", "language preference", "spoken language", "correspondence language"],
    dob:      ["date of birth", "dob", "d o b", "birth date", "birthday", "born", "birthdate"],
    appdate:  ["date of application", "application date", "today's date", "todays date", "current date", "date of submission", "submission date", "date signed", "signature date", "date of signature", "date of filling", "date filled", "dated", "date of declaration"],
    passport: ["passport", "passport no", "passport number"],
    passport_expiry: ["passport expiry date", "passport expiry", "passport expiration date", "passport expiration", "date of expiry", "expiry date", "expiration date", "expires", "valid until", "date of expiration", "expiry date of passport"],
    passport_issue:  ["passport issue date", "passport issuance date", "passport issuance", "date of issue", "issue date", "issuance date", "date of issuance", "issued on", "valid from", "passport valid from"],
    dl_expiry:       ["dl expiry date", "driver license expiry date", "drivers license expiry date", "driving licence expiry date", "license expiry date", "licence expiry date", "license expiry", "licence expiry", "dl expiry", "dl exp", "license expiration date", "driver license expiration", "licence expiration"],
    dl_issue:        ["dl issue date", "driver license issue date", "drivers license issue date", "driving licence issue date", "license issue date", "licence issue date", "license issue", "licence issue", "dl issue", "licence valid from", "license valid from"],
    organization: ["company", "company name", "organization", "organisation", "employer", "business name", "firm",
      "current company", "current employer", "current organization", "current organisation", "present employer",
      "present company", "employer name", "company you work for", "most recent employer", "most recent company"],
    username: ["username", "user name", "login", "user id", "userid", "handle"],
    password: ["password", "confirm password", "create password", "new password", "choose password", "re enter password", "reenter password", "re type password", "retype password", "repeat password", "verify password", "passphrase", "pwd"],
    dependent_name: ["name of dependent", "dependent name", "dependant name", "nominee name", "nominee", "guardian name", "beneficiary name", "next of kin", "spouse name", "emergency contact name"],
    dependent_dob: ["dependent dob", "dependant dob", "dependent date of birth", "dependant date of birth"],
    // Concepts below were present in resolver.js (PDF fill) but MISSING here, so they filled in
    // PDFs and silently did nothing on web forms (found 2026-07-23 by end-to-end testing).
    // resolver.test.mjs asserts the two alias sets stay in step from now on.
    occupation: ["occupation", "profession", "current profession", "current occupation", "job title", "designation", "position held", "profession or occupation", "occupation and position"],
    birthplace: ["place of birth", "birth place", "birthplace", "city of birth", "town of birth", "country of birth", "place of birth city"],
    passport_type: ["passport type", "type of passport", "document type", "type of document"],
    ssn: ["social security number", "ssn", "social security no", "social security"],
    taxid: ["tax id", "taxpayer id", "tin", "itin", "ein", "tax identification number", "pan", "pan number"],
    age: ["age", "your age", "current age", "age in years", "age yrs"],
    dependent_age: ["age of dependent", "age of dependant", "dependent age", "dependant age", "child age", "age of child"],
    // EEO / voluntary self-identification — parity with resolver.js (vault keys race / ethnicity /
    // hispanic_latino / veteran_status / disability_status).
    race: ["race", "racial category", "race category", "your race", "race identity"],
    ethnicity: ["ethnicity", "ethnic group", "ethnic origin", "ethnicity race", "race ethnicity"],
    hispanic: ["hispanic latino", "hispanic or latino", "are you hispanic or latino", "hispanic", "latino", "latina", "latinx", "hispanic ethnicity", "hispanic or latino ethnicity"],
    veteran: ["veteran status", "protected veteran", "protected veteran status", "military veteran", "are you a veteran", "veteran", "us veteran", "disabled veteran", "vevraa", "vietnam era veteran"],
    disability: ["disability status", "disability", "do you have a disability", "self identification of disability", "voluntary self identification of disability", "disabled", "section 503", "person with a disability"],
  };
  const rawVault = {};
  for (const [k, v] of Object.entries(vault)) rawVault[norm(k)] = v;

  // The user's OWN keys, keyed the Unicode-aware way capture keys them (`vaultkey.js`
  // keyFromLabel — inlined because this function is injected into the page and cannot import;
  // `engine-parity.test.mjs` guards the pair). `norm()` above is ASCII-only, so every non-Latin
  // key collapsed to "" and they all overwrote each other; and matching only went through the
  // English concept table, so a key the user captured never filled anything — not even a field
  // whose label IS that key. Their own key for exactly this label is the strongest signal there
  // is, so it wins; concepts stay the fallback.
  const ownKeyOf = (label) => String(label ?? "")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");
  const ownKeys = {};
  for (const [k, v] of Object.entries(vault)) {
    const uk = ownKeyOf(k);
    if (uk && ownKeys[uk] === undefined) ownKeys[uk] = v;
  }
  const ownValue = (label) => {
    const v = ownKeys[ownKeyOf(label)];
    return v == null || v === "" ? null : v;
  };
  // Try each identity a field has SEPARATELY. Joining them first ("f0 f0 氏名") produces a key
  // that matches nothing — the caption has to be looked up on its own. Most specific first.
  const ownValueOf = (el) => {
    const parts = [
      (el.labels && el.labels[0] && el.labels[0].textContent) || "",
      el.getAttribute("aria-label") || "",
      el.placeholder || "",
      el.name || "",
      el.id || "",
    ];
    // `p && ownValue(p)` would yield "" (not null) for an absent part and read as a hit, which
    // silently blanked every field whose name/placeholder was empty. Skip empties explicitly.
    for (const p of parts) {
      if (!p) continue;
      const v = ownValue(p);
      if (v != null) return v;
    }
    return null;
  };
  const atoms = {};
  for (const [canon, al] of Object.entries(ALIASES)) {
    for (const key of Object.keys(rawVault)) {
      if (al.some((a) => key === norm(a))) { atoms[canon] = rawVault[key]; break; }
    }
  }
  // Prefix a bare phone number with the stored country code (unless it already has one).
  // True once we know the form has a SEPARATE country-code field (set after fields are
  // collected). If so, phone-number fields carry the bare number so the code isn't doubled.
  let hasCcField = false;
  const withCC = (num) => {
    const n = (num || "").toString().trim();
    if (!n) return "";
    // A dedicated country-code control carries the code, so the number box must hold the number ALONE.
    // A stored international number ("+1 919 555 0123") otherwise puts "+1" in both places, which most
    // sites reject — and which the user sees as the code being typed into the wrong box.
    if (hasCcField) return n.replace(/^\+\s?\d{1,4}[\s.\-()]*/, "").trim();
    const cc = (atoms.phonecc || "").toString().trim();
    return cc && !n.startsWith("+") ? cc + " " + n : n;
  };
  // Any phone number the user has — so ANY phone-type field fills even if it asks for a
  // "mobile" but the number is stored as "home", etc. General, not per-form.
  const anyPhone = () => atoms.cellphone ?? atoms.phone ?? atoms.homephone;
  // Full years from a date of birth to today. Mirrors resolver.js so PDF and web agree.
  const ageFrom = (dob) => {
    const s = String(dob || "");
    let birth = null;
    const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    const dmy = s.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
    if (iso) birth = new Date(+iso[1], +iso[2] - 1, +iso[3]);
    else if (dmy) {
      let y = parseInt(dmy[3], 10);
      if (y < 100) y += y > 30 ? 1900 : 2000;
      birth = new Date(y, parseInt(dmy[1], 10) - 1, parseInt(dmy[2], 10)); // assume MM/DD/YYYY
    }
    if (!birth || isNaN(birth.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
    return age >= 0 && age < 150 ? String(age) : null;
  };
  // A form that splits the phone into "Country dialing code" + "Number" (Dayforce/Ceridian, Workday,
  // many ATS) leaves the code box EMPTY unless the vault happens to store one — and an empty code
  // makes the whole phone invalid on submit. Derive it instead: from a stored phone written in
  // international form (+1 919…), else from the user's country. No country we know → return nothing
  // and leave the box alone, exactly as before.
  const DIAL_CODE = {
    "united states": "+1", "united states of america": "+1", america: "+1", usa: "+1", us: "+1", canada: "+1",
    "united kingdom": "+44", "great britain": "+44", england: "+44", uk: "+44", gb: "+44",
    india: "+91", australia: "+61", "new zealand": "+64", germany: "+49", france: "+33", spain: "+34",
    italy: "+39", netherlands: "+31", ireland: "+353", "south africa": "+27", nigeria: "+234", kenya: "+254",
    singapore: "+65", "united arab emirates": "+971", "saudi arabia": "+966", qatar: "+974", japan: "+81",
    china: "+86", "south korea": "+82", brazil: "+55", mexico: "+52", pakistan: "+92", bangladesh: "+880",
    "sri lanka": "+94", nepal: "+977", philippines: "+63", switzerland: "+41", sweden: "+46", norway: "+47",
    denmark: "+45", poland: "+48", portugal: "+351", "hong kong": "+852", malaysia: "+60", indonesia: "+62",
  };
  // +1 is shared by the US, Canada, Antigua, the Bahamas and a dozen more; +7 by Russia and Kazakhstan.
  // So a dial-code list must be disambiguated by WHICH country the user is in — otherwise the first
  // matching row wins and a US user silently gets Antigua (seen on Dayforce, whose options are
  // "🇦🇬 +1" with the ISO code in the option's value).
  // ONE canonical country name for whatever spelling the vault holds. Without this, a stored "USA"
  // or "America" is matched by PREFIX against the option list — and "American Samoa" wins, because it
  // starts with "America" and sorts first. Canonicalising first makes the match exact.
  const canonicalCountry = (raw0) => {
    const raw = norm(raw0 || atoms.country || atoms.nationality || "");
    if (!raw) return "";
    if (/^(america|the united states|u s a?|usa|u s)$/.test(raw)) return "united states";
    // The SAME country under another official name. Dropdowns use these long forms ("United States of
    // America", "Korea, Republic of") while a vault holds the short one, and treating them as different
    // countries left a REQUIRED country box blank on live applications.
    const SAME_COUNTRY = {
      "united states of america": "united states", "united states minor outlying islands": "",
      "united kingdom of great britain and northern ireland": "united kingdom", "great britain": "united kingdom",
      "england": "united kingdom", "the netherlands": "netherlands", "holland": "netherlands",
      "republic of india": "india", "korea republic of": "south korea", "republic of korea": "south korea",
      "russian federation": "russia", "viet nam": "vietnam", "u a e": "united arab emirates",
      "peoples republic of china": "china", "republic of ireland": "ireland",
    };
    if (SAME_COUNTRY[raw] !== undefined && SAME_COUNTRY[raw] !== "") return SAME_COUNTRY[raw];
    if (COUNTRY_ABBR[raw]) return raw;                                  // already canonical
    for (const [name, codes] of Object.entries(COUNTRY_ABBR)) {
      if (codes.some((c) => c.toLowerCase() === raw)) return name;      // ISO code -> name
    }
    if (/^(america|the united states|u s a?|usa)$/.test(raw)) return "united states";
    return raw;
  };
  const countryTokens = () => {
    const raw = norm(atoms.country || atoms.nationality || "");
    // The vault may hold the country in ANY form the user typed it: "United States", "USA", "US",
    // "America". Canonicalise first — otherwise "USA" matches no row and the first country sharing
    // the code wins (a US user was getting Antigua).
    let canon = raw && COUNTRY_ABBR[raw] ? raw : "";
    if (raw && !canon) {
      for (const [name, codes] of Object.entries(COUNTRY_ABBR)) {
        if (codes.some((c) => c.toLowerCase() === raw)) { canon = name; break; }
      }
    }
    if (canon) return [canon, ...(COUNTRY_ABBR[canon] || []).map((c) => c.toLowerCase())];
    if (raw) return [raw];
    // NO country stored at all — which is common, because onboarding seeds the dialling code (from the
    // device timezone) but leaves the country blank. Fall back to the device's own region, the same
    // on-device signal the seeder uses. Never a network call, never a guess beyond the OS locale.
    try {
      const lang = (typeof navigator !== "undefined" && (navigator.language || (navigator.languages || [])[0])) || "";
      let region = "";
      try { region = new Intl.Locale(lang).region || ""; } catch (_) { /* older engine */ }
      if (!region && lang.includes("-")) region = lang.split("-").pop();
      if (region) {
        const r = region.toLowerCase();
        for (const [name, codes] of Object.entries(COUNTRY_ABBR)) {
          if (codes.some((c) => c.toLowerCase() === r)) return [name, ...codes.map((c) => c.toLowerCase())];
        }
        return [r];
      }
    } catch (_) { /* no navigator/Intl — fall through */ }
    return [];
  };
  const derivedDialCode = () => {
    const stored = (atoms.phonecc || "").toString().trim();
    if (stored) return stored;
    const intl = [atoms.cellphone, atoms.phone, atoms.homephone].map((v) => (v || "").toString().trim())
      .find((v) => v.startsWith("+"));
    if (intl) { const m = intl.match(/^\+(\d{1,3})/); if (m) return "+" + m[1]; }
    const c = norm(atoms.country || atoms.nationality || "");
    return DIAL_CODE[c] || "";
  };
  const atomVal = (key) => {
    if (key === "phonecc") return derivedDialCode();
    if (key === "given")  return atoms.given ?? (atoms.full || "").split(/\s+/)[0];
    if (key === "family") return atoms.family ?? ((atoms.full || "").split(/\s+/).slice(-1)[0]);
    if (key === "nationality") return atoms.nationality ?? atoms.country;
    if (key === "cellphone") return withCC(atoms.cellphone ?? anyPhone());
    if (key === "homephone") return withCC(atoms.homephone ?? anyPhone());
    if (key === "phone")     return withCC(anyPhone());
    if (key === "appdate")   return atoms.appdate ?? (() => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`; })();
    // Age is DERIVED from the date of birth, never stored (mirrors resolver.js).
    if (key === "age")           return atoms.age ?? ageFrom(atoms.dob);
    if (key === "dependent_age") return atoms.dependent_age ?? ageFrom(atoms.dependent_dob);
    return atoms[key];
  };

  // 2) COMPOSITE concepts: a coarse field made of finer member atoms, joined in order.
  //    Its value excludes any member the form claims with a more-specific field.
  const COMPOSITES = {
    full:    { syn: ALIASES.full, members: ["given", "middle", "family"], sep: " ", name: true, prefer: () => atoms.full, fallback: () => atoms.full },
    address: { syn: ["address", "mailing address", "residential address", "postal address", "full address", "permanent address", "current address"], members: ["street1", "street2", "city", "state", "zip", "country"], sep: ", " },
  };

  // 3) The full concept list: every atom (except `full`, which is only a composite) as
  //    an atomic target, plus the two composites.
  const CONCEPTS = [];
  for (const [k, syn] of Object.entries(ALIASES)) {
    if (k === "full") continue;
    CONCEPTS.push({ key: k, syn, kind: "atom", name: ["given", "middle", "family"].includes(k) });
  }
  for (const [k, c] of Object.entries(COMPOSITES)) CONCEPTS.push({ key: k, syn: c.syn, kind: "composite", cmp: c, name: !!c.name });

  // Score how well a field label matches a concept: token overlap against each synonym
  // phrase; reward absolute matched tokens so a specific 2-word phrase ("first name")
  // beats a generic 1-word one ("name"), with a bonus for a whole-phrase match.
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

  // Text referenced by aria-labelledby (one or more element ids) — iCIMS/ARIA forms put the whole
  // question in a separate element and point at it, so without this the field looks label-less.
  const ariaLabelText = (el) => {
    const ids = (el.getAttribute && el.getAttribute("aria-labelledby") || "").trim();
    if (!ids) return "";
    return ids.split(/\s+/).map((id) => { const e = document.getElementById(id); return e ? (e.textContent || "") : ""; }).join(" ").replace(/\s+/g, " ").trim();
  };
  const labelOf = (el) => {
    // The visible caption is often a SIBLING (Angular/React forms rarely use <label for>),
    // and the id can be misspelt (e.g. "passportExpirtyDate"). Read the nearest ancestor's
    // short text so the real, human-visible label is seen — not just the field's own tags.
    // A custom dropdown's own wrapper reads "Select…" — the widget's PLACEHOLDER, not its question.
    // Stopping there labelled every Greenhouse screening dropdown "Select..." , so the saved answer
    // for "Are you eligible to work in the United States?" matched nothing and the box stayed empty.
    // Keep climbing past a placeholder-only wrapper until the real question is in view.
    const placeholderOnly = /^(select\s*(one|an option|a value)?|choose( one)?|please select|pick one|--+|—|-)\s*(\.{3}|…)?$/i;
    let gt = "", a = el.parentElement;
    for (let i = 0; i < 5 && a; i++, a = a.parentElement) {
      const t = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length >= 3 && t.length <= 200 && !placeholderOnly.test(t)) { gt = t; break; }
    }
    return [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), ariaLabelText(el),
      (el.labels && el.labels[0] && el.labels[0].textContent) || "",
      (el.closest("label") && el.closest("label").textContent) || "", gt].join(" ");
  };
  const wantsInitial = (label, el) => /\binitial\b|\binit\b/.test(norm(label)) || el.maxLength === 1;

  // ---- Fields that are NOT the user's to answer (parity with resolver.js) ----------------
  // Kept deliberately identical to resolver.js so a web form and a PDF of the same form behave
  // the same way; `engine-parity.test.mjs` fails the build if one side gains a rule the other
  // lacks. Three rules, all of them "leave it blank rather than invent a fact":
  //   1. OFFICE-USE / DERIVED boxes (a check digit, "for official use only").
  //   2. A SCRIPT-QUALIFIED name ("Chinese name") - only from a matching vault key.
  //   3. A QUALIFIED address ("correspondence address") when the form ALSO asks for the plain
  //      one - only from a matching vault key, never a copy of the residential address.
  // The digit patterns deliberately have no leading \b: the real field name `HKIDCheckingDigit`
  // normalises to "hkidchecking digit" (camelCase cannot split HKID from Checking), so a
  // word-anchored pattern misses the exact field that exposed the bug.
  const NOT_THE_APPLICANTS = [
    /check(ing)? ?digit/, /checksum/, /(verification|control) digit/, /(last|final) digit/,
    /\bfor (official|office|department(al)?|staff|internal|bank|agency) use\b/,
    /\b(official|office|departmental|staff|internal) use only\b/,
    /\bdo not (write|fill|complete|use)\b/,
    /\breceived by\b/, /\bapproved by\b/, /\bverified by\b/, /\bprocessed by\b/,
  ];
  const officeUse = (label) => NOT_THE_APPLICANTS.some((re) => re.test(norm(label)));
  const SCRIPT_WORDS = ["chinese", "japanese", "korean", "arabic", "hindi", "tamil", "telugu",
    "kannada", "malayalam", "bengali", "gujarati", "punjabi", "marathi", "urdu", "russian",
    "thai", "greek", "hebrew", "persian", "farsi", "devanagari", "cyrillic", "kanji", "kana",
    "katakana", "hiragana", "hanzi", "hangul", "native", "local", "vernacular"];
  const ADDRESS_QUALIFIERS = ["correspondence", "mailing", "postal", "office", "business",
    "work", "employer", "permanent", "previous", "former", "overseas", "foreign", "abroad"];
  const qualifierIn = (label, words, noun) => {
    const toks = norm(label).split(" ").filter(Boolean);
    if (!toks.includes(noun)) return null;
    return toks.find((t) => words.includes(t)) || null;
  };
  // A vault key mentioning BOTH the qualifier and the noun (chinese_name, office_address, …).
  const qualifiedValue = (q, noun) => {
    for (const key of Object.keys(rawVault)) {
      const kt = key.split(" ");
      if (kt.includes(q) && kt.includes(noun)) return rawVault[key];
    }
    return null;
  };
  // These rules must read the field's OWN label only. `labelOf` deliberately falls back to the
  // nearest ancestor's text, which on a compact form is the caption of every OTHER field too —
  // with that, "Residential Address" looks qualified (it can see the word "correspondence"
  // further down the page) and the whole rule silently disables itself. Own attributes plus the
  // properly associated <label> only.
  const ownLabel = (el) => [el.name, el.id, el.placeholder, el.getAttribute("aria-label"),
    (el.labels && el.labels[0] && el.labels[0].textContent) || ""].join(" ");
  // Does this page ALSO ask for the plain/home address? Then the qualified ones are distinct.
  const hasPlainAddress = [...deepQSA("input, textarea, select")].some((el) => {
    const toks = norm(ownLabel(el)).split(" ").filter(Boolean);
    return toks.includes("address") && !toks.some((t) => ADDRESS_QUALIFIERS.includes(t));
  });
  /**
   * null            -> ordinary field, resolve it normally
   * { skip: true }  -> never fill (office use, or a qualified field we hold no value for)
   * { value }       -> fill with exactly this, bypassing concept matching
   */
  // Alternate-name fields (Preferred / Former / Maiden / Other / Nick / Alias / AKA name) must NEVER
  // receive the legal or full name — only a value the user actually stored for THAT alt-name, else be
  // skipped. Without this, "Preferred Name" / "Former Name" matched the generic full-name concept
  // (because "name" alone matched) and got the wrong value — e.g. a leftover "John Doe" test entry —
  // on real job applications.
  const ALT_NAME_QUALS = ["preferred", "former", "previous", "prior", "maiden", "other",
    "alternate", "alternative", "nickname", "nick", "alias", "aka"];
  const altNameQual = (label) => {
    const toks = norm(label).split(" ").filter(Boolean);
    if (!toks.some((t) => ["name", "nickname", "alias", "aka"].includes(t))) return null;
    return toks.find((t) => ALT_NAME_QUALS.includes(t)) || null;
  };
  const altNameValue = (q) => {
    // The vault key must name THIS alt-name specifically: the qualifier AND the word "name" (a
    // "former name" key), else a standalone nickname/alias/aka key. Requiring "name" stops an
    // unrelated "former …"/"other …" field (e.g. a "formerly employed here? → NO") from leaking in.
    const standalone = ["nickname", "nick", "alias", "aka"].includes(q);
    for (const key of Object.keys(rawVault)) {
      const kt = key.split(" ");
      if (kt.includes(q) && (standalone || kt.includes("name"))) return rawVault[key];
    }
    return standalone && rawVault[q] != null ? rawVault[q] : null;
  };
  const specialCase = (label) => {
    if (officeUse(label)) return { skip: true };
    const altq = altNameQual(label);
    if (altq) { const v = altNameValue(altq); return v && String(v).trim() ? { value: v } : { skip: true }; }
    const script = qualifierIn(label, SCRIPT_WORDS, "name");
    if (script) {
      const v = qualifiedValue(script, "name");
      return v ? { value: v } : { skip: true }; // never the Latin name
    }
    const addr = hasPlainAddress ? qualifierIn(label, ADDRESS_QUALIFIERS, "address") : null;
    if (addr) {
      const v = qualifiedValue(addr, "address");
      return v ? { value: v } : { skip: true }; // never a copy of the residential address
    }
    return null;
  };

  // Does this readOnly field look like a DATE PICKER (fill it) rather than a locked field
  // (leave it alone)? Native date types, or the usual picker signatures on the element or an
  // ancestor: a datepicker class/role, a calendar icon sibling, or a date-ish label/placeholder.
  const isDatePickerLike = (el) => {
    if (["date", "datetime-local", "month", "week", "time"].includes(el.type)) return true;
    const hay = [
      el.className, el.id, el.name,
      el.getAttribute("placeholder"), el.getAttribute("autocomplete"),
      el.getAttribute("aria-label"), el.getAttribute("role"),
      el.parentElement && el.parentElement.className,
    ].join(" ").toLowerCase();
    if (/datepicker|date-picker|calendar|dtpicker|flatpickr|mat-datepicker|ant-picker/.test(hay)) return true;
    // dd/mm/yyyy-style placeholders are a strong picker signal.
    if (/\b[dmy]{1,4}\s*[\/.-]\s*[dmy]{1,4}\s*[\/.-]\s*[dmy]{2,4}\b/.test(hay)) return true;
    return /\bdate\b|\bdob\b|birth|expiry|expiration|issued?\b/.test(hay);
  };

  // Is this field inside an EDUCATION section? Such fields (Field of study, GPA, From/To year…) must be
  // filled ONLY by the education router — never by generic concept/address/DOB matching, which was
  // stuffing the street address into a GPA box and the birth year into "From". Detected by the field's
  // own id/name or an ancestor headed "Education".
  const inEduContext = (el) => {
    if (/education|academic|schooling|educationdata/.test(norm((el.id || "") + " " + (el.name || "")))) return true;
    let node = el;
    for (let i = 0; i < 9 && node; i++) {
      node = node.parentElement; if (!node) break;
      if (node.querySelectorAll) for (const h of node.querySelectorAll(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > legend, :scope > label, :scope > [class*='head'], :scope > [class*='title'], :scope > strong, :scope > b")) {
        if (/^education\b|^education\s*:|education (history|background|details|information)/.test(norm(h.textContent))) return true;
      }
    }
    return false;
  };

  const fields = [];
  let fi = 0; // index aligned with collectFillLabels() so tLabels[fi] is this field's translated label
  for (const el of deepQSA("input, textarea")) {
    if (["hidden", "checkbox", "radio", "file", "submit", "button"].includes(el.type)) continue;
    if (el.disabled) continue;
    // Password fields ARE fillable on an explicit "Fill this page" — the user's intent to put their
    // saved password into the form they are submitting. But NEVER auto-fill a password on page load
    // (opts.skipPassword): writing a saved password into every page automatically is a real risk.
    // And only ever fill a VISIBLE password field — never a hidden/offscreen one (harvesting vector).
    if (el.type === "password" && (OPTS.skipPassword || el.offsetParent === null)) continue;
    // readOnly is NOT a blanket skip: date pickers are routinely readOnly and must still be
    // filled (see setFieldValue, which briefly clears the flag). But a readOnly *text* field is
    // one the site does not want changed — a server-issued reference number, a computed total.
    // Writing there can corrupt a submission or fail server-side validation. So: allow readOnly
    // only where it plausibly means "picker", not "locked".
    if (el.readOnly && !isDatePickerLike(el)) continue;
    // Never clobber a value the SITE / résumé-parser / user put there. Autofill fills the BLANKS.
    // EXCEPTION: a field WE filled on a previous run (marked data-ppf-filled) may be re-filled — so a
    // corrected vault value replaces an earlier wrong autofill on the SAME page (e.g. the user fixed a
    // stale email in the vault and clicks Fill again). Only externally-provided values are protected.
    // The "already has a value → don't clobber" guard must protect real USER/SITE DATA — NOT a widget's
    // empty-state SCAFFOLD. Generic (no per-control/per-site logic): a value is scaffold, and therefore
    // still fillable, when it carries no real content — it echoes the field's own placeholder, or it has
    // no letters, at most a few digits, and only formatting punctuation around them. That covers an intl
    // phone widget's dialing-code stub ("+1", "+91"), an empty input mask ("(   )   -    ", "__/__/____"),
    // a lone "+", etc. Anything with letters or a meaningful number is real data and stays protected.
    const cur = (el.value || "").trim();
    const digitsOnly = cur.replace(/\D/g, "");
    const hasLetters = /[a-z]/i.test(cur);
    const isScaffold = cur !== "" && (
      cur === (el.placeholder || "").trim() ||
      (!hasLetters && digitsOnly.length <= 4 && /[^\w]/.test(cur))
    );
    if (cur !== "" && !isScaffold && el.getAttribute("data-ppf-filled") !== "1") { fi++; continue; }
    const label = tLabels && tLabels[fi] ? tLabels[fi] : labelOf(el); // use the English-translated label if provided
    fi++;
    // Free-text catch-all fields (Description / Comments / Notes / Remarks / Cover letter / "additional
    // information") are the applicant's own prose — a job or education "Description", a message box. We
    // hold no value that belongs there, and matching them loosely dumped vault data into them (a saved
    // password, the home address) on real ATS forms (UltiPro/Workday repeat a "Description" per section).
    // Never auto-fill them. Checked on the FULL label (these fields are often labelled only by a sibling).
    // Free-text catch-alls (Description/Comments/Notes/…) and screening PROMPTS ("Please provide…",
    // "How many…", a "?") are not field captions — matching a concept to a whole sentence guessed stray
    // values into them. So we DON'T concept-fill them… EXCEPT when the user actually has a captured
    // answer for this exact prompt: if a vault key's meaningful tokens all appear in the label (e.g.
    // "linkedin_profile" ⊂ "Please provide … your LinkedIn profile"), fill that stored value. Never a guess.
    const catchAll = /\b(descriptions?|comments?|remarks?|notes?|cover ?letter|additional (information|details|comments)|anything else|other information|message)\b/.test(norm(label));
    const screening = label.includes("?") ||
      /\b(please (provide|enter|describe|list|explain|tell|specify|share|state|attach|upload)|how (many|much|long|often)|do you|are you|have you|did you|were you|would you|will you|can you|is there)\b/.test(norm(label));
    if (catchAll || screening) {
      const lt = new Set(norm(label).split(" ").filter((w) => w.length > 1));
      const labelJoined = norm(label).replace(/\s+/g, ""); // "linkedin" matches even when the label split it to "linked in"
      let hit = null, hitScore = 0;
      for (const key of Object.keys(rawVault)) {
        const km = key.split(" ").filter((w) => w.length > 2);
        if (!km.length || !(km.length >= 2 || km.some((w) => w.length >= 6))) continue; // avoid a stray 1-token match
        let s = 0; for (const w of km) if (lt.has(w) || labelJoined.includes(w)) s++;
        if (s === km.length && s > hitScore) { hitScore = s; hit = rawVault[key]; } // ALL key tokens present in the prompt
      }
      if (hit != null && String(hit).trim()) { fields.push({ el, label, pick: null, forced: String(hit) }); continue; }
      continue; // no captured answer → leave the prompt for the user
    }
    // "Address 2 / Line 2 / Apt / Suite / Unit" is a SECONDARY address line (apartment, etc.), never the
    // street — don't duplicate the street address into it. Fill only from a stored secondary-line value.
    if (/\b(address 2|address line 2|addr 2|line 2|apartment|apt|suite|unit)\b/.test(norm(label)) &&
        !/\b(city|state|province|zip|postal|country|phone)\b/.test(norm(label))) {
      const v = rawVault["address 2"] || rawVault["address line 2"] || rawVault.apartment || rawVault.apt || rawVault.suite || rawVault.unit;
      if (v != null && String(v).trim()) fields.push({ el, label, pick: null, forced: String(v) });
      continue;
    }
    // A repeated work-history entry beyond the first: we hold one current role, so leave the earlier
    // entries blank rather than stamping the same job/employer into every one.
    const hIdx = historyEntryIndex(el);
    if (hIdx != null && hIdx > 0) continue;
    const special = specialCase(ownLabel(el)); // own label only — see ownLabel
    if (special) {
      if (!special.skip) fields.push({ el, label, pick: null, forced: special.value });
      continue;
    }
    // The user's OWN key for exactly this label wins outright — they wrote that key against that
    // label, which is stronger evidence than any concept we could infer. Matched on the field's
    // own label (not the ancestor-text fallback), and BEFORE concept scoring, so a captured value
    // fills next time instead of being stored and never used.
    const ownHit = ownValueOf(el);
    if (ownHit != null) { fields.push({ el, label, pick: null, forced: ownHit }); continue; }
    // EDUCATION fields: a Degree/Field/School/Year/GPA field is filled from the qualification whose
    // level matches the field's section (Master's block → masters entry), else the highest one.
    const eduCtx = edu.length && inEduContext(el);
    // In an education block, classify by the field's OWN label — NOT labelOf's ancestor fallback, which
    // for a short caption like "To" grabs the whole block ("School or University …") and mis-files it.
    const eduV = eduValueFor(el, eduCtx
      ? (ariaLabelText(el) + " " + ((el.closest("label") && el.closest("label").textContent) || "") + " " + ownLabel(el))
      : label);
    if (eduV != null) { fields.push({ el, label, pick: null, forced: eduV }); continue; }
    // An education sub-field we hold no value for → leave it BLANK; never let generic matching guess it
    // (that put the address in GPA and the birth year in From/To).
    if (eduCtx) continue;
    let pick = null, top = 0;
    for (const c of CONCEPTS) { const s = score(label, c.syn); if (s > top) { top = s; pick = c; } }
    if (!pick || top < 1.5) {
      // Fall back to the field's SEMANTIC HTML type when the label is missing/unclear —
      // a phone input is type="tel" (or autocomplete/inputmode tel); email is type="email".
      const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
      if (el.type === "tel" || /\btel\b/.test(ac) || el.getAttribute("inputmode") === "tel") {
        pick = CONCEPTS.find((c) => c.key === "phone");
      } else if (el.type === "email" || /\bemail\b/.test(ac)) {
        pick = CONCEPTS.find((c) => c.key === "email");
      } else {
        // A NUMERIC EXAMPLE placeholder (e.g. "012345648382") on a short input is a phone
        // number — unless the label indicates some OTHER number (reference/passport/PIN/…).
        const ph = (el.placeholder || "").trim();
        const ml = +el.getAttribute("maxlength") || 0;
        const otherNumber = /reference|passport|\bpin\b|zip|postal|account|licen|national|aadhaar|\bssn\b|\btax\b|\bcard\b|\bid\b|otp|cvv/.test(norm(label));
        if (/^[+(]?\d[\d\s()\-]{5,18}$/.test(ph) && (ml === 0 || (ml >= 7 && ml <= 20)) && !otherNumber) {
          pick = CONCEPTS.find((c) => c.key === "phone");
        }
      }
      if (!pick) continue; // still nothing — require a real match to avoid false fills
    }
    fields.push({ el, label, pick });
  }

  // Which member atoms does the form claim with a dedicated (atomic) field? A composite
  // then absorbs only the members NOT claimed here.
  const claimed = new Set(fields.filter((f) => f.pick && f.pick.kind === "atom").map((f) => f.pick.key));
  hasCcField = fields.some((f) => f.pick && f.pick.key === "phonecc"); // affects withCC()

  // Reformat a stored date (vault convention MM/DD/YYYY) to match what THIS field asks for.
  // Many forms state the order in the placeholder/label — "dd/mm/yyyy", "DD-MMM-YYYY" — and
  // <input type="date"> needs ISO. Honour it; non-date values pass through untouched.
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parseVaultDate = (v) => {
    const m = String(v).match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (!m) return null;
    const a = +m[1], b = +m[2]; let y = m[3];
    const [month, day] = (a > 12 && b <= 12) ? [b, a] : [a, b]; // stored MM/DD; swap only if impossible
    if (day > 31 || month > 12) return null;
    if (y.length === 2) y = (+y > new Date().getFullYear() % 100 ? "19" : "20") + y;
    return { day, month, year: +y };
  };
  // Page-wide date order: forms usually state the required format ONCE (e.g. a DOB hint
  // "dd/mm/yyyy") and expect it for EVERY date field. Detect it from the whole page as a
  // fallback for fields (like Passport Expiry) whose own hint doesn't repeat the format.
  // Slash/dash/dot separators only (a space separator would match ordinary prose).
  const pageDateFmt = (() => {
    const hay = (document.body ? document.body.textContent : "").toLowerCase();
    const m = hay.match(/(d{1,2}|m{1,3}|y{2,4})([\/.\-])(d{1,2}|m{1,3}|y{2,4})\2(d{1,2}|m{1,3}|y{2,4})/);
    return m ? { tokens: [m[1], m[3], m[4]], sep: m[2] } : null;
  })();
  const detectDateFmt = (el, label) => {
    // Forms state the required order in various places: placeholder, label, a tooltip, an
    // aria-describedby hint, or a help/error line in the field's container ("Please enter
    // the date in dd/mm/yyyy"). Search all of them.
    const parts = [el.placeholder, label, el.getAttribute("title")];
    const db = el.getAttribute("aria-describedby");
    if (db) db.split(/\s+/).forEach((id) => { const n = document.getElementById(id); if (n) parts.push(n.textContent); });
    // The hint often sits in a sibling within the field's form-GROUP, not the input's
    // immediate wrapper — search a form-group-like ancestor (falls back a few levels up).
    const box = el.closest("[class*='form'], [class*='field'], [class*='group'], [class*='date'], fieldset, li, tr, section, td")
      || (el.parentElement && el.parentElement.parentElement) || el.parentElement;
    if (box) parts.push(box.textContent.slice(0, 500));
    const hay = parts.filter(Boolean).join(" ").toLowerCase();
    const m = hay.match(/(d{1,2}|m{1,3}|y{2,4})([\/.\- ])(d{1,2}|m{1,3}|y{2,4})\2(d{1,2}|m{1,3}|y{2,4})/);
    return m ? { tokens: [m[1], m[3], m[4]], sep: m[2] } : null;
  };
  const formatDateForField = (value, el, label) => {
    const dt = parseVaultDate(value);
    if (!dt) return value; // not a date — leave as-is
    const pad = (n, w) => String(n).padStart(w, "0");
    if (el.type === "date") return `${dt.year}-${pad(dt.month, 2)}-${pad(dt.day, 2)}`;
    const f = detectDateFmt(el, label) || pageDateFmt; // field hint, else the page-wide order
    if (f) return f.tokens.map((t) =>
      /^d/.test(t) ? pad(dt.day, t.length)
        : /^m{3}$/.test(t) ? MONTHS[dt.month - 1]
          : /^m/.test(t) ? pad(dt.month, t.length)
            : t.length === 2 ? String(dt.year).slice(-2) : String(dt.year)).join(f.sep);
    return `${pad(dt.month, 2)}/${pad(dt.day, 2)}/${dt.year}`; // default: US MM/DD/YYYY, 4-digit year
  };
  // Set a value in a way FRAMEWORKS honour: React/Angular ignore a plain `el.value =`, and
  // date pickers are often readOnly. Use the native value setter, briefly clear readOnly,
  // and fire a full event sequence.
  // React (Workday, etc.) caches each input's value in an internal `_valueTracker`; a programmatic set
  // via the prototype setter bypasses it, so React's onChange never fires and the field stays "empty"
  // for validation — the form fills visually but won't submit. Point the tracker at the OLD value so
  // React sees a real change on the next input event, and its validation/enable-submit updates.
  const syncReactTracker = (el, prev) => { try { if (el._valueTracker) el._valueTracker.setValue(prev); } catch (_) { /* not React */ } };
  const setFieldValue = (el, value) => {
    const ro = el.readOnly; if (ro) el.readOnly = false;
    try { el.focus(); } catch (_) { /* ignore */ }
    const prev = el.value;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    syncReactTracker(el, prev);
    try { el.dispatchEvent(new InputEvent("input", { bubbles: true, data: String(value), inputType: "insertText" })); }
    catch (_) { el.dispatchEvent(new Event("input", { bubbles: true })); }
    for (const t of ["change", "blur"]) el.dispatchEvent(new Event(t, { bubbles: true }));
    if (ro) el.readOnly = ro;
    return true;
  };
  // Draw a clear box around a field we just filled, so the user can SEE and verify exactly what was
  // entered (parity with the count we report). A teal outline + soft glow + faint tint, left in place
  // (no auto-fade) so it survives while they review; the site's next real edit clears it naturally.
  const markFilled = (el) => {
    try {
      const box = (el.type === "checkbox" || el.type === "radio") ? (el.closest("label") || el) : el;
      box.style.setProperty("outline", "2px solid #0a9e8e", "important");
      box.style.setProperty("outline-offset", "1px", "important");
      box.style.setProperty("box-shadow", "0 0 0 3px rgba(10,158,142,0.20)", "important");
      box.style.setProperty("background-color", "rgba(10,158,142,0.07)", "important");
      box.setAttribute("data-ppf-filled", "1");
    } catch (_) { /* styling is best-effort — never let it break a fill */ }
  };
  // Fill a field by SIMULATING KEYSTROKES, one character at a time. Some sites (especially password
  // fields) block paste and ignore a bulk value-set, only accepting input that arrives as real typing
  // — per-character keydown/beforeinput/input/keyup with the value growing one char at a time. This
  // mirrors a human typing, so those fields register the value and their on-key validators run.
  // Is this input the SEARCH box of a dropdown/combobox widget (Ant, react-select, ng-select, an ARIA
  // combobox) rather than a plain text field? Such a box is transient: the widget wipes it after a
  // selection, so nothing may treat that wipe as a lost value.
  const isChooserSearchBox = (el) => {
    try {
      if (!el || el.tagName !== "INPUT") return false;
      if (el.getAttribute("role") === "combobox") return true;
      const aa = el.getAttribute("aria-autocomplete");
      if (aa === "list" || aa === "both") return true;
      if (el.getAttribute("aria-haspopup") === "listbox" || el.getAttribute("aria-expanded") != null) return true;
      return !!el.closest('.ant-select, [class*="ant-select"], [class*="react-select"], [class*="ng-select"], ' +
        'mat-select, [class*="mat-select"], [class*="p-dropdown"], [role="combobox"], [aria-haspopup="listbox"]');
    } catch (_) { return false; }
  };
  const typeFieldValue = async (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    try { el.focus(); } catch (_) { /* ignore */ }
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    for (const ch of String(value)) {
      const k = { key: ch, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent("keydown", k));
      el.dispatchEvent(new KeyboardEvent("keypress", k));
      try { el.dispatchEvent(new InputEvent("beforeinput", { data: ch, inputType: "insertText", bubbles: true, cancelable: true })); } catch (_) { /* older engines */ }
      setter.call(el, (el.value || "") + ch);
      try { el.dispatchEvent(new InputEvent("input", { data: ch, inputType: "insertText", bubbles: true })); }
      catch (_) { el.dispatchEvent(new Event("input", { bubbles: true })); }
      el.dispatchEvent(new KeyboardEvent("keyup", k));
      syncReactTracker(el, el.value.slice(0, -1)); // let React register each keystroke
      await wait(12);
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  };
  // Is the field currently flagged invalid by its own validator? (Angular ng-invalid,
  // aria-invalid, common error classes.) Used to self-correct the date format.
  const fieldInvalid = (el) =>
    el.getAttribute("aria-invalid") === "true" ||
    /(^|\s)(ng-invalid|is-invalid|invalid|has-error)(\s|$)/.test(el.className || "");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Set a DATE, self-correcting the format: try the detected/preferred order first, and if
  // the field's own validator rejects it, try the other orders until it's accepted. This
  // works on the FIRST fill — no dependence on a hint that only appears AFTER a failed try.
  const setDateSmart = async (el, dt, preferred) => {
    const p = (n, w) => String(n).padStart(w, "0");
    const all = [preferred,
      `${p(dt.day, 2)}/${p(dt.month, 2)}/${dt.year}`,
      `${p(dt.month, 2)}/${p(dt.day, 2)}/${dt.year}`,
      `${dt.year}-${p(dt.month, 2)}-${p(dt.day, 2)}`,
      `${p(dt.day, 2)}-${p(dt.month, 2)}-${dt.year}`,
      `${p(dt.month, 2)}-${p(dt.day, 2)}-${dt.year}`];
    const seen = new Set();
    const cands = all.filter((c) => c && !seen.has(c) && seen.add(c));
    for (const c of cands) {
      setFieldValue(el, c);
      await wait(70);
      if (!fieldInvalid(el)) return true; // the field accepted this format
    }
    setFieldValue(el, cands[0]); // none validated (or no validator) — keep the preferred order
    return true;
  };

  let filled = 0;
  // A composite's value. An EXPLICITLY STORED value (prefer) wins over one composed from
  // leftover atoms: composing produced "Wei" for a Full Name field whenever another field had
  // already claimed the surname, when the vault holds "Li Wei Chen". (Found 2026-07-23.)
  // Single definition — this used to be inlined at three call sites and drifted.
  const compositeValue = (cmp) => {
    const stored = cmp.prefer ? cmp.prefer() : null;
    if (stored) return stored;
    const parts = cmp.members.filter((m) => !claimed.has(m)).map(atomVal).filter(Boolean);
    return parts.length ? parts.join(cmp.sep) : (cmp.fallback ? cmp.fallback() : "");
  };

  // OPT-IN diagnostic (OPTS.diag only; zero effect on normal fills): record, per collected field, the
  // concept it matched and the value that resolved, so a real session can be inspected when a fill that
  // works in tests doesn't work on a specific page. Reported on window.__ppfDiag + console at the end.
  const _diag = OPTS.diag ? [] : null;
  const _chooserLog = [];  // chooser decisions, for OPTS.diag
  const _keepAlive = []; // {el, want} for text fields — re-applied if a framework reverts the write
  for (const { el, label, pick, forced } of fields) {
    let value;
    if (forced != null) {
      value = forced; // own key / script-qualified name / qualified address, from its vault key
    } else if (pick.kind === "composite") {
      value = compositeValue(pick.cmp);
    } else {
      value = atomVal(pick.key);
    }
    if (_diag) _diag.push({ label: String(label || "").replace(/\s+/g, " ").trim().slice(0, 48), concept: (pick && pick.key) || (forced != null ? "(own-key)" : null), resolved: value ? String(value).slice(0, 24) : "(EMPTY)", ctrl: el.type || el.tagName });
    // TODAY'S DATE is the one value that is always available, so a loose match on the application-date
    // concept can never come up empty — it stamps a date wherever it lands. On a dense form, labelOf()
    // can pick up wording from neighbouring elements, and that is how "LinkedIn Profile", "Fax" and
    // "County" all received today's date on a live application. Require the field's OWN identity (its
    // label/name/id/placeholder) to actually mention a date before writing one.
    if (pick && pick.key === "appdate" && !/date|dated|dt\b/i.test(norm(ownLabel(el)) + " " + norm(label))) continue;
    if (!value) continue;
    // A YEAR box (labelled "year"/"YYYY") may only receive a 4-digit year — a street address or any
    // other value must never land in a From/To Year field; pull the year out of a date, else skip.
    const maxL = +el.getAttribute("maxlength") || 0;
    if (/\byear\b|yyyy/.test(norm(label + " " + (el.placeholder || "")))) {
      const y = String(value).match(/\b(1\d{3}|20\d{2})\b/);
      if (!y) continue;      // not a year → leave the box blank rather than fill garbage
      value = y[0];
    } else if (maxL > 0 && String(value).length > maxL && /\D/.test(String(value))) {
      // The value has letters and does not fit. For a STATE or COUNTRY that is not a wrong match —
      // it is a form that wants the ABBREVIATION ("North Carolina" into a maxlength=2 box, "United
      // States" into a 2/3-char one). Try the short form; only if that fits do we fill, otherwise we
      // still skip as before. Purely additive: this branch runs where the old code filled NOTHING.
      const shortForm = abbreviateFor(pick && pick.key, label, value, maxL);
      if (!shortForm) continue;   // no abbreviation that fits → leave blank, exactly as before
      value = shortForm;
    }
    if (pick && pick.name && wantsInitial(label, el)) value = initial(value);
    // Password fields: type the value key-by-key (sites that block paste / ignore a bulk set still
    // accept real typing). No date reformatting applies to a password.
    if (el.type === "password") {
      if (await typeFieldValue(el, value)) { filled++; markFilled(el); }
      continue;
    }
    const dt = parseVaultDate(value);
    if (dt && el.type !== "date") {
      if (await setDateSmart(el, dt, formatDateForField(value, el, label))) { filled++; markFilled(el); }
    } else {
      const want = formatDateForField(value, el, label);
      setFieldValue(el, want);
      // GENERIC widget robustness: some framework inputs (React `PhoneInput`/intl-tel-input, masked
      // fields, etc.) re-render from their own state and DROP a programmatic value-set — the field is
      // left empty or showing only its scaffold (e.g. "+1", so no digits of our value present). When
      // the value clearly did NOT stick, retry by SIMULATING REAL TYPING, which those widgets honour.
      // Not per-site: any input that rejects the set gets the typed fallback.
      const wantDigits = String(want).replace(/\D/g, "");
      const rejected = () => {
        const cur = el.value || "";
        if (cur === want) return false;                 // exact set held
        if (wantDigits && wantDigits.length >= 4) return !cur.replace(/\D/g, "").includes(wantDigits.slice(-4)); // numeric (phone) — last 4 must be present
        return cur.trim() === "";                        // text — only retry if left blank
      };
      // Give a re-rendering widget a moment to settle before deciding it dropped our value: at 30ms we
      // were racing the widget mid-render and re-typing a value that was about to appear anyway — which
      // is the visible "dancing" in a phone box. Still re-types whenever the value genuinely did not stick.
      if (rejected()) { await wait(150); if (rejected()) await typeFieldValue(el, want); }
      if (el.value) { filled++; markFilled(el); }
      // Watch for an async framework revert — but NEVER on a combobox SEARCH box. Such a widget clears
      // its search text by design once an option is chosen, which the revert check reads as "our value
      // was dropped": we then re-type the whole term, it clears again, and the field visibly dances for
      // several seconds (measured on Dayforce: 4 extra 14-character bursts over 8s). The chooser pass
      // owns those widgets and confirms them by selecting an option, so they need no keep-alive.
      if (!isChooserSearchBox(el)) _keepAlive.push({ el, want });
    }
  }

  // Native <select> dropdowns / list boxes (e.g. "Current Nationality"): choose the option
  // whose text or value SEMANTICALLY matches the concept value ("Indian" -> "India").
  const nOpt = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const optEq = (a, b) => {
    const x = nOpt(a), y = nOpt(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [s, l] = x.length <= y.length ? [x, y] : [y, x];
    return s.length >= 3 && l.startsWith(s);
  };
  for (const sel of deepQSA("select")) {
    if (sel.disabled) continue;
    const label = labelOf(sel);
    if (officeUse(ownLabel(sel))) continue; // an office-use dropdown is not the applicant's to set
    let pick = null;
    let value = eduValueFor(sel, label); // education dropdown (Degree, University) → the routed value
    if (value == null) {
      if (edu.length && inEduContext(sel)) continue; // edu-context dropdown with no routed value → don't guess
      let top = 0;
      for (const c of CONCEPTS) { const s = score(label, c.syn); if (s > top) { top = s; pick = c; } }
      if (!pick || top < 1.5) continue;
      value = pick.kind === "composite" ? compositeValue(pick.cmp) : atomVal(pick.key);
    }
    if (!value) continue;
    // Candidate values to match an option against: the raw value plus expansions (gender M<->Male,
    // USA<->United States, US state name<->abbrev, phone country code).
    let cands = expandCands(pick, value);
    // COUNTRY: match the canonical name in FULL. Prefix matching is how a stored "America"/"USA"
    // selected "AMERICAn Samoa" on a live application — a different country that merely starts the
    // same way, and which sorts first in most lists.
    const isCountry = pick && ["country", "nationality", "billing_country"].includes(pick.key);
    const canonCountry = isCountry ? canonicalCountry(String(value)) : "";
    // The canonical NAME plus its ISO codes, all matched EXACTLY: exact-only keeps "American Samoa"
    // out, and including the codes covers lists whose options are "US" / "USA".
    if (canonCountry) cands = [canonCountry.replace(/\b\w/g, (c) => c.toUpperCase()), ...(COUNTRY_ABBR[canonCountry] || [])];
    const opts = [...sel.options];
    // A dialling-code list ("US +1", "IN +91", "+44") shares no words with the value, so match it on
    // the CODE itself — exactly, so "+1" never picks "+212". Same rule as the custom-dropdown path.
    const dialWant = pick && pick.key === "phonecc" ? String(value).replace(/\D/g, "") : "";
    const dialOf = (t) => { const m = String(t || "").match(/\+\s?(\d{1,4})/) || String(t || "").match(/^\(?\+?(\d{1,4})\)?$/); return m ? m[1] : null; };
    // Among the rows carrying the right code, prefer the user's own country (ISO in the value or the
    // name in the text); fall back to the first code match only when we don't know the country.
    const ctoks = dialWant ? countryTokens() : [];
    const dialRank = (o) => {
      if (dialOf(o.textContent) !== dialWant && dialOf(o.value) !== dialWant) return 0;
      const v = String(o.value || "").toLowerCase(), t = norm(o.textContent || "");
      return ctoks.some((k) => v === k || t === k || t.includes(k)) ? 2 : 1;
    };
    // `optEq` accepts a prefix, which is right for most concepts and WRONG for a country: it is how
    // "America" matched "American Samoa". For a country, require the whole name.
    const eqFor = (a, b) => (canonCountry ? nOpt(a) === nOpt(b) : optEq(a, b));
    const match = dialWant
      ? opts.filter((o) => dialRank(o) > 0).sort((a, b) => dialRank(b) - dialRank(a))[0]
      : opts.find((o) => cands.some((cv) => eqFor(o.textContent, cv) || eqFor(o.value, cv)));
    if (match) {
      sel.value = match.value;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      filled++; markFilled(sel);
    }
  }

  // CUSTOM dropdowns (any framework — ng-select, mat-select, react-select, PrimeNG, or an
  // ARIA combobox). We don't target a specific site: we detect a widget that BEHAVES like a
  // chooser (standard roles / common widget roots), open it, then click the option whose
  // VISIBLE TEXT matches the value. Only widgets that resolve to a concept + have a value are
  // opened, so unrelated menus are never touched.
  // Collected from the LIVE DOM each time it is called: these frameworks REPLACE a dependent widget's
  // node when its parent changes, so a list captured once goes stale.
  const chooserHosts = () => [...deepQSA(
    'ng-select, mat-select, [role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"], ' +
    '[class*="ng-select"], [class*="mat-select"], [class*="react-select"], [class*="dropdown-toggle"], [class*="ant-select"], [class*="p-dropdown"], ' +
    '[class*="combobox"], [class*="Combobox"], [class*="-select"], [class*="Select"], [class*="dropdown"], [class*="Dropdown"]',
  )].filter((h) => {
    if (h.tagName === "SELECT" || h.closest("select")) return false;
    // The class matches are broad, so require the widget to LOOK like an unset single-select
    // chooser: its visible text is a placeholder ("Select an option", "Choose…", "-") or empty.
    // An already-answered widget, a multiselect chip box, a menu button, etc. is left alone.
    // (The concept-score guard below is the other half — only labelled matches are ever opened.)
    // "Is this widget still unset?" must be judged on the widget's own DISPLAY area, not on everything
    // inside it. Some libraries wrap the label and the control together, so reading the whole element
    // returned the question text ("Country*") — over the length limit, so every one of those widgets was
    // skipped and the chooser pass never ran on that form at all.
    const disp = h.querySelector('[class*="select__control"], [class*="selection-item"], [class*="single-value"], [class*="selected-value"]') || h;
    const t = (disp.textContent || "").trim().replace(/\s+/g, " ");
    return t.length <= 40 && (t === "" || /^(select|choose|please select|pick|—|-)\b/i.test(t) || /select an option|select\.\.\.|choose an option/i.test(t));
  });
  const hosts = chooserHosts();
  const seen = new Set();
  const _chooserRetry = [];   // widgets that resolved to a concept but could not be set on the first try
  // One widget's whole attempt, as a function so the targeted retry below can run it again unchanged.
  // ---- RECOGNISE THE LIST, THEN ACT (one pass, no traversal) ------------------------------------
  // The old approach opened a widget, then compared every row against the vault — which on a country
  // or dialling-code list means walking 244 rows, scrolling the page, and retrying. A list announces
  // what it is in its first few rows, so: OPEN once → SAMPLE a few rows → RECOGNISE the kind → derive
  // the ONE string that identifies the answer → type it (the widget narrows itself) → click the row.
  //
  // Recognised kinds, with the term that identifies the answer in each:
  //   dial-abbrev   "US +1", "IN +91"        → the ISO abbreviation ("US")   — 2 chars, one row left
  //   dial-name     "United States +1"       → the country name
  //   dial-code     "+1", "(+1)"             → the code itself
  //   yesno         "Yes" / "No"             → nothing to type; match the answer directly
  //   text          anything else            → the value itself, longest form first
  const OPT_ROWS = '[role="option"], [class*="item-option"], [class*="select__option"], .ng-option, ' +
    'mat-option, [class*="p-dropdown-item"], li[role="option"]';

  const openChooser = async (h) => {
    // The control box opens these widgets; the inner search input only becomes live afterwards.
    const control = h.closest('[class*="select__control"]') || h.querySelector('[class*="select__control"]')
      || h.closest('.ant-select, [class*="ant-select"]')?.querySelector('[class*="selector"]')
      || h.querySelector('[class*="selector"], [class*="control"], [class*="toggle"]') || h;
    const input = (h.tagName === "INPUT" ? h : null) || h.querySelector("input:not([type=hidden])")
      || control.querySelector?.("input:not([type=hidden])")
      || h.closest('.ant-select, [class*="ant-select"], [class*="select"]')?.querySelector("input:not([type=hidden])");
    for (const t of ["pointerdown", "mousedown", "mouseup", "click"]) {
      try { control.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0 })); } catch (_) { /* ignore */ }
    }
    try { input && input.focus(); } catch (_) { /* ignore */ }
    await wait(180);
    return { control, input };
  };

  // Rows that belong to THIS widget: what its input points at (aria-controls), else rows carrying the
  // library's instance id, else the panel inside the widget. Never "whatever list is open nearby".
  const ownRows = (h, input) => {
    const id = input && (input.getAttribute("aria-controls") || input.getAttribute("aria-owns"));
    if (id) {
      const byId = document.getElementById(id);
      if (byId) return [...byId.querySelectorAll(OPT_ROWS)].filter((o) => (o.textContent || "").trim());
      const prefix = id.replace(/-listbox$/, "");
      const byPrefix = [...deepQSA('[id^="' + prefix + '-option-"]')].filter((o) => (o.textContent || "").trim());
      if (byPrefix.length) return byPrefix;
    }
    const host = h.closest('.ant-select, [class*="ant-select"], [class*="select"]') || h;
    return [...host.querySelectorAll(OPT_ROWS)].filter((o) => o.offsetParent !== null && (o.textContent || "").trim());
  };

  // WHAT IS THIS LIST? Decided from at most 6 rows.
  const recogniseList = (rows) => {
    const s = rows.slice(0, 6).map((o) => (o.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!s.length) return "empty";
    const hit = (re) => s.filter((x) => re.test(x)).length >= Math.min(2, s.length);
    if (hit(/^[^a-z]*[A-Z]{2}\b[^+]{0,4}\+\s?\d{1,4}/)) return "dial-abbrev";  // "US +1", "🇺🇸 US +1"
    if (hit(/^[^+]*[A-Za-z]{3,}[^+]*\+\s?\d{1,4}/)) return "dial-name";        // "United States +1"
    if (hit(/^[^\d+]{0,3}\+\s?\d{1,4}\s*$/)) return "dial-code";               // "+1"
    if (hit(/^(yes|no|prefer not|i don'?t wish|decline)\b/i)) return "yesno";
    return "text";
  };

  // Fill ONE chooser: recognise, derive, type, click, verify. Returns true only when the widget's own
  // display shows a real value afterwards. No retry loop, no scrolling, no row-by-row comparison.
  const smartChoose = async (h, want) => {
    // want = { text, alt[], iso, dialCode, matcher }  — everything derivable from the vault BEFORE we
    // touch the widget, so the DOM is only ever read to confirm, never to search.
    const { control, input } = await openChooser(h);
    let rows = ownRows(h, input);
    if (!rows.length) { await wait(500); rows = ownRows(h, input); }   // dependent list still loading
    const kind = recogniseList(rows);
    const setV = (el, v) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    // The ONE term that identifies our answer in a list of this kind.
    // A dialling list is whatever shape the site chose — "US +1", "United States +1", "+1", or (Dayforce)
    // "🇺🇸 +1 United States of America". What matters is that these lists are VIRTUALISED: only the first
    // rows exist in the DOM, so the user's row is usually absent and whatever +1 row happens to be
    // rendered wins — which is how a US applicant ended up with Guam. Typing the COUNTRY NAME brings the
    // right row into existence; the code and the abbreviation are fallbacks for lists shaped otherwise.
    const dialTerm = want.countryName || want.iso || (want.dialCode ? "+" + want.dialCode : "");
    const term = kind === "dial-abbrev" ? (want.iso || dialTerm)
      : kind === "dial-name" ? dialTerm
      : kind === "dial-code" ? (want.dialCode ? "+" + want.dialCode : "")
      : kind === "yesno" ? ""
      : want.dialCode ? dialTerm            // a dial list we did not classify — still narrow it by name
      : want.text;
    // A widget that offers NO rows has nothing to filter, so typing into it only churns the field.
    if (kind === "empty") return "unrecognised";
    if (term && input) { setV(input, String(term)); await wait(200); rows = ownRows(h, input); }
    // Match within the SHORT list. For a dial list the row must carry our code, and (when we know it)
    // our country — that is what stopped "+1" from selecting Antigua.
    const norm2 = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9+]/g, "");
    const pick = rows.slice(0, 25).map((o) => {
      const t = (o.textContent || "").replace(/\s+/g, " ").trim();
      let score = 0;
      if (want.matcher) score = want.matcher.test(t.toLowerCase()) ? 3 : 0;
      // Match by dialling code ONLY when a dialling code is what we are filling. A COUNTRY dropdown
      // that happens to print the code beside each country ("United States +1", Greenhouse) is still a
      // country question — scoring it as a dial list needs a code we do not have, so every row scored
      // zero and the required Country box was left blank.
      else if (kind.startsWith("dial") && want.dialCode) {
        const code = (t.match(/\+\s?(\d{1,4})/) || [])[1];
        if (code && code === String(want.dialCode)) score = /\b(us|usa)\b/i.test(t) === false && want.iso
          ? (new RegExp("\\b" + want.iso + "\\b", "i").test(t) || norm2(t).includes(norm2(want.countryName)) ? 3 : 1)
          : 2;
      } else {
        const a = norm2(t), b = norm2(want.text);
        if (a === b) score = 3;
        // A country must match its whole name. Prefix matching is what let "America"/"USA" select
        // "AMERICAn Samoa" — a different country that merely starts with the same letters.
        // Name or ISO code, in full — OR the SAME country under another of its official names. A list
        // that says "United States of America" while the vault says "United States" is the same country,
        // and refusing it left a REQUIRED country box blank on live Greenhouse. Identity is decided by
        // canonicalising both sides, so "American Samoa" is still a different country and stays out.
        // Country rows are often decorated with the dialling code or a flag ("United States +1"), which
        // an exact whole-name test rejects — leaving a REQUIRED country box blank on live Greenhouse.
        // Strip the decoration, then compare identities.
        else if (want.exact) {
          const bare = t.replace(/\+\s*\d{1,4}\s*$/, "").replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "").trim();
          score = (want.alts || []).some((x) => norm2(x) === a || norm2(x) === norm2(bare)) ? 3
            : (canonicalCountry(bare) && canonicalCountry(bare) === canonicalCountry(want.text) ? 3 : 0);
        }
        else if (b && (a.startsWith(b) || b.startsWith(a))) score = 2;
      }
      return { o, score, len: t.length };
    }).filter((x) => x.score >= 2).sort((a, b) => (b.score - a.score) || (a.len - b.len))[0];
    if (!pick) {
      if (_diag) _chooserLog.push({ nopick: true, kind, term: String(term || ""), exact: !!want.exact, want: String(want.text || ""),
        rows: rows.length, sample: rows.slice(0, 4).map((o) => (o.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24)) });
      // FILL-THEN-WIPE guard. Clearing our typed text is right when nothing was chosen — but a slow
      // widget can accept the choice AFTER we decide, and the clear then erases a value that had just
      // been committed. That is what "it filled everything and then cleaned it up" looks like. So look
      // again first, and only clear when the widget is still unset AND the box holds only our own text.
      await wait(120);
      const shownNow = (h.closest('[class*="select"]') || h).querySelector('[class*="selection-item"], [class*="single-value"], [class*="select__control"]')
        || h.closest('[class*="select"]') || h;
      const txtNow = ((shownNow.textContent || "")).replace(/\s+/g, " ").trim();
      if (txtNow && !/^(select|choose|please select|pick|--+|—|-)\s*(\.{3}|…)?$/i.test(txtNow)) return "ok";
      const typedNow = input ? String(input.value || "") : "";
      const oursOnly = !typedNow || !term || typedNow === String(term);
      if (input && oursOnly) { setV(input, ""); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }
      // A list we RECOGNISED that does not contain our answer is a definite no: leave the field blank
      // rather than let another pass type into it again (which is what made a field flicker).
      return (kind === "empty" || kind === "text") ? "unrecognised" : "no-match";
    }
    for (const t of ["mousedown", "mouseup", "click"]) pick.o.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0 }));
    await wait(160);
    const shown = ((h.closest('[class*="select"]') || h).querySelector('[class*="selection-item"], [class*="single-value"], [class*="select__control"]')
      || h.closest('[class*="select"]') || h);
    const txt = ((shown.textContent || "")).replace(/\s+/g, " ").trim();
    const ok = !!txt && !/^(select|choose|please select|pick|--+|—|-)\s*(\.{3}|…)?$/i.test(txt);
    if (_diag) _chooserLog.push({ smart: true, kind, term: String(term || ""), chose: (pick.o.textContent || "").trim().slice(0, 26), ok });
    // We DID find the right row and clicked it, but the widget still shows nothing. That is not "our
    // answer isn't in this list" — it is a library that commits on a gesture we haven't sent yet, so the
    // per-technology adapters must still get their turn. Returning "no-match" here stopped them, and a
    // required Country box stayed blank on live Greenhouse with "United States +1" sitting right there.
    return ok ? "ok" : "unrecognised";
  };

  const fillChooser = async (h) => {
    let pick = null;
    const label = labelOf(h);
    if (officeUse(ownLabel(h))) return; // an office-use chooser is not the applicant's to set
    let value = eduValueFor(h, label); // education chooser (Degree, University) → the routed value
    if (value == null) {
      let top = 0;
      for (const c of CONCEPTS) { const s = score(label, c.syn); if (s > top) { top = s; pick = c; } }
      if (!pick || top < 1.5) { if (_diag) _chooserLog.push({ noconcept: String(label).replace(/s+/g," ").trim().slice(0,40), top }); return; }
      value = pick.kind === "composite" ? compositeValue(pick.cmp) : atomVal(pick.key);
    }
    if (!value) { if (_diag) _chooserLog.push({ novalue: String(label).replace(/s+/g," ").trim().slice(0,40) }); return; }
    // Recognise-then-act (smartChoose): one open, one sample, one typed term, one click. Falls through
    // to the older generic path only when the list cannot be recognised.
    {
      const iso = (countryTokens()[1] || "").toUpperCase();
      // For a COUNTRY field, search and match on the canonical name. A stored "USA"/"America" would
      // otherwise prefix-match "American Samoa" — which is what a Regions (Phenom) application picked.
      const isCountryField = pick && ["country", "nationality", "billing_country"].includes(pick.key);
      const canonical = isCountryField ? canonicalCountry(String(value)) : "";
      const ok = await smartChoose(h, {
        text: canonical ? canonical.replace(/\b\w/g, (c) => c.toUpperCase()) : String(value),
        exact: !!canonical,                       // a country must match the whole name, never a prefix
        alts: canonical ? (COUNTRY_ABBR[canonical] || []) : [],   // ...or one of its ISO codes, exactly
        iso,
        countryName: String(atoms.country || atoms.nationality || ""),
        dialCode: pick && pick.key === "phonecc" ? String(value).replace(/\D/g, "") : "",
      });
      if (_diag) _chooserLog.push({ smartResult: ok, label: String(label).replace(/s+/g," ").trim().slice(0,40) });
      if (ok === "ok") { filled++; markFilled(h); return; }
      if (ok === "no-match") return;   // recognised list, our answer is not in it — leave it blank
    }
    // Candidate strings to type/match: the value plus expansions (gender M<->Male; country
    // abbrev/demonym -> full name; US state name<->abbrev; phone country code).
    const cands = expandCands(pick, String(value));
    // A country-code dropdown may list "United States (+1)" — the user's dialling code maps to their
    // country, so add the country name as a candidate too.
    if (pick && pick.key === "phonecc") { const cn = atoms.country || atoms.nationality; if (cn) cands.push(String(cn)); }
    const n2 = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    // Score an option against the candidates: EXACT (3) > prefix (2) > containment (1).
    // Ranking (not first-match) is essential so "Male" (exact) beats "Female" — which
    // merely CONTAINS "male" (fe-male) — instead of whichever appears first in the list.
    // A DIALLING-CODE list is scored on the code itself, not on word overlap: its options read
    // "+1", "US +1", "United States (+1)", "🇺🇸 +1" — none of which share enough letters with "+1"
    // for the generic scorer, which is why these widgets were left empty (and flagged invalid) while
    // the number beside them filled. Exact code match only: "+1" must not accept "+12".
    const dialWanted = pick && pick.key === "phonecc" ? String(value).replace(/\D/g, "") : "";
    const dialToks = dialWanted ? countryTokens() : [];
    const dialScore = (o) => {
      const t = (o.textContent || "").trim();
      const m = t.match(/\+\s?(\d{1,4})/) || t.match(/^\(?\+?(\d{1,4})\)?$/);
      if (!m || m[1] !== dialWanted) return 0;
      // Rows sharing a code (+1 = US, CA, AG, BS…) are separated by the user's country: the ISO code
      // usually rides on the option's value / data-value / title, the name in its text.
      const hay = [o.getAttribute && (o.getAttribute("data-value") || o.getAttribute("title") || o.getAttribute("value")), o.value, norm(t)]
        .filter(Boolean).map((s) => String(s).toLowerCase());
      return dialToks.some((k) => hay.some((h) => h === k || h.includes(k))) ? 3 : 2;
    };
    const scoreOpt = (o) => {
      if (dialWanted) return dialScore(o);
      const ot = n2((o.textContent || "").trim());
      let best = 0;
      for (const cv of cands) {
        const c = n2(cv);
        if (!c || !ot) continue;
        if (ot === c) best = Math.max(best, 3);
        else if ((c.length >= 3 && ot.startsWith(c)) || (ot.length >= 3 && c.startsWith(ot))) best = Math.max(best, 2);
        else if ((c.length >= 4 && ot.includes(c)) || (ot.length >= 4 && c.includes(ot))) best = Math.max(best, 1);
      }
      return best;
    };
    // ---- WIDGET TECHNOLOGY → ADAPTER LADDER -------------------------------------------------------
    // Identify WHICH library built this control, then run that library's adapter. Each adapter answers
    // three questions the generic code was guessing at: what element OPENS the widget, which rows are
    // ITS rows (not a neighbour's), and how a choice is COMMITTED. Every attempt is VERIFIED against the
    // widget's own display text before we accept it, and an adapter that fails falls through to the next
    // — ending at the generic ARIA path below, which is unchanged.
    //
    // Evidence behind this (measured on a live form, six widgets, six gestures): every commit gesture
    // works — click, mousedown+click, Enter. What failed was TARGETING: the menu renders in a portal, so
    // "the open panel near this control" was sometimes the phone field's country list. Hence adapters
    // that identify rows by the library's own ids rather than by proximity.
    const displayOf = (el) => {
      const d = el.querySelector('[class*="select__control"], [class*="selection-item"], [class*="single-value"], [class*="selected-value"]');
      return ((d || el).textContent || "").replace(/\s+/g, " ").trim();
    };
    const isPlaceholder = (t) => !t || /^(select(\s+(one|an option|a value))?|choose(\s+one)?|please select|pick one|--+|—|-)\s*(\.{3}|…)?$/i.test(t);
    const setNativeValue = (el, v) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const clickRow = async (row) => {
      row.scrollIntoView && row.scrollIntoView({ block: "nearest" });
      for (const t of ["mousedown", "mouseup", "click"]) row.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0 }));
      await wait(220);
    };
    const bestRow = (rows) => rows.map((o) => ({ o, s: scoreOpt(o), len: (o.textContent || "").trim().length }))
      .filter((x) => x.s >= 2).sort((a, b) => (b.s - a.s) || (a.len - b.len))[0];

    const ADAPTERS = [
      {
        // react-select (Greenhouse, Lever and many SaaS forms). The host we collect IS its search input;
        // its control box is the ancestor, and its rows carry ids "react-select-<name>-option-N".
        name: "react-select",
        find: (el) => {
          const input = (el.tagName === "INPUT" && /select__input/.test(String(el.className || ""))) ? el
            : el.querySelector('input[class*="select__input"]');
          const control = input && input.closest('[class*="select__control"]');
          return control ? { input, control } : null;
        },
        run: async ({ input, control }) => {
          for (const t of ["pointerdown", "mousedown", "mouseup", "click"]) control.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0 }));
          try { input.focus(); } catch (_) { /* ignore */ }
          await wait(320);
          const prefix = (input.getAttribute("aria-controls") || "").replace(/-listbox$/, "");
          const own = () => (prefix ? [...deepQSA('[id^="' + prefix + '-option-"]')] : []).filter((o) => (o.textContent || "").trim());
          let choice = bestRow(own());
          if (!choice) {
            for (const term of cands.slice().sort((a, b) => String(b).length - String(a).length).slice(0, 2)) {
              setNativeValue(input, String(term));
              await wait(320);
              choice = bestRow(own());
              if (choice) break;
            }
          }
          if (choice) await clickRow(choice.o);
          const ok = !isPlaceholder(displayOf(control));
          if (!ok) {                                            // leave nothing typed behind
            setNativeValue(input, "");
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          }
          return ok;
        },
      },
      {
        // Ant Design / rc-select (Dayforce and much of the enterprise web). Opens on its selector box;
        // its rows live in a panel the input points at via aria-controls / aria-owns.
        name: "ant",
        find: (el) => {
          const host = el.closest('.ant-select, [class*="ant-select"]') || (/ant-select/.test(String(el.className || "")) ? el : null);
          if (!host) return null;
          const control = host.querySelector('[class*="selector"]') || host;
          const input = host.querySelector("input");
          return { host, control, input };
        },
        run: async ({ host, control, input }) => {
          for (const t of ["pointerdown", "mousedown", "mouseup", "click"]) control.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0 }));
          try { (input || control).focus(); } catch (_) { /* ignore */ }
          await wait(320);
          const id = input && (input.getAttribute("aria-controls") || input.getAttribute("aria-owns"));
          const panel = (id && document.getElementById(id)) || host.querySelector('[class*="select-dropdown"]');
          const own = () => panel ? [...panel.querySelectorAll('[class*="item-option"], [role="option"]')].filter((o) => (o.textContent || "").trim()) : [];
          let choice = bestRow(own());
          if (!choice && input) {
            for (const term of cands.slice().sort((a, b) => String(b).length - String(a).length).slice(0, 2)) {
              setNativeValue(input, String(term));
              await wait(300);
              choice = bestRow(own());
              if (choice) break;
            }
          }
          if (choice) await clickRow(choice.o);
          const ok = !isPlaceholder(displayOf(host));
          if (!ok && input) { setNativeValue(input, ""); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }
          return ok;
        },
      },
    ];

    for (const ad of ADAPTERS) {
      let ctx = null;
      try { ctx = ad.find(h); } catch (_) { ctx = null; }
      if (!ctx) continue;
      let ok = false;
      try { ok = await ad.run(ctx); } catch (_) { ok = false; }
      if (_diag) _chooserLog.push({ adapter: ad.name, label: String(label || "").slice(0, 26), want: String(value).slice(0, 20), ok });
      if (ok) { filled++; markFilled(h); return; }
      break;   // the technology is known but its adapter did not commit — do not let another one guess
    }


    try {
      // WHICH element opens the widget differs by library: many open on the SELECTOR/control box and
      // ignore a click on their inner search input (that input only becomes live once the list is
      // already open). Clicking the input first therefore left some widgets closed, we then read zero
      // options and gave up — State/Province stayed empty for exactly this reason. So try each plausible
      // opener in turn and VERIFY by looking for options, instead of assuming the first one worked.
      const openerCands = [
        h.querySelector('[class*="selector"], [class*="control"], [class*="selection"], [class*="toggle"], [class*="trigger"]'),
        h.querySelector('[role="combobox"]'),
        h.querySelector("input"),
        h,
      ].filter((x, i, a) => x && a.indexOf(x) === i);
      let opener = openerCands[0] || h;
      const poke = (el) => {
        for (const t of ["pointerdown", "mousedown", "mouseup", "click"]) {
          try { el.dispatchEvent(t.startsWith("pointer") ? new Event(t, { bubbles: true }) : new MouseEvent(t, { bubbles: true })); } catch (_) { /* ignore */ }
        }
        try { el.focus && el.focus(); } catch (_) { /* ignore */ }
        // ARIA comboboxes that ignore clicks open on ArrowDown.
        try { el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); } catch (_) { /* ignore */ }
      };
      // Read options from THIS widget's own popup. The selectors below ("menu-item", "dropdown-item")
      // also match site navigation, and an unscoped read scored a site's nav menu ("Search Jobs",
      // "Recommended Jobs") as if it were the State list — so the real list was never seen and the field
      // stayed empty. Prefer the panel the widget POINTS AT (aria-controls / aria-owns), then a visible
      // listbox panel, and never accept anything inside site chrome.
      const OPT_SEL = '[role="option"], .ng-option, mat-option, .ant-select-item-option, .p-dropdown-item, ' +
        'li[role="option"], [class*="option"]:not([class*="options"]), [class*="dropdown-item"], [class*="menu-item"]';
      const panelOf = () => {
        const id = opener.getAttribute && (opener.getAttribute("aria-controls") || opener.getAttribute("aria-owns"));
        const byId = id && document.getElementById(id);
        if (byId) return byId;
        const panels = [...deepQSA('[role="listbox"], [class*="select-dropdown"]:not([class*="hidden"]), .ng-dropdown-panel, [class*="dropdown-menu"]:not([hidden])')]
          .filter((x) => x.offsetParent !== null && x.querySelector(OPT_SEL));
        return panels[panels.length - 1] || null;
      };
      const readOpts = () => {
        const panel = panelOf();
        const list = panel ? [...panel.querySelectorAll(OPT_SEL)] : [...deepQSA(OPT_SEL)];
        return list.filter((o) => o.offsetParent !== null && (o.textContent || "").trim() &&
          !o.closest('nav, header, [role="menubar"], [role="navigation"]'));
      };
      // Open it: try each candidate opener until options actually appear.
      for (const cand of openerCands) {
        opener = cand;
        poke(cand);
        await wait(220);
        if (readOpts().length) break;
      }
      // Ties are broken by CLOSENESS to the value, not by list order: "United States" prefix-matches
      // both "United States of America" and "United States Minor Outlying Islands", and taking the first
      // gave a US applicant the Minor Outlying Islands — which then left State/Province empty, because
      // these forms derive the state list from the chosen country.
      const closeness = (o) => {
        const ot = n2((o.textContent || "").trim());
        let d = Infinity;
        for (const cv of cands) { const c = n2(cv); if (c) d = Math.min(d, Math.abs(ot.length - c.length)); }
        return d;
      };
      const bestOf = (list) => {
        let o = null, b = 0, d = Infinity;
        for (const x of list) {
          const s = scoreOpt(x); if (!s) continue;
          const c = closeness(x);
          if (s > b || (s === b && c < d)) { b = s; o = x; d = c; }
        }
        return { o, b };
      };
      // Match among the options shown ON OPEN — WITHOUT speculative typing. Typing a guessed value
      // (a name the concept mis-picked) into a Yes/No question box is exactly how "Mysore" landed in
      // a "government official?" dropdown. Only require a real EXACT/PREFIX match (score >= 2), never
      // a loose containment, so a wrong guess simply selects nothing.
      // A DEPENDENT list (State from Country, City from State, Model from Make) is refetched when its
      // parent changes — and we usually set the parent moments ago, so the list can still be empty or a
      // stub. If it looks unpopulated, wait and re-open once before judging it. Keyed off "the list is
      // suspiciously small", never off which field this is.
      if (readOpts().length < 5) {
        await wait(800);
        opener.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        opener.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        if (opener.click) opener.click();
        await wait(400);
      }
      const initial = readOpts();
      let { o: opt, b: best } = bestOf(initial);
      // Only if the widget reveals NO options until you type (a search-to-filter list) do we type —
      // and then still require a real match, and CLEAR the box if nothing matches (no leftover text).
      // A DIAL-CODE list is the other case that must type: it holds every country in the world and is
      // VIRTUALISED, so only the first handful of rows exist in the DOM — the user's row is simply not
      // there to be matched, and whatever we pick comes from the alphabetical head of the list (this is
      // how a US user ended up with Antigua). Typing the country name filters it to a few real rows,
      // which also leaves the list filtered if the user opens it to check.
      const mustFilterDial = dialWanted && best < 3 && countryTokens().length > 0;
      // Long lists (countries, states, dialling codes) are virtualised or simply huge, so the row we want
      // is often not rendered and a weaker rendered row wins. Whenever we do not already hold an EXACT
      // match and the widget offers a search box, type the value to filter, then re-score.
      if (best < 3 || (best < 2 && initial.length === 0) || mustFilterDial) {
        const box = h.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio])')
          || document.querySelector('.ng-dropdown-panel input, [class*="dropdown"] input, [role="listbox"] input');
        if (box) {
          const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          const clearBox = async () => {
            setV.call(box, "");
            box.dispatchEvent(new Event("input", { bubbles: true }));
            await wait(160);
          };
          const search = async (term) => {
            box.focus(); setV.call(box, term);
            box.dispatchEvent(new Event("input", { bubbles: true }));
            box.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
            await wait(260);
            const rows = readOpts();
            // A term the widget cannot search on (Dayforce filters by NAME, so "+1" matches nothing)
            // leaves it showing "no data" — and a widget left in that state accepts nothing afterwards.
            // Undo it before trying the next term, so a failed attempt costs nothing.
            if (!rows.length) { await clearBox(); return { o: null, b: 0 }; }
            return bestOf(rows);
          };
          // For a DIAL list, narrow by the CODE FIRST ("+1" → only the +1 countries, which is the set
          // the user cares about), then by the country NAME if the widget doesn't search on codes or
          // the code alone still leaves the right row out of reach. Each attempt stops the moment we
          // have a country-specific match (score 3), so we type as little as possible.
          // Otherwise search by the value itself, longest candidate first ("North Carolina" before "NC",
          // "United States" before "US") — the longer term filters hardest and is what these lists index.
          const terms = mustFilterDial
            ? ["+" + dialWanted, dialWanted, String(atoms.country || atoms.nationality)]
            : cands.slice().sort((a, b) => String(b).length - String(a).length).slice(0, 2);
          for (const term of terms) {
            if (!term) continue;
            const after = await search(term);
            if (after.b >= best) ({ o: opt, b: best } = after);  // filtering must never LOSE a match
            if (best >= 3) break;                                 // exact country row in hand — stop typing
          }
          if (best < 2) await clearBox(); // nothing matched — leave no typed text behind
        }
      }
      // Chooser widgets write nothing to a value attribute, so a failed one leaves no trace to inspect
      // afterwards. Under OPTS.diag, record what each widget was offered and what it chose.
      if (_diag) _chooserLog.push({ label: String(label || "").replace(/\s+/g, " ").trim().slice(0, 30),
        want: String(value).slice(0, 22), rows: initial.length, rowsNow: readOpts().length,
        sample: readOpts().slice(0, 3).map((o) => (o.textContent || "").trim().slice(0, 18)),
        best, chose: opt ? (opt.textContent || "").trim().slice(0, 28) : null });
      if (best >= 2 && opt) {
        opt.scrollIntoView && opt.scrollIntoView({ block: "nearest" });
        opt.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        opt.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        if (opt.click) opt.click();
        filled++; markFilled(h);
        await wait(80);
      } else {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        opener.blur && opener.blur();
        // Remember the LABEL, not the element: selecting the parent (Country) makes these frameworks
        // re-render the dependent widget, so the node we hold is detached by the time we retry.
        _chooserRetry.push(String(label || "").trim());
      }
    } catch (_) { /* leave this widget alone on any error */ }
  };

  for (const h of hosts) {
    if (seen.has(h) || [...seen].some((s) => s.contains(h) || h.contains(s))) {
      if (_diag) _chooserLog.push({ skipped: "nested", label: String(labelOf(h)).replace(/\s+/g, " ").trim().slice(0, 40) });
      continue;
    }
    seen.add(h);
    await fillChooser(h);
  }

  // ONE targeted retry, only for the widgets that ended up with nothing. A chooser whose options are
  // DERIVED from another field (State from Country, City from State, Model from Make) is refetched when
  // that parent changes — which we did moments earlier — so its list can be empty on the first attempt
  // and full a second later. Only the failures are revisited: a widget that already holds a value is
  // never touched again, which is what stopped an earlier blanket second pass from overwriting good
  // answers with whatever the list re-rendered.
  // Retry ONLY a list that depends on another field (State on Country, City on State): those are empty
  // on the first look because we set the parent moments earlier, and a second attempt genuinely helps.
  // Retrying everything else cost 7.5 SECONDS of re-opening dropdowns on a live form — the visible
  // "dancing" — and never changed an answer, because a widget that gave a definite answer the first
  // time gives the same one again.
  const DEPENDENT = /state|province|region|city|town|district|county|area/i;
  const retryable = [...new Set(_chooserRetry.filter((l) => DEPENDENT.test(l)))];
  if (retryable.length) {
    await wait(500);
    const pending = new Set(retryable);
    _chooserRetry.length = 0;                       // one retry per fill, never a loop
    for (const h of chooserHosts()) {
      try {
        if (!pending.has(String(labelOf(h) || "").trim())) continue;
        await fillChooser(h);
      } catch (_) { /* a retry must never break the fill */ }
    }
  }

  // ---- SAVED ANSWERS: screening / eligibility / EEO questions (radio, checkbox, <select>) ----------
  // These are legal/eligibility/self-ID declarations — we NEVER guess them. We ONLY select an option
  // the user pre-set in "Common answers" (OPTS.savedAnswers, keyed by the canonical id below). Each
  // library entry: a question matcher `q`, and `opts` mapping each canonical answer token to a regex
  // that finds the matching OPTION by its visible label. `multi` = a checkbox set (e.g. race).
  const SAVED = OPTS.savedAnswers || {};
  const YESNO = { yes: /^\s*yes\b/, no: /^\s*no\b/ };
  // Intent patterns are deliberately BROAD so the SAME question, worded many ways, maps to one intent —
  // that is what lets a single captured answer fill every phrasing. `q` matches the on-page question (or
  // a vault key); `opts` maps each answer token to the option-label regex.
  const QA_LIBRARY = [
    { key: "work_auth_us", q: /(authoriz|eligib|legal|permitted|entitled|right)\w*\W+(to\W+)?(work|employ|be employed).*(united states|u s a|u s\b|\busa\b|\bus\b|america)|work authoriz\w*.*(u s|us|united states|america)/, opts: YESNO },
    { key: "work_auth_ca", q: /(authoriz|eligib|legal|permitted|entitled|right)\w*\W+(to\W+)?(work|employ).*canada|work authoriz\w*.*canada/, opts: YESNO },
    { key: "sponsorship", q: /(require|need|seek|request|now or.*future).{0,40}(sponsor|visa)|visa sponsorship|immigration sponsorship|sponsorship.{0,20}(work|employ|visa|status)/, opts: YESNO },
    { key: "clearance", q: /security clearance|dod clearance|\bclearance\b/, opts: YESNO },
    { key: "gov_employee", q: /government employee|federal employee|public sector employee/, opts: YESNO },
    { key: "felony", q: /(convicted|conviction|felony|criminal (record|history|convict)|pleaded guilty)/, opts: YESNO },
    { key: "over18", q: /(18 years|eighteen years|at least 18|over 18|age of 18|legal working age)/, opts: YESNO },
    { key: "relocate", q: /relocat|willing to move|open to moving/, opts: YESNO },
    // "Are you able to work onsite in one of our offices?" / "…in the office 3 days a week?" is asked on
    // most hybrid roles and is NOT the same question as relocating, so it needs its own saved answer.
    { key: "onsite", q: /work (on.?site|in.?office|from (the|our) office)|able to (commute|be on.?site)|on.?site in one of|in the office d|hybrid (work|schedule|model)/, opts: YESNO },
    { key: "proof_identity", q: /proof of.*(identity|authoriz|eligib)|present proof|form i.?9|right to work document/, opts: YESNO },
    { key: "restrictions", q: /restrictions? limiting|restrictive covenant|non.?compete|non.?solicit|\bnda\b|confidentiality agreement|agreements? with.*(current|prior|former)? ?employer/, opts: YESNO },
    { key: "hispanic", q: /hispanic|latino|latina|latinx/, opts: YESNO },
    { key: "veteran", q: /veteran|armed forces|military service/, opts: {
      yes: /\bi am a\b.*veteran|^\s*yes|protected veteran|is a veteran|identify as a veteran/, no: /not a\b.*veteran|am not|^\s*no|do not identify/, decline: /decline|prefer not|wish not|not.*(identify|answer|disclose)|do not wish/ } },
    { key: "disability", q: /disab(ility|led|ilities)|self.?identif.*disab/, opts: {
      // NEGATION-AWARE: "no" if any negation appears anywhere in the answer; "yes" only if a disability
      // is asserted with NO negation anywhere (so "I do NOT have ANY disability" is 'no', not 'yes').
      no: /\b(no|not|never|without|don'?t|doesn'?t|do not|does not)\b|not disabled/,
      yes: /^(?!.*\b(no|not|never|without|don'?t|doesn'?t|decline)\b).*(have|has|am|is|a)\b.*disab|^\s*yes\b/,
      decline: /decline|prefer not|do not.*(specify|answer|disclose)|do not wish|not to answer/ } },
    { key: "gender", q: /\bgender\b|\bsex\b|gender identity/, opts: {
      male: /^\s*male\b|^\s*man\b|\bhe\b/, female: /^\s*female\b|^\s*woman\b|\bshe\b/, nonbinary: /non.?binary|genderqueer|third gender/, decline: /decline|prefer not|not.*(identify|answer|disclose)/ } },
    { key: "race", multi: true, q: /\brace\b|ethnicit|ethnic (group|origin)/, opts: {
      // No TRAILING \b: option titles often run straight into their description with no space
      // ("Asian" + "Not Hispanic…" → "asiannot…"), which \basian\b would miss. The LEADING \b still
      // prevents matching "cauc-asian" (White).
      white: /white|caucasian/, hispanic: /hispanic|latino|latina/, black: /black|african american|african.american/, asian: /\basian/,
      native_american: /american indian|alaska(n)? native|native american/, mena: /middle eastern|north african/,
      pacific: /hawaiian|pacific islander/, other: /other race|other ethnic|two or more|multiracial/, decline: /prefer not|decline|not.*(answer|disclose)/ } },
  ];
  const qaMatch = (q) => { const n = norm(q); for (const e of QA_LIBRARY) if (e.q.test(n)) return e; return null; };
  // SMART LAYER: map each library INTENT to the user's answer, derived from ANY captured vault entry
  // about that intent (its KEY matches the intent, its VALUE maps to an answer token). This is what lets
  // a single captured answer fill EVERY phrasing of the same question — the on-page wording need not
  // match the wording that was captured; only the shared intent matters.
  const intentAnswer = {};
  // CITIZENSHIP implies the eligibility answers. A US citizen IS authorised to work in the US without
  // restriction and does NOT need sponsorship — asking them to answer that on every application, and
  // leaving the field blank until they do, is the engine failing to use what it already knows. Same for
  // a Canadian citizen on a Canadian form. This is a derivation from the user's own stored fact, not a
  // guess about a legal status we do not have: with no citizenship stored, nothing is derived.
  (() => {
    const cz = Object.entries(rawVault)
      .filter(([k]) => /citizen|nationality|country of citizenship/i.test(k))
      .map(([, v]) => String(v == null ? "" : v).toLowerCase())
      .join(" ");
    if (!cz) return;
    const isUS = /\b(us|u\.s\.|usa|united states|american)\b/.test(cz);
    const isCA = /\b(ca|canada|canadian)\b/.test(cz);
    if (isUS) { intentAnswer.work_auth_us = "yes"; intentAnswer.sponsorship = "no"; }
    if (isCA) { intentAnswer.work_auth_ca = "yes"; intentAnswer.sponsorship = "no"; }
  })();
  for (const key of Object.keys(rawVault)) {
    const e = qaMatch(key); if (!e) continue;
    const val = String(rawVault[key] == null ? "" : rawVault[key]).toLowerCase().trim();
    if (!val) continue;
    for (const tok of Object.keys(e.opts)) {
      if (e.opts[tok].test(val)) intentAnswer[e.key] = e.multi ? ((intentAnswer[e.key] ? intentAnswer[e.key] + "," : "") + tok) : tok;
      if (!e.multi && intentAnswer[e.key]) break;
    }
    // A bare Yes/No value under a YES/NO intent (opts are ^yes/^no) is already handled above.
  }
  // The visible label of an option control — a real <input> OR an ARIA role widget.
  const ctrlLabel = (c) => {
    let t = c.getAttribute("aria-label") || c.getAttribute("data-value") || "";
    if (!t && c.id) { const l = document.querySelector(`label[for="${(window.CSS && CSS.escape) ? CSS.escape(c.id) : c.id}"]`); if (l) t = l.textContent; }
    if (!t) { const l = c.closest("label"); if (l) t = l.textContent; }
    if (!t && c.parentElement && c.parentElement.querySelector) { const l = c.parentElement.querySelector("label"); if (l) t = l.textContent; } // SIBLING label (input + label side by side)
    if (!t && c.tagName !== "INPUT") t = c.textContent || "";     // role widget: its own text is the label
    if (!t && c.parentElement) t = c.parentElement.textContent || "";
    if (!t && c.tagName === "INPUT" && (c.type === "radio" || c.type === "checkbox")) t = c.value || ""; // value often IS the option
    return t.replace(/\s+/g, " ").trim();
  };
  // The QUESTION a control belongs to. Custom widgets rarely use <fieldset><legend>, and the heading is
  // often a plain <div>/<span> that is a SIBLING of the option rows — so we climb and collect every
  // DIRECT-CHILD element that is NOT itself a control container (those hold an input) and whose text is
  // short. Joining them lets the library regex find "veteran"/"race"/etc. wherever it sits, without
  // mistaking an option caption ("White") for the question (option rows are skipped — they contain inputs).
  const ctrlQuestion = (c) => {
    const parts = [c.name, c.getAttribute("aria-label"), c.getAttribute("data-question")].filter(Boolean);
    let node = c;
    for (let i = 0; i < 5 && node; i++) {
      node = node.parentElement; if (!node) break;
      const lb = node.getAttribute && node.getAttribute("aria-labelledby");
      if (lb) { const el = document.getElementById(lb); if (el) parts.push(el.textContent || ""); }
      for (const ch of node.children || []) {
        if (ch === c || ["INPUT", "SELECT", "TEXTAREA", "SCRIPT", "STYLE"].includes(ch.tagName)) continue;
        if (ch.querySelector && ch.querySelector('input, select, textarea, [role="radio"], [role="checkbox"], [role="switch"]')) continue; // an option row / control
        const t = (ch.textContent || "").replace(/\s+/g, " ").trim();
        if (t && t.length <= 160) parts.push(t);
      }
    }
    return parts.join(" · ");
  };
  const isChk = (c) => (c.tagName === "INPUT") ? !!c.checked : c.getAttribute("aria-checked") === "true";
  // Force a REAL <input>'s checked state in a way React notices: set via the prototype's native setter
  // (updates React's value tracker) THEN fire input+change (React's onChange reads target.checked). A
  // plain c.checked=true is silently reverted on the next React render — this is why a highlighted radio
  // showed unselected.
  const fireClick = (el) => {
    if (!el) return;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    if (el.click) el.click();
  };
  const forceChecked = (input) => {
    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked").set;
      setter ? setter.call(input, true) : (input.checked = true);
    } catch (_) { input.checked = true; }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const setChk = (c) => {
    try {
      if (isChk(c)) return true;
      const isCheckbox = c.type === "checkbox" || c.getAttribute("role") === "checkbox";
      // Elements the site may bind its handler to: the associated/sibling/wrapping <label>, the row.
      const label = (c.id && document.querySelector(`label[for="${(window.CSS && CSS.escape) ? CSS.escape(c.id) : c.id}"]`))
        || (c.parentElement && c.parentElement.querySelector && c.parentElement.querySelector("label"))
        || c.closest("label");
      const wrap = c.closest('[class*="radio"], [class*="checkbox"], [class*="option"], [role="radio"], [role="checkbox"], li');
      if (isCheckbox) {
        // A checkbox TOGGLES on each click — click exactly one target, then ensure the state stuck.
        fireClick(label || wrap || c);
        if (c.tagName === "INPUT" && !c.checked) forceChecked(c);
        else if (c.tagName !== "INPUT") c.setAttribute("aria-checked", "true");
      } else {
        // A radio is idempotent — drive the INPUT itself (native selection + React onChange) AND the
        // label/row the site may listen on, so it selects regardless of where the handler lives.
        if (c.tagName === "INPUT") { fireClick(c); forceChecked(c); } else { fireClick(c); c.setAttribute("aria-checked", "true"); }
        if (label && label !== c) fireClick(label);
        if (wrap && wrap !== c && wrap !== label) fireClick(wrap);
      }
      markFilled(c.closest("label") || c.parentElement || c);
      return true;
    } catch (_) { return false; }
  };
  // Rendered? A custom control HIDES the real <input> (sr-only / opacity) behind a styled element, so
  // check the label/wrapper too — never require the input ITSELF to be visible or we'd skip it.
  const shownCtrl = (c) => {
    if (c.offsetParent !== null) return true;
    const b = c.closest("label") || c.parentElement;
    return !!(b && (b.offsetParent !== null || (b.getClientRects && b.getClientRects().length)));
  };
  // ---- GENERIC answer helpers (used by the radio/checkbox + <select> passes below) ----------------
  const toks = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 1));
  const QA_STOP = new Set(("are you to the a an of in on at is be am do does did have has had will would " +
    "can could should i my me your our we they it that this these those and or for with as by not no yes " +
    "which most accurately describes please select any all if").split(" "));
  const meaningful = (s) => [...toks(s)].filter((w) => !QA_STOP.has(w));
  // The answer the user CAPTURED for a question: the value of the vault key whose DISTINCTIVE tokens
  // (stopwords removed) are essentially all present in the question. Key-gated and disambiguating — the
  // US work-auth key won't answer the Canada question (its "united states" is absent there), and a
  // stray "Yes" value never leaks. Fully generic: works for ANY captured question, not a fixed list.
  const vaultAnswerFor = (question) => {
    const qt = toks(question); if (!qt.size) return null;
    let best = null, bestScore = 0;
    for (const key of Object.keys(rawVault)) {
      const km = meaningful(key); if (km.length < 1) continue;
      let s = 0; for (const w of km) if (qt.has(w)) s++;
      const missing = km.length - s;
      if (s >= 1 && missing <= Math.floor(km.length * 0.34) && s > bestScore) { bestScore = s; best = rawVault[key]; }
    }
    return best == null ? null : String(best);
  };
  // The option/element whose LABEL best matches a target answer (token overlap), or null if no
  // confident winner. Tolerates wording differences ("I do not have ANY disability" vs "…A disability").
  const bestByTokens = (items, labelOfItem, value) => {
    const vt = toks(value); if (!vt.size) return null;
    let best = null, bs = 0, second = 0;
    for (const it of items) {
      const ot = toks(labelOfItem(it)); let s = 0; for (const w of vt) if (ot.has(w)) s++;
      if (s > bs) { second = bs; bs = s; best = it; } else if (s > second) second = s;
    }
    return (best && bs > second && (bs >= 2 || (vt.size <= 2 && bs >= vt.size))) ? best : null;
  };
  const splitAns = (v) => String(v).split(/[,;/]|\bor\b|\band\b/i).map((s) => s.trim()).filter(Boolean);
  // Match a stored value to one of a <select>'s options, GENERICALLY:
  //   1) token overlap (bestByTokens);
  //   2) ACRONYM/initials — derived, no table: value letters == an option's word-initials, and vice
  //      versa ("NC" ⇄ "North Carolina", "USC/GC/PR" style codes);
  //   3) a compact abbreviation REFERENCE for codes that spelling can't derive (CA=California). This is
  //      reference data (like the app's synonym tables), a last-resort fallback — not per-form logic.
  const US_STATES = { al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming", dc: "district of columbia" };
  const acronymOf = (s) => norm(s).split(" ").filter(Boolean).map((w) => w[0]).join("");
  const selectOption = (opts, value) => {
    if (value == null || value === "") return null;
    let o = bestByTokens(opts, (x) => x.textContent || "", value);
    if (o) return o;
    const nv = norm(value).trim();
    const letters = nv.replace(/[^a-z]/g, "");
    // acronym both directions
    if (letters.length >= 2 && letters.length <= 5) {
      for (const x of opts) if (acronymOf(x.textContent) === letters) return x;                 // "NC" -> "North Carolina"
    }
    if (nv.split(" ").filter(Boolean).length >= 2) {
      const acr = acronymOf(nv);
      for (const x of opts) if (norm(x.textContent).replace(/[^a-z]/g, "") === acr) return x;    // "North Carolina" -> option "NC"
    }
    const exp = US_STATES[letters] || US_STATES[nv];                                             // reference fallback (CA=California)
    if (exp) { o = bestByTokens(opts, (x) => x.textContent || "", exp); if (o) return o; }
    return null;
  };
  // A stored VALUE that is (essentially) one of this option's caption — typo-proof direct match, used
  // when the question KEY is misspelt so key-matching misses it (e.g. "race_ethhicity" → value "Asian").
  const valueMatchesOption = (optLabel) => {
    const ot = toks(optLabel); if (!ot.size) return false;
    return Object.values(rawVault).some((v) => {
      const st = toks(String(v == null ? "" : v)); if (!st.size) return false;
      let sh = 0; for (const w of ot) if (st.has(w)) sh++;
      return sh >= 1 && (sh === ot.size || sh === st.size); // one caption fully contains the other
    });
  };
  const CTRL_SEL = 'input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"], [role="switch"]';
  // The container that holds a whole question's options: the nearest ancestor holding >=2 controls (a
  // fieldset / radiogroup / the repeated option rows' common parent). ALL options of one question share
  // it — so we group by it, NOT by per-option text (which made every option its own group and got them
  // all ticked).
  const groupContainerOf = (c) => {
    let node = c.parentElement, container = c.closest('[role="radiogroup"], fieldset') || c.parentElement;
    for (let i = 0; i < 6 && node; i++) {
      if (node.querySelectorAll && node.querySelectorAll(CTRL_SEL).length >= 2) { container = node; break; }
      node = node.parentElement;
    }
    return container || c.parentElement || c;
  };
  // The question for a GROUP container: heading text from its own direct-child headings (inside the
  // group) and its ancestors' direct-child headings (a heading that is a sibling of the group) — never
  // the option rows (they contain a control), so an option caption can't pollute the question.
  const groupQuestion = (container, sample) => {
    const parts = [sample && sample.name, sample && sample.getAttribute("aria-label")].filter(Boolean);
    let node = container;
    for (let i = 0; i < 5 && node; i++) {
      const lb = node.getAttribute && node.getAttribute("aria-labelledby");
      if (lb) { const el = document.getElementById(lb); if (el) parts.push(el.textContent || ""); }
      for (const ch of node.children || []) {
        if (["INPUT", "SELECT", "TEXTAREA", "SCRIPT", "STYLE"].includes(ch.tagName)) continue;
        if (ch.querySelector && ch.querySelector(CTRL_SEL)) continue; // an option row / control container
        const t = (ch.textContent || "").replace(/\s+/g, " ").trim();
        if (t && t.length <= 160) parts.push(t);
      }
      node = node.parentElement;
    }
    return parts.join(" · ");
  };

  if (Object.keys(SAVED).length || Object.keys(rawVault).length) {
    const controls = [...deepQSA(CTRL_SEL)]
      .filter((c) => !(c.disabled || c.getAttribute("aria-disabled") === "true") && shownCtrl(c));
    // Group all options of a question together by their shared container.
    const groups = new Map();
    for (const c of controls) {
      const container = groupContainerOf(c);
      if (!groups.has(container)) groups.set(container, { q: groupQuestion(container, c), list: [] });
      groups.get(container).list.push(c);
    }
    for (const { q, list } of groups.values()) {
      const groupMulti = list.some((c) => c.type === "checkbox" || c.getAttribute("role") === "checkbox");
      if (!groupMulti && list.some(isChk)) continue; // a radio already answered — leave it
      let did = false;
      const entry = qaMatch(q);
      // A) INTENT answer: the user's explicit "Common answers" pick, else the answer captured for this
      // intent from ANY vault entry — so it fills regardless of how THIS form worded the question.
      const intentPick = entry && (SAVED[entry.key] != null && SAVED[entry.key] !== "" ? SAVED[entry.key] : intentAnswer[entry.key]);
      if (entry && intentPick != null && intentPick !== "") {
        const tokens = entry.multi ? String(intentPick).split(/[,;]+/).map((s) => s.trim()).filter(Boolean) : [String(intentPick)];
        for (const tok of tokens) {
          const re = entry.opts[tok]; if (!re) continue;
          const hit = list.find((c) => re.test(ctrlLabel(c).toLowerCase()));
          if (hit && !isChk(hit) && setChk(hit)) { filled++; did = true; }
          if (!entry.multi) break;
        }
      }
      // B) GENERIC: the answer the user CAPTURED for THIS question (vault key ~ question) → the option
      // whose label best matches that stored answer. Any question, any wording — no fixed list.
      if (!did || groupMulti) {
        const captured = vaultAnswerFor(q);
        if (captured) {
          for (const target of (groupMulti ? splitAns(captured) : [captured])) {
            const opt = bestByTokens(list.filter((c) => !isChk(c)), ctrlLabel, target);
            if (opt && setChk(opt)) { filled++; did = true; if (!groupMulti) break; }
          }
        }
      }
      // C) GENERIC (typo-proof): a specific option (>=4 chars, not bare Yes/No) whose caption a stored
      // VALUE equals — catches questions whose captured KEY is misspelt so B missed them.
      if (!did || groupMulti) {
        for (const c of list) {
          if (isChk(c)) continue;
          const ol = ctrlLabel(c).toLowerCase().trim();
          if (ol.length < 4 || /^(yes|no|n\/a|na)$/.test(ol)) continue;
          if (valueMatchesOption(ol) && setChk(c)) { filled++; did = true; if (!groupMulti) break; }
        }
      }
    }
    // Native <select> versions (some forms use a dropdown for gender/veteran/eligibility/etc.).
    for (const sel of deepQSA("select")) {
      if (sel.disabled || sel.value) continue;
      const q = ariaLabelText(sel) + " " + ctrlQuestion(sel) + " " + ownLabel(sel); // aria-labelledby holds the question on iCIMS
      const opts = [...sel.options].filter((o) => o.value && (o.textContent || "").trim());
      let opt = null;
      const eduCtx = edu.length && inEduContext(sel); // education dropdowns: router only, never generic guessing
      const entry = qaMatch(q);
      // INTENT answer (Common answers OR the answer captured for this intent) → the option matching it.
      if (!eduCtx && entry) {
        const pick = (SAVED[entry.key] != null && SAVED[entry.key] !== "") ? SAVED[entry.key] : intentAnswer[entry.key];
        if (pick != null && pick !== "") {
          for (const tok of (entry.multi ? String(pick).split(/[,;]+/).map((s) => s.trim()).filter(Boolean) : [String(pick)])) {
            const re = entry.opts[tok]; if (!re) continue;
            const o = opts.find((oo) => re.test((oo.textContent || "").toLowerCase()));
            if (o) { opt = o; break; } // a single <select> holds one answer
          }
        }
      }
      // A dropdown the CONCEPT layer already owns (country, state, dialling code…) must not be
      // re-decided here by fuzzy token matching: that path matched the stored "America" to the option
      // "American Samoa" — a real answer, on a real application, for the wrong country. Concepts have
      // canonical names and exact rules; this generic capture path is for questions they don't cover.
      const conceptOwned = (() => {
        let top = 0, key = null;
        for (const c of CONCEPTS) { const sc = score(q, c.syn); if (sc > top) { top = sc; key = c.key; } }
        return top >= 1.5 && ["country", "nationality", "billing_country"].includes(key);
      })();
      if (!opt && !eduCtx && !conceptOwned) { const captured = vaultAnswerFor(q); if (captured) opt = selectOption(opts, captured); }
      if (!opt && eduCtx) { const ev = eduValueFor(sel, q); if (ev != null && String(ev).trim()) opt = selectOption(opts, ev); } // Field of study etc. — only the routed education value
      // EDUCATION-LEVEL dropdown ("What is your highest completed education…" with degree/diploma
      // options): pick the option matching the user's HIGHEST stored qualification. Generic, no capture
      // needed — driven by the parsed education entries (edu[0] is the highest).
      if (!opt && edu.length) {
        const qn = norm(q);
        const optIsEdu = opts.some((o) => /degree|diploma|high school|master|bachelor|doctorate|associate|phd/.test(norm(o.textContent)));
        if (optIsEdu && /educat|degree|diploma|qualif|highest.*(complet|educ|degree)/.test(qn)) {
          // Repeated Education blocks (Workday `educationData[0].degree`, `[1]…`) route to the entry for
          // THAT block; a lone block uses the highest qualification. Same block-index logic as text fields.
          const bi = eduBlockIndex(sel);
          const entry = (bi != null && bi < edu.length) ? edu[bi] : edu[0];
          const lvlRe = { doctorate: /doctorate|phd/, master: /master/, bachelor: /bachelor|undergrad/, diploma: /diploma/, associate: /associate/, highschool: /high school|secondary/ }[entry.level];
          if (lvlRe) opt = opts.find((o) => lvlRe.test(norm(o.textContent)) && !/\bnot\b|did not|\bno |primary|some /.test(norm(o.textContent)));
        }
      }
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("input", { bubbles: true })); sel.dispatchEvent(new Event("change", { bubbles: true })); filled++; markFilled(sel); }
    }

    // ---- SAVED ANSWERS on CUSTOM dropdowns (react-select, Ant, Workday, ng-select…) --------------
    // The two loops above answer a screening question only when it is a radio group, a checkbox set or
    // a native <select>. Every modern ATS renders them as a CUSTOM widget instead — which is why
    // "Are you eligible to work in the United States?", "Do you require sponsorship?", Gender and
    // Veteran status stayed empty on Greenhouse and Workday even with the answers saved.
    // Same contract as everywhere else: we NEVER guess. Only a question the library recognises, only
    // an answer the user has already given (Common answers, or one captured for that intent), and only
    // a row that belongs to THIS widget. A widget whose list lacks that answer is left blank.
    // Answering one react-select makes the framework re-render the WHOLE question list, so every host
    // collected before that click is detached and silently unusable — which is why only the first
    // screening question was ever answered. Re-read the widgets after each answer and work through the
    // questions by IDENTITY (the question text), not by node.
    // The question of a CUSTOM dropdown is rarely inside the widget: the library keeps a hidden input
    // (id "question_123…") and the page carries <label for="question_123…"> beside it. Read that too,
    // or a long question ("If hired, do you now or in the future require visa sponsorship…") is never
    // seen and the answer is never given.
    const chooserQuestion = (h) => {
      let extra = "";
      try {
        const inner = h.querySelector("input, select, textarea") || (h.tagName === "INPUT" ? h : null);
        const id = inner && inner.id;
        if (id) {
          const lab = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
          if (lab) extra += " " + (lab.textContent || "");
        }
        if (inner) extra += " " + ariaLabelText(inner) + " " + (inner.getAttribute("aria-label") || "");
      } catch (_) { /* the plain label below still applies */ }
      return (labelOf(h) + extra).replace(/\s+/g, " ").trim();
    };
    const savedDone = new Set();
    for (let round = 0; round < 12; round++) {
      const fresh = chooserHosts().filter((x) => x.isConnected && !savedDone.has(chooserQuestion(x).slice(0, 80)));
      if (_diag && round === 0) _chooserLog.push({ savedPass: fresh.length, qs: fresh.map((x) => chooserQuestion(x).slice(0, 50)) });
      const h = fresh.find((x) => qaMatch(chooserQuestion(x)));
      if (!h) break;
      savedDone.add(chooserQuestion(h).slice(0, 80));
      try {
        const q = chooserQuestion(h);
        const entry = qaMatch(q);
        if (_diag && !entry) _chooserLog.push({ saved: null, label: String(q).replace(/\s+/g, " ").trim().slice(0, 70) });
        if (!entry) continue;
        const tok = (SAVED[entry.key] != null && SAVED[entry.key] !== "") ? SAVED[entry.key] : intentAnswer[entry.key];
        if (tok == null || tok === "") continue;
        const re = entry.opts[String(tok)];
        if (!re) continue;
        const { input } = await openChooser(h);
        const rows = ownRows(h, input);
        const row = rows.find((r) => re.test((r.textContent || "").replace(/\s+/g, " ").trim().toLowerCase()));
        if (_diag) _chooserLog.push({ saved: entry.key, want: String(tok), label: String(q).replace(/\s+/g, " ").trim().slice(0, 40), rows: rows.length, chose: row ? (row.textContent || "").trim().slice(0, 24) : null });
        if (!row) {                                   // our answer is not on offer — close and move on
          try { input && input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (_) { /* ignore */ }
          continue;
        }
        for (const t of ["mousedown", "mouseup", "click"]) row.dispatchEvent(new MouseEvent(t, { bubbles: true }));
        if (row.click) row.click();
        filled++; markFilled(h);
        await wait(120);
      } catch (_) { /* one stubborn widget must never stop the fill */ }
    }
  }
  // CONTROLLED-INPUT RECONCILE: some frameworks (ADP WorkforceNow especially, some Angular/React setups)
  // treat a bulk `value` set + input event as "not real user input" and RESET the field to their internal
  // (empty) model — the field visibly fills, then snaps back to empty. PROVEN on live ADP (Chrome 151): a
  // raw set sticks, but firing input/change clears it; only real keystrokes register. Filling one field
  // can also reset a previously-set sibling. So after the main pass, re-apply any reverted TEXT field via
  // real keystroke simulation (typeFieldValue) — which those pipelines accept — looping until stable. This
  // is AWAITED (guaranteed before we return) and idempotent; each typed field updates the framework's
  // model so it stops being reset. Generic — no per-site logic. A field the user is editing is left alone.
  if (_keepAlive.length) {
    const reverted = (el, want) => {
      const cur = (el.value || "").trim();
      const wd = String(want).replace(/\D/g, "");
      if (cur === String(want).trim()) return false;
      if (wd && wd.length >= 4) return !cur.replace(/\D/g, "").includes(wd.slice(-4));
      return cur === "";
    };
    for (let pass = 0; pass < 6; pass++) {
      let any = false;
      for (const { el, want } of _keepAlive) {
        try {
          if (el.isConnected && document.activeElement !== el && reverted(el, want)) { any = true; await typeFieldValue(el, want); markFilled(el); }
        } catch (_) { /* keep going */ }
      }
      if (!any) break; // everything held → done (no-op on normal sites: one cheap pass, nothing reverted)
      await wait(120);
    }
    // DETACHED tail: a few frameworks clear the form SECONDS later (loading a saved draft). Watch briefly
    // and re-type once more if that happens. Non-blocking; capped; never touches a focused field.
    const tail = _keepAlive.map((f) => ({ el: f.el, want: f.want, retries: 0, done: false }));
    let ticks = 0;
    const tick = async () => {
      ticks++;
      for (const f of tail) {
        if (f.done) continue;
        try {
          if (!f.el.isConnected) { f.done = true; continue; }
          if (document.activeElement === f.el) continue;
          if (reverted(f.el, f.want)) { if (f.retries++ >= 4) { f.done = true; continue; } await typeFieldValue(f.el, f.want); markFilled(f.el); }
        } catch (_) { /* keep going */ }
      }
      if (ticks < 20 && tail.some((f) => !f.done)) setTimeout(tick, 500);
    };
    setTimeout(tick, 900);
  }
  if (_diag) {
    try {
      const inv = [...deepQSA("input, textarea")].filter((e) => !["hidden", "submit", "button", "reset", "file"].includes(e.type))
        .map((e) => ({ al: e.getAttribute("aria-label") || e.name || e.placeholder || "", type: e.type, value: (e.value || "").slice(0, 18) }));
      // world detector: in the page's MAIN world the extension's `chrome.runtime` is NOT present; in the
      // isolated world it IS. This tells us whether the world:"MAIN" injection actually took effect.
      let world = "UNKNOWN";
      try { world = (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) ? "MAIN" : "ISOLATED"; } catch (_) { world = "MAIN"; }
      window.__ppfDiag = { world, choosers: _chooserLog, framesTop: window.top === window, filled, collected: fields.length, vaultKeys: Object.keys(vault || {}).length, matched: _diag, allInputs: inv };
      console.log("%c[PolyglotFormFill DIAGNOSTIC] copy this whole object:", "font-weight:bold;color:#0a9e8e", window.__ppfDiag);
    } catch (_) { /* diagnostic must never break the fill */ }
  }
  return filled;
}
