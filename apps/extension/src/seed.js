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
];

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
  return v;
}
