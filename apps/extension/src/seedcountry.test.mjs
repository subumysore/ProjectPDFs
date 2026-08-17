// Onboarding used to seed the phone dialling code from the device but leave COUNTRY blank. That gap
// is what made a "+1" list ambiguous (US? Canada? Antigua?), and it also costs state abbreviations,
// country dropdowns and address shape. Country is now seeded from the same on-device signal, and a
// vault created before that heals itself on unlock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STARTER_KEYS, starterVault, guessCountry, guessDialCode, backfillDerivable } from "./seed.js";

// The module reads `self.navigator` / Intl; give it a device to look at.
function withDevice({ tz, lang }, fn) {
  const savedSelf = globalThis.self;
  const savedDTF = Intl.DateTimeFormat;
  globalThis.self = { navigator: { language: lang } };
  Intl.DateTimeFormat = function () { return { resolvedOptions: () => ({ timeZone: tz }) }; };
  try { return fn(); } finally { globalThis.self = savedSelf; Intl.DateTimeFormat = savedDTF; }
}

test("country is a starter key and is seeded, not left blank", () => {
  assert.ok(STARTER_KEYS.includes("country"));
  const v = withDevice({ tz: "America/New_York", lang: "en-US" }, () => starterVault());
  assert.equal(v.country, "United States");
  assert.equal(v.phone_country_code, "+1");
});

test("the country comes from the TIMEZONE first (location beats language preference)", () => {
  // A machine in India whose UI language is US English is in India.
  const v = withDevice({ tz: "Asia/Kolkata", lang: "en-US" }, () => starterVault());
  assert.equal(v.country, "India");
  assert.equal(v.phone_country_code, "+91");
});

test("an unknown timezone falls back to the locale region", () => {
  const c = withDevice({ tz: "Antarctica/Troll", lang: "en-GB" }, () => guessCountry());
  assert.equal(c, "United Kingdom");
});

test("nothing knowable: no country is invented", () => {
  const c = withDevice({ tz: "Antarctica/Troll", lang: "xx" }, () => guessCountry());
  assert.equal(c, "");
  assert.equal(withDevice({ tz: "Antarctica/Troll", lang: "xx" }, () => guessDialCode()), "");
});

test("an older vault (code but no country) is backfilled", () => {
  const add = withDevice({ tz: "America/New_York", lang: "en-US" },
    () => backfillDerivable({ phone_country_code: "+1", country: "", first_name: "Asha" }));
  assert.deepEqual(add, { country: "United States" });
});

test("a country the user typed is NEVER overwritten", () => {
  const add = withDevice({ tz: "America/New_York", lang: "en-US" },
    () => backfillDerivable({ country: "Canada", phone_country_code: "+1" }));
  assert.deepEqual(add, {});
});

test("a vault with neither gets both", () => {
  const add = withDevice({ tz: "Europe/Berlin", lang: "de-DE" }, () => backfillDerivable({ first_name: "Jan" }));
  assert.deepEqual(add, { country: "Germany", phone_country_code: "+49" });
});
