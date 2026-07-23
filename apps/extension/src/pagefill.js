// The page-fill function INJECTED into the target tab via chrome.scripting.executeScript.
// It must be fully SELF-CONTAINED (no imports/outer refs) because executeScript serializes
// its source. Kept in its own module so it can be unit-tested under jsdom (see pagefill.test.mjs).
export async function fillPage(vault, tLabels) {
  const norm = (s) => (s || "").toString()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Za-z])([0-9])/g, "$1 $2") // split camelCase / letter-digit
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const initial = (s) => { const m = (s || "").trim().match(/\p{L}/u); return m ? m[0].toUpperCase() : ""; };

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
    dependent_name: ["name of dependent", "dependent name", "dependant name", "nominee name", "nominee", "guardian name", "beneficiary name", "next of kin", "spouse name", "emergency contact name"],
    dependent_dob: ["dependent dob", "dependant dob", "dependent date of birth", "dependant date of birth"],
  };
  const rawVault = {};
  for (const [k, v] of Object.entries(vault)) rawVault[norm(k)] = v;
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
  const atomVal = (key) => {
    if (key === "given")  return atoms.given ?? (atoms.full || "").split(/\s+/)[0];
    if (key === "family") return atoms.family ?? ((atoms.full || "").split(/\s+/).slice(-1)[0]);
    if (key === "nationality") return atoms.nationality ?? atoms.country;
    if (key === "cellphone") return withCC(atoms.cellphone ?? anyPhone());
    if (key === "homephone") return withCC(atoms.homephone ?? anyPhone());
    if (key === "phone")     return withCC(anyPhone());
    if (key === "appdate")   return atoms.appdate ?? (() => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`; })();
    return atoms[key];
  };

  // 2) COMPOSITE concepts: a coarse field made of finer member atoms, joined in order.
  //    Its value excludes any member the form claims with a more-specific field.
  const COMPOSITES = {
    full:    { syn: ALIASES.full, members: ["given", "middle", "family"], sep: " ", name: true, fallback: () => atoms.full },
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
    if (["password", "hidden", "checkbox", "radio", "file", "submit", "button"].includes(el.type)) continue;
    if (el.disabled) continue;
    // readOnly is NOT a blanket skip: date pickers are routinely readOnly and must still be
    // filled (see setFieldValue, which briefly clears the flag). But a readOnly *text* field is
    // one the site does not want changed — a server-issued reference number, a computed total.
    // Writing there can corrupt a submission or fail server-side validation. So: allow readOnly
    // only where it plausibly means "picker", not "locked".
    if (el.readOnly && !isDatePickerLike(el)) continue;
    const label = tLabels && tLabels[fi] ? tLabels[fi] : labelOf(el); // use the English-translated label if provided
    fi++;
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
  const claimed = new Set(fields.filter((f) => f.pick.kind === "atom").map((f) => f.pick.key));
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
  for (const { el, label, pick } of fields) {
    let value;
    if (pick.kind === "composite") {
      const parts = pick.cmp.members.filter((m) => !claimed.has(m)).map(atomVal).filter(Boolean);
      value = parts.length ? parts.join(pick.cmp.sep) : (pick.cmp.fallback ? pick.cmp.fallback() : "");
    } else {
      value = atomVal(pick.key);
    }
    if (!value) continue;
    if (pick.name && wantsInitial(label, el)) value = initial(value);
    const dt = parseVaultDate(value);
    if (dt && el.type !== "date") {
      if (await setDateSmart(el, dt, formatDateForField(value, el, label))) filled++;
    } else {
      if (setFieldValue(el, formatDateForField(value, el, label))) filled++;
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
    let pick = null, top = 0;
    for (const c of CONCEPTS) { const s = score(label, c.syn); if (s > top) { top = s; pick = c; } }
    if (!pick || top < 1.5) continue;
    const value = pick.kind === "composite"
      ? (pick.cmp.members.filter((m) => !claimed.has(m)).map(atomVal).filter(Boolean).join(pick.cmp.sep) || (pick.cmp.fallback ? pick.cmp.fallback() : ""))
      : atomVal(pick.key);
    if (!value) continue;
    // Candidate values to match an option against: the raw value plus expansions (a stored
    // gender "M" should match a "Male" option; "F" -> "Female").
    const cands = [value];
    const g = norm(value);
    if (pick.key === "gender") { if (g === "m" || g === "male") cands.push("male"); if (g === "f" || g === "female") cands.push("female"); }
    // Country abbreviations/demonyms -> full names a <select> lists (USA -> United States).
    const SEL_COUNTRY = {
      usa: ["United States", "United States of America", "America"], us: ["United States"], american: ["United States"],
      uk: ["United Kingdom", "Great Britain"], british: ["United Kingdom"], uae: ["United Arab Emirates"],
    };
    if (SEL_COUNTRY[g]) cands.push(...SEL_COUNTRY[g]);
    if (pick.key === "phonecc") { const d = String(value).replace(/\D/g, ""); if (d) cands.push(d, "+" + d); const cn = atoms.country || atoms.nationality; if (cn) cands.push(String(cn)); }
    const opts = [...sel.options];
    const match = opts.find((o) => cands.some((cv) => optEq(o.textContent, cv) || optEq(o.value, cv)));
    if (match) {
      sel.value = match.value;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      filled++;
    }
  }

  // CUSTOM dropdowns (any framework — ng-select, mat-select, react-select, PrimeNG, or an
  // ARIA combobox). We don't target a specific site: we detect a widget that BEHAVES like a
  // chooser (standard roles / common widget roots), open it, then click the option whose
  // VISIBLE TEXT matches the value. Only widgets that resolve to a concept + have a value are
  // opened, so unrelated menus are never touched.
  const hosts = [...document.querySelectorAll(
    'ng-select, mat-select, [role="combobox"], [aria-haspopup="listbox"], [class*="ng-select"], [class*="mat-select"], [class*="react-select"], [class*="dropdown-toggle"], [class*="ant-select"], [class*="p-dropdown"]',
  )].filter((h) => h.tagName !== "SELECT" && !h.closest("select"));
  const seen = new Set();
  for (const h of hosts) {
    if (seen.has(h) || [...seen].some((s) => s.contains(h) || h.contains(s))) continue;
    seen.add(h);
    let pick = null, top = 0;
    const label = labelOf(h);
    for (const c of CONCEPTS) { const s = score(label, c.syn); if (s > top) { top = s; pick = c; } }
    if (!pick || top < 1.5) continue;
    const value = pick.kind === "composite"
      ? (pick.cmp.members.filter((m) => !claimed.has(m)).map(atomVal).filter(Boolean).join(pick.cmp.sep) || (pick.cmp.fallback ? pick.cmp.fallback() : ""))
      : atomVal(pick.key);
    if (!value) continue;
    // Candidate strings to type/match: the value plus expansions (gender M->Male; common
    // country abbreviations/demonyms -> the full country name a dropdown lists).
    const cands = [String(value)]; const g = norm(value);
    if (pick.key === "gender") { if (g === "m" || g === "male") cands.push("Male"); if (g === "f" || g === "female") cands.push("Female"); }
    const COUNTRY = {
      usa: ["United States", "United States of America", "America"], us: ["United States"], american: ["United States"],
      uk: ["United Kingdom", "Great Britain"], british: ["United Kingdom"], england: ["United Kingdom"],
      uae: ["United Arab Emirates"], rok: ["South Korea"], prc: ["China"], drc: ["Democratic Republic of the Congo"],
    };
    if (COUNTRY[g]) cands.push(...COUNTRY[g]);
    // A country-code dropdown may list "+1" OR "United States (+1)" — match both. The user's
    // dialling code corresponds to their country, so add the country name as a candidate too.
    if (pick.key === "phonecc") {
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
      // If the widget has a search box, TYPE the best candidate to filter a long list.
      const box = h.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio])')
        || document.querySelector('.ng-dropdown-panel input, [class*="dropdown"] input, [role="listbox"] input');
      if (box) {
        const typed = cands.slice().sort((a, b) => b.length - a.length)[0];
        box.focus();
        const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setV.call(box, typed);
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
        await wait(260);
      }
      const opts = [...document.querySelectorAll(
        '[role="option"], .ng-option, mat-option, .ant-select-item-option, .p-dropdown-item, li[role="option"], [class*="option"]:not([class*="options"]), [class*="dropdown-item"], [class*="menu-item"]',
      )].filter((o) => o.offsetParent !== null && (o.textContent || "").trim());
      let opt = null, bestScore = 0;
      for (const o of opts) { const s = scoreOpt(o); if (s > bestScore) { bestScore = s; opt = o; } }
      if (!opt && box && opts.length === 1) opt = opts[0]; // typed-to-filter left exactly one
      if (opt) {
        opt.scrollIntoView && opt.scrollIntoView({ block: "nearest" });
        opt.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        opt.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        if (opt.click) opt.click();
        filled++;
        await wait(80);
      } else {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        opener.blur && opener.blur();
      }
    } catch (_) { /* leave this widget alone on any error */ }
  }
  return filled;
}
