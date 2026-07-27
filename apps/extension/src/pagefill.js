// The page-fill function INJECTED into the target tab via chrome.scripting.executeScript.
// It must be fully SELF-CONTAINED (no imports/outer refs) because executeScript serializes
// its source. Kept in its own module so it can be unit-tested under jsdom (see pagefill.test.mjs).
export async function fillPage(vault, tLabels, eduEntries, opts) {
  const OPTS = opts || {};
  const norm = (s) => (s || "").toString()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Za-z])([0-9])/g, "$1 $2") // split camelCase / letter-digit
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
    appdate:  ["date of application", "application date", "today's date", "todays date", "current date", "date of submission", "submission date", "date signed", "signature date", "date of signature", "date of filling", "date filled", "dated", "date of declaration"],
    passport: ["passport", "passport no", "passport number"],
    passport_expiry: ["passport expiry date", "passport expiry", "passport expiration date", "passport expiration", "date of expiry", "expiry date", "expiration date", "expires", "valid until", "date of expiration", "expiry date of passport"],
    passport_issue:  ["passport issue date", "passport issuance date", "passport issuance", "date of issue", "issue date", "issuance date", "date of issuance", "issued on", "valid from", "passport valid from"],
    dl_expiry:       ["dl expiry date", "driver license expiry date", "drivers license expiry date", "driving licence expiry date", "license expiry date", "licence expiry date", "license expiry", "licence expiry", "dl expiry", "dl exp", "license expiration date", "driver license expiration", "licence expiration"],
    dl_issue:        ["dl issue date", "driver license issue date", "drivers license issue date", "driving licence issue date", "license issue date", "licence issue date", "license issue", "licence issue", "dl issue", "licence valid from", "license valid from"],
    organization: ["company", "company name", "organization", "organisation", "employer", "business name", "firm"],
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
    if (hasCcField) return n; // a dedicated country-code field will carry the code
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
  const atomVal = (key) => {
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

  const labelOf = (el) => {
    // The visible caption is often a SIBLING (Angular/React forms rarely use <label for>),
    // and the id can be misspelt (e.g. "passportExpirtyDate"). Read the nearest ancestor's
    // short text so the real, human-visible label is seen — not just the field's own tags.
    let gt = "", a = el.parentElement;
    for (let i = 0; i < 4 && a; i++, a = a.parentElement) {
      const t = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length >= 3 && t.length <= 200) { gt = t; break; }
    }
    return [el.name, el.id, el.placeholder, el.getAttribute("aria-label"),
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
  const hasPlainAddress = [...document.querySelectorAll("input, textarea, select")].some((el) => {
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

  const fields = [];
  let fi = 0; // index aligned with collectFillLabels() so tLabels[fi] is this field's translated label
  for (const el of document.querySelectorAll("input, textarea")) {
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
    if ((el.value || "").trim() !== "" && el.getAttribute("data-ppf-filled") !== "1") { fi++; continue; }
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
    const eduV = eduValueFor(el, label);
    if (eduV != null) { fields.push({ el, label, pick: null, forced: eduV }); continue; }
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
  const setFieldValue = (el, value) => {
    const ro = el.readOnly; if (ro) el.readOnly = false;
    try { el.focus(); } catch (_) { /* ignore */ }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    for (const t of ["keydown", "keypress", "input", "keyup", "change", "blur"]) el.dispatchEvent(new Event(t, { bubbles: true }));
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

  for (const { el, label, pick, forced } of fields) {
    let value;
    if (forced != null) {
      value = forced; // own key / script-qualified name / qualified address, from its vault key
    } else if (pick.kind === "composite") {
      value = compositeValue(pick.cmp);
    } else {
      value = atomVal(pick.key);
    }
    if (!value) continue;
    // A YEAR box (labelled "year"/"YYYY") may only receive a 4-digit year — a street address or any
    // other value must never land in a From/To Year field; pull the year out of a date, else skip.
    const maxL = +el.getAttribute("maxlength") || 0;
    if (/\byear\b|yyyy/.test(norm(label + " " + (el.placeholder || "")))) {
      const y = String(value).match(/\b(1\d{3}|20\d{2})\b/);
      if (!y) continue;      // not a year → leave the box blank rather than fill garbage
      value = y[0];
    } else if (maxL > 0 && String(value).length > maxL && /\D/.test(String(value))) {
      continue;              // value with letters can't fit this short field → a wrong match, skip it
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
      if (setFieldValue(el, formatDateForField(value, el, label))) { filled++; markFilled(el); }
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
  for (const sel of document.querySelectorAll("select")) {
    if (sel.disabled) continue;
    const label = labelOf(sel);
    if (officeUse(ownLabel(sel))) continue; // an office-use dropdown is not the applicant's to set
    let pick = null;
    let value = eduValueFor(sel, label); // education dropdown (Degree, University) → the routed value
    if (value == null) {
      let top = 0;
      for (const c of CONCEPTS) { const s = score(label, c.syn); if (s > top) { top = s; pick = c; } }
      if (!pick || top < 1.5) continue;
      value = pick.kind === "composite" ? compositeValue(pick.cmp) : atomVal(pick.key);
    }
    if (!value) continue;
    // Candidate values to match an option against: the raw value plus expansions (a stored
    // gender "M" should match a "Male" option; "F" -> "Female").
    const cands = [value];
    const g = norm(value);
    if (pick && pick.key === "gender") { if (g === "m" || g === "male") cands.push("male"); if (g === "f" || g === "female") cands.push("female"); }
    // Country abbreviations/demonyms -> full names a <select> lists (USA -> United States).
    const SEL_COUNTRY = {
      usa: ["United States", "United States of America", "America"], us: ["United States"], american: ["United States"],
      uk: ["United Kingdom", "Great Britain"], british: ["United Kingdom"], uae: ["United Arab Emirates"],
    };
    if (SEL_COUNTRY[g]) cands.push(...SEL_COUNTRY[g]);
    if (pick && pick.key === "phonecc") { const d = String(value).replace(/\D/g, ""); if (d) cands.push(d, "+" + d); const cn = atoms.country || atoms.nationality; if (cn) cands.push(String(cn)); }
    const opts = [...sel.options];
    const match = opts.find((o) => cands.some((cv) => optEq(o.textContent, cv) || optEq(o.value, cv)));
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
  const hosts = [...document.querySelectorAll(
    'ng-select, mat-select, [role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"], ' +
    '[class*="ng-select"], [class*="mat-select"], [class*="react-select"], [class*="dropdown-toggle"], [class*="ant-select"], [class*="p-dropdown"], ' +
    '[class*="combobox"], [class*="Combobox"], [class*="-select"], [class*="Select"], [class*="dropdown"], [class*="Dropdown"]',
  )].filter((h) => {
    if (h.tagName === "SELECT" || h.closest("select")) return false;
    // The class matches are broad, so require the widget to LOOK like an unset single-select
    // chooser: its visible text is a placeholder ("Select an option", "Choose…", "-") or empty.
    // An already-answered widget, a multiselect chip box, a menu button, etc. is left alone.
    // (The concept-score guard below is the other half — only labelled matches are ever opened.)
    const t = (h.textContent || "").trim().replace(/\s+/g, " ");
    return t.length <= 40 && (t === "" || /^(select|choose|please select|pick|—|-)\b/i.test(t) || /select an option|select\.\.\.|choose an option/i.test(t));
  });
  const seen = new Set();
  for (const h of hosts) {
    if (seen.has(h) || [...seen].some((s) => s.contains(h) || h.contains(s))) continue;
    seen.add(h);
    let pick = null;
    const label = labelOf(h);
    if (officeUse(ownLabel(h))) continue; // an office-use chooser is not the applicant's to set
    let value = eduValueFor(h, label); // education chooser (Degree, University) → the routed value
    if (value == null) {
      let top = 0;
      for (const c of CONCEPTS) { const s = score(label, c.syn); if (s > top) { top = s; pick = c; } }
      if (!pick || top < 1.5) continue;
      value = pick.kind === "composite" ? compositeValue(pick.cmp) : atomVal(pick.key);
    }
    if (!value) continue;
    // Candidate strings to type/match: the value plus expansions (gender M->Male; common
    // country abbreviations/demonyms -> the full country name a dropdown lists).
    const cands = [String(value)]; const g = norm(value);
    if (pick && pick.key === "gender") { if (g === "m" || g === "male") cands.push("Male"); if (g === "f" || g === "female") cands.push("Female"); }
    const COUNTRY = {
      usa: ["United States", "United States of America", "America"], us: ["United States"], american: ["United States"],
      uk: ["United Kingdom", "Great Britain"], british: ["United Kingdom"], england: ["United Kingdom"],
      uae: ["United Arab Emirates"], rok: ["South Korea"], prc: ["China"], drc: ["Democratic Republic of the Congo"],
    };
    if (COUNTRY[g]) cands.push(...COUNTRY[g]);
    // A country-code dropdown may list "+1" OR "United States (+1)" — match both. The user's
    // dialling code corresponds to their country, so add the country name as a candidate too.
    if (pick && pick.key === "phonecc") {
      const digits = String(value).replace(/\D/g, "");
      if (digits) cands.push(digits, "+" + digits);
      const cn = atoms.country || atoms.nationality;
      if (cn) { cands.push(String(cn)); if (COUNTRY[norm(cn)]) cands.push(...COUNTRY[norm(cn)]); }
    }
    const n2 = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    // Score an option against the candidates: EXACT (3) > prefix (2) > containment (1).
    // Ranking (not first-match) is essential so "Male" (exact) beats "Female" — which
    // merely CONTAINS "male" (fe-male) — instead of whichever appears first in the list.
    const scoreOpt = (o) => {
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
    try {
      const opener = h.querySelector('input, [role="combobox"], [class*="control"], [class*="selection"], [class*="toggle"], [class*="trigger"]') || h;
      opener.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      opener.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      if (opener.click) opener.click();
      opener.focus && opener.focus();
      await wait(200); // let the option list render (overlays may attach to <body>)
      const readOpts = () => [...document.querySelectorAll(
        '[role="option"], .ng-option, mat-option, .ant-select-item-option, .p-dropdown-item, li[role="option"], [class*="option"]:not([class*="options"]), [class*="dropdown-item"], [class*="menu-item"]',
      )].filter((o) => o.offsetParent !== null && (o.textContent || "").trim());
      const bestOf = (list) => { let o = null, b = 0; for (const x of list) { const s = scoreOpt(x); if (s > b) { b = s; o = x; } } return { o, b }; };
      // Match among the options shown ON OPEN — WITHOUT speculative typing. Typing a guessed value
      // (a name the concept mis-picked) into a Yes/No question box is exactly how "Mysore" landed in
      // a "government official?" dropdown. Only require a real EXACT/PREFIX match (score >= 2), never
      // a loose containment, so a wrong guess simply selects nothing.
      const initial = readOpts();
      let { o: opt, b: best } = bestOf(initial);
      // Only if the widget reveals NO options until you type (a search-to-filter list) do we type —
      // and then still require a real match, and CLEAR the box if nothing matches (no leftover text).
      if (best < 2 && initial.length === 0) {
        const box = h.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio])')
          || document.querySelector('.ng-dropdown-panel input, [class*="dropdown"] input, [role="listbox"] input');
        if (box) {
          const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          const typed = cands.slice().sort((a, b) => b.length - a.length)[0];
          box.focus(); setV.call(box, typed);
          box.dispatchEvent(new Event("input", { bubbles: true }));
          box.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
          await wait(260);
          ({ o: opt, b: best } = bestOf(readOpts()));
          if (best < 2) { setV.call(box, ""); box.dispatchEvent(new Event("input", { bubbles: true })); } // remove typed garbage
        }
      }
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
      }
    } catch (_) { /* leave this widget alone on any error */ }
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
      white: /white|caucasian/, hispanic: /hispanic|latino|latina/, black: /black|african american|african.american/, asian: /\basian\b/,
      native_american: /american indian|alaska(n)? native|native american/, mena: /middle eastern|north african/,
      pacific: /hawaiian|pacific islander/, other: /other race|other ethnic|two or more|multiracial/, decline: /prefer not|decline|not.*(answer|disclose)/ } },
  ];
  const qaMatch = (q) => { const n = norm(q); for (const e of QA_LIBRARY) if (e.q.test(n)) return e; return null; };
  // SMART LAYER: map each library INTENT to the user's answer, derived from ANY captured vault entry
  // about that intent (its KEY matches the intent, its VALUE maps to an answer token). This is what lets
  // a single captured answer fill EVERY phrasing of the same question — the on-page wording need not
  // match the wording that was captured; only the shared intent matters.
  const intentAnswer = {};
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
    const controls = [...document.querySelectorAll(CTRL_SEL)]
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
    // Native <select> versions (some forms use a dropdown for gender/veteran/etc.) — same generic logic.
    for (const sel of document.querySelectorAll("select")) {
      if (sel.disabled || sel.value) continue;
      const q = ctrlQuestion(sel) + " " + ownLabel(sel);
      const opts = [...sel.options].filter((o) => o.value && (o.textContent || "").trim());
      let opt = null;
      const entry = qaMatch(q);
      if (entry && !entry.multi && SAVED[entry.key] != null && SAVED[entry.key] !== "") {
        const re = entry.opts[String(SAVED[entry.key])];
        if (re) opt = opts.find((o) => re.test((o.textContent || "").toLowerCase()));
      }
      if (!opt) { const captured = vaultAnswerFor(q); if (captured) opt = bestByTokens(opts, (o) => o.textContent || "", captured); }
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("input", { bubbles: true })); sel.dispatchEvent(new Event("change", { bubbles: true })); filled++; markFilled(sel); }
    }
  }
  return filled;
}
