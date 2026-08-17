// First-run seeding: create a fresh vault pre-populated with a fixed set of common
// profile keys (empty values), plus a phone COUNTRY CODE guessed from the machine's
// location. Fully on-device — derived from the OS timezone / locale, NO network call
// and NO geolocation permission. Runs once, only when the vault is first created.

export const STARTER_KEYS = [
  "salutation",
  "first_name",
  "middle_name",
  "last_name",
  "gender",
  "address_1",
  "address_2",
  "city",
  "state",
  "zip",
  "country",
  "phone_country_code",
  "cell_phone",
  "home_phone",
  "email_address",
  "native_language", // ISO code (en/hi/es/…) — the language the user thinks in (spec: language-aware filling)
];

// Region/locale → native language guess (ISO code). On-device; no network.
const REGION_LANG = {
  IN: "hi", US: "en", GB: "en", CA: "en", AU: "en", IE: "en", NZ: "en",
  ES: "es", MX: "es", AR: "es", CO: "es", PE: "es", CL: "es",
  FR: "fr", BE: "fr", DE: "de", AT: "de", CH: "de",
  CN: "zh", TW: "zh", HK: "zh", SG: "zh",
  SA: "ar", AE: "ar", EG: "ar", QA: "ar", KW: "ar",
  RU: "ru",
};
export function guessNativeLanguage() {
  try {
    const lang = (self.navigator && self.navigator.language) || "";
    const two = lang.slice(0, 2).toLowerCase();
    if (["en", "hi", "es", "fr", "de", "zh", "ar", "ru"].includes(two)) return two;
    let region = "";
    try { region = (new Intl.Locale(lang).region || "").toUpperCase(); } catch (_) { /* older engine */ }
    if (!region && lang.includes("-")) region = lang.split("-").pop().toUpperCase();
    if (region && REGION_LANG[region]) return REGION_LANG[region];
  } catch (_) { /* navigator unavailable */ }
  return "en";
}

// IANA timezone -> E.164 dialing code. Timezone reflects the machine's physical
// location better than locale (which is a language preference). Common zones only;
// anything unlisted falls back to the locale region below, else empty.
const TZ_DIAL = {
  "Asia/Kolkata": "+91", "Asia/Calcutta": "+91",
  "America/New_York": "+1", "America/Detroit": "+1", "America/Chicago": "+1",
  "America/Denver": "+1", "America/Phoenix": "+1", "America/Los_Angeles": "+1",
  "America/Anchorage": "+1", "Pacific/Honolulu": "+1",
  "America/Toronto": "+1", "America/Vancouver": "+1", "America/Edmonton": "+1",
  "Europe/London": "+44", "Europe/Dublin": "+353", "Europe/Lisbon": "+351",
  "Europe/Madrid": "+34", "Europe/Paris": "+33", "Europe/Brussels": "+32",
  "Europe/Amsterdam": "+31", "Europe/Berlin": "+49", "Europe/Zurich": "+41",
  "Europe/Rome": "+39", "Europe/Vienna": "+43", "Europe/Prague": "+420",
  "Europe/Warsaw": "+48", "Europe/Budapest": "+36", "Europe/Bucharest": "+40",
  "Europe/Stockholm": "+46", "Europe/Oslo": "+47", "Europe/Copenhagen": "+45",
  "Europe/Helsinki": "+358", "Europe/Athens": "+30", "Europe/Kyiv": "+380",
  "Europe/Kiev": "+380", "Europe/Moscow": "+7", "Europe/Istanbul": "+90",
  "Asia/Dubai": "+971", "Asia/Riyadh": "+966", "Asia/Qatar": "+974",
  "Asia/Kuwait": "+965", "Asia/Jerusalem": "+972", "Asia/Tehran": "+98",
  "Asia/Karachi": "+92", "Asia/Dhaka": "+880", "Asia/Colombo": "+94",
  "Asia/Kathmandu": "+977", "Asia/Shanghai": "+86", "Asia/Hong_Kong": "+852",
  "Asia/Taipei": "+886", "Asia/Singapore": "+65", "Asia/Kuala_Lumpur": "+60",
  "Asia/Jakarta": "+62", "Asia/Bangkok": "+66", "Asia/Ho_Chi_Minh": "+84",
  "Asia/Manila": "+63", "Asia/Tokyo": "+81", "Asia/Seoul": "+82",
  "Australia/Sydney": "+61", "Australia/Melbourne": "+61", "Australia/Brisbane": "+61",
  "Australia/Perth": "+61", "Australia/Adelaide": "+61", "Pacific/Auckland": "+64",
  "Africa/Johannesburg": "+27", "Africa/Lagos": "+234", "Africa/Nairobi": "+254",
  "Africa/Cairo": "+20", "Africa/Casablanca": "+212",
  "America/Sao_Paulo": "+55", "America/Mexico_City": "+52", "America/Bogota": "+57",
  "America/Lima": "+51", "America/Santiago": "+56", "America/Argentina/Buenos_Aires": "+54",
};

// ISO-3166 alpha-2 region -> dialing code (locale-region fallback).
const REGION_DIAL = {
  IN: "+91", US: "+1", CA: "+1", GB: "+44", IE: "+353", PT: "+351", ES: "+34",
  FR: "+33", BE: "+32", NL: "+31", DE: "+49", CH: "+41", IT: "+39", AT: "+43",
  CZ: "+420", PL: "+48", HU: "+36", RO: "+40", SE: "+46", NO: "+47", DK: "+45",
  FI: "+358", GR: "+30", UA: "+380", RU: "+7", TR: "+90", AE: "+971", SA: "+966",
  QA: "+974", KW: "+965", IL: "+972", IR: "+98", PK: "+92", BD: "+880", LK: "+94",
  NP: "+977", CN: "+86", HK: "+852", TW: "+886", SG: "+65", MY: "+60", ID: "+62",
  TH: "+66", VN: "+84", PH: "+63", JP: "+81", KR: "+82", AU: "+61", NZ: "+64",
  ZA: "+27", NG: "+234", KE: "+254", EG: "+20", MA: "+212", BR: "+55", MX: "+52",
  CO: "+57", PE: "+51", CL: "+56", AR: "+54",
};

// ISO-3166 alpha-2 region -> country NAME. Seeding the dialling code but leaving Country blank was a
// half-measure: the country drives the dial-code row on a shared code (+1 is the US, Canada, Antigua,
// the Bahamas…), state abbreviations, country dropdowns and address shape. Same on-device signal, so
// if we can infer the code we can infer the country.
const REGION_COUNTRY = {
  IN: "India", US: "United States", CA: "Canada", GB: "United Kingdom", IE: "Ireland",
  PT: "Portugal", ES: "Spain", FR: "France", BE: "Belgium", NL: "Netherlands", DE: "Germany",
  CH: "Switzerland", IT: "Italy", AT: "Austria", CZ: "Czechia", PL: "Poland", HU: "Hungary",
  RO: "Romania", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", GR: "Greece",
  UA: "Ukraine", RU: "Russia", TR: "Turkey", AE: "United Arab Emirates", SA: "Saudi Arabia",
  QA: "Qatar", KW: "Kuwait", IL: "Israel", IR: "Iran", PK: "Pakistan", BD: "Bangladesh",
  LK: "Sri Lanka", NP: "Nepal", CN: "China", HK: "Hong Kong", TW: "Taiwan", SG: "Singapore",
  MY: "Malaysia", ID: "Indonesia", TH: "Thailand", VN: "Vietnam", PH: "Philippines",
  JP: "Japan", KR: "South Korea", AU: "Australia", NZ: "New Zealand", ZA: "South Africa",
  NG: "Nigeria", KE: "Kenya", EG: "Egypt", MA: "Morocco", BR: "Brazil", MX: "Mexico",
  CO: "Colombia", PE: "Peru", CL: "Chile", AR: "Argentina",
};
// Timezones are the better location signal (locale is a language preference), so map the zones we
// already know to their region, then reuse REGION_COUNTRY.
const TZ_REGION = {
  "Asia/Kolkata": "IN", "Asia/Calcutta": "IN",
  "America/New_York": "US", "America/Detroit": "US", "America/Chicago": "US", "America/Denver": "US",
  "America/Phoenix": "US", "America/Los_Angeles": "US", "America/Anchorage": "US", "Pacific/Honolulu": "US",
  "America/Toronto": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA",
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Lisbon": "PT", "Europe/Madrid": "ES",
  "Europe/Paris": "FR", "Europe/Brussels": "BE", "Europe/Amsterdam": "NL", "Europe/Berlin": "DE",
  "Europe/Zurich": "CH", "Europe/Rome": "IT", "Europe/Vienna": "AT", "Europe/Prague": "CZ",
  "Europe/Warsaw": "PL", "Europe/Budapest": "HU", "Europe/Bucharest": "RO", "Europe/Stockholm": "SE",
  "Europe/Oslo": "NO", "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI", "Europe/Athens": "GR",
  "Europe/Kyiv": "UA", "Europe/Kiev": "UA", "Europe/Moscow": "RU", "Europe/Istanbul": "TR",
  "Asia/Dubai": "AE", "Asia/Riyadh": "SA", "Asia/Qatar": "QA", "Asia/Kuwait": "KW",
  "Asia/Jerusalem": "IL", "Asia/Tehran": "IR", "Asia/Karachi": "PK", "Asia/Dhaka": "BD",
  "Asia/Colombo": "LK", "Asia/Kathmandu": "NP", "Asia/Shanghai": "CN", "Asia/Hong_Kong": "HK",
  "Asia/Taipei": "TW", "Asia/Singapore": "SG", "Asia/Kuala_Lumpur": "MY", "Asia/Jakarta": "ID",
  "Asia/Bangkok": "TH", "Asia/Ho_Chi_Minh": "VN", "Asia/Manila": "PH", "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR", "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Australia/Brisbane": "AU",
  "Australia/Perth": "AU", "Australia/Adelaide": "AU", "Pacific/Auckland": "NZ",
  "Africa/Johannesburg": "ZA", "Africa/Lagos": "NG", "Africa/Nairobi": "KE", "Africa/Cairo": "EG",
  "Africa/Casablanca": "MA", "America/Sao_Paulo": "BR", "America/Mexico_City": "MX",
  "America/Bogota": "CO", "America/Lima": "PE", "America/Santiago": "CL",
  "America/Argentina/Buenos_Aires": "AR",
};

// Best-effort COUNTRY NAME from the machine's location. Same rules as the dialling code: timezone
// first, then the locale's region. Returns "" when we cannot tell — never a guess.
export function guessCountry() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TZ_REGION[tz] && REGION_COUNTRY[TZ_REGION[tz]]) return REGION_COUNTRY[TZ_REGION[tz]];
  } catch (_) { /* Intl/timezone unavailable */ }
  try {
    const lang = (self.navigator && self.navigator.language) || "";
    let region = "";
    try { region = (new Intl.Locale(lang).region || "").toUpperCase(); } catch (_) { /* older engine */ }
    if (!region && lang.includes("-")) region = lang.split("-").pop().toUpperCase();
    if (region && REGION_COUNTRY[region]) return REGION_COUNTRY[region];
  } catch (_) { /* navigator unavailable */ }
  return "";
}

// Best-effort dialing code from the machine's location. No network, no permissions.
export function guessDialCode() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TZ_DIAL[tz]) return TZ_DIAL[tz];
  } catch (_) { /* Intl/timezone unavailable */ }
  try {
    const lang = (self.navigator && self.navigator.language) || "";
    let region = "";
    try { region = new Intl.Locale(lang).region || ""; } catch (_) { /* older engine */ }
    if (!region && lang.includes("-")) region = lang.split("-").pop().toUpperCase();
    if (region && REGION_DIAL[region]) return REGION_DIAL[region];
  } catch (_) { /* navigator unavailable */ }
  return "";
}

// A fresh vault: every starter key empty, except the phone country code we can infer.
export function starterVault() {
  const v = {};
  for (const k of STARTER_KEYS) v[k] = "";
  v.phone_country_code = guessDialCode();
  v.country = guessCountry();
  v.native_language = guessNativeLanguage();
  return v;
}

// Vaults created BEFORE country was seeded have a dialling code but no country — and the country is
// what tells a "+1" list whether you are in the US, Canada, Antigua or the Bahamas. Fill that one gap
// on unlock, only when the field is genuinely empty and only from the same on-device signal. Returns
// the keys it set (empty when there is nothing to do) so the caller can persist just those.
export function backfillDerivable(vault) {
  const out = {};
  if (!vault || typeof vault !== "object") return out;
  const blank = (k) => !vault[k] || !String(vault[k]).trim();
  if (blank("country")) { const c = guessCountry(); if (c) out.country = c; }
  if (blank("phone_country_code")) { const d = guessDialCode(); if (d) out.phone_country_code = d; }
  return out;
}
