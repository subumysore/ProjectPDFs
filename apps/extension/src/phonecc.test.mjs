// A form that splits the phone into "Country dialing code" + "Number" (Dayforce/Ceridian, Workday and
// most ATS) must get BOTH. The code box used to be left empty whenever the vault had no explicit
// phone_country_code — and an empty code makes the phone invalid on submit, so the number beside it
// was wasted. It now comes from the seeded key when present, else is derived from an international
// phone or from the user's country.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fillPage } from "./pagefill.js";
import { STARTER_KEYS } from "./seed.js";

function mount(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ["window", "document", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
    "MouseEvent", "KeyboardEvent", "Event", "Node", "Element"]) global[k] = w[k];
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });
  return dom;
}
const FORM = `<label>Country dialing code <input id="cc"></label><label>Mobile phone <input id="ph"></label>`;

test("onboarding seeds a phone country code key", () => {
  assert.ok(STARTER_KEYS.includes("phone_country_code"), "phone_country_code must be a starter key");
});

test("an explicitly stored dialling code fills the code box", async () => {
  const dom = mount(FORM);
  await fillPage({ phone_country_code: "+44", cell_phone: "7700900123" });
  assert.equal(dom.window.document.getElementById("cc").value, "+44");
  assert.equal(dom.window.document.getElementById("ph").value, "7700900123");
});

test("no stored code: derive it from the country", async () => {
  const dom = mount(FORM);
  await fillPage({ country: "United States", cell_phone: "9195550123" });
  assert.equal(dom.window.document.getElementById("cc").value, "+1");
  assert.equal(dom.window.document.getElementById("ph").value, "9195550123");
});

test("no stored code: derive it from an international number", async () => {
  const dom = mount(FORM);
  await fillPage({ cell_phone: "+91 9845012345" });
  assert.equal(dom.window.document.getElementById("cc").value, "+91");
});

test("unknown country and a local number: the code box is left alone, never guessed", async () => {
  const dom = mount(FORM);
  await fillPage({ country: "Wakanda", cell_phone: "9195550123" });
  assert.equal(dom.window.document.getElementById("cc").value, "");
});

test("a <select> of dialling codes is matched on the CODE, not on word overlap", async () => {
  const dom = mount(`<label>Country dialing code
    <select id="s"><option value=""></option><option>US +1</option><option>IN +91</option><option>GB +44</option></select></label>`);
  await fillPage({ country: "India", cell_phone: "9845012345" });
  const sel = dom.window.document.getElementById("s");
  assert.equal(sel.options[sel.selectedIndex].textContent, "IN +91");
});

test("+1 must not select +12 (exact code, not prefix)", async () => {
  const dom = mount(`<label>Country dialing code
    <select id="s"><option value=""></option><option>Morocco +212</option><option>United States +1</option></select></label>`);
  await fillPage({ country: "United States", cell_phone: "9195550123" });
  const sel = dom.window.document.getElementById("s");
  assert.equal(sel.options[sel.selectedIndex].textContent, "United States +1");
});

// +1 belongs to the US, Canada, Antigua, the Bahamas and a dozen more. On live Dayforce the first
// matching row won and a US user got 🇦🇬 Antigua — right code, wrong country.
test("a shared dial code (+1) picks the user's own country, not the first row", async () => {
  const dom = mount(`<label>Country dialing code
    <select id="s"><option value=""></option><option value="AG">Antigua +1</option><option value="CA">Canada +1</option><option value="US">United States +1</option></select></label>`);
  await fillPage({ country: "United States", cell_phone: "9195550123" });
  assert.equal(dom.window.document.getElementById("s").value, "US");
});

test("shared code with an unknown country still picks a row carrying the right code", async () => {
  const dom = mount(`<label>Country dialing code
    <select id="s"><option value=""></option><option value="AG">Antigua +1</option><option value="US">United States +1</option></select></label>`);
  await fillPage({ cell_phone: "+1 9195550123" });
  assert.ok(["AG", "US"].includes(dom.window.document.getElementById("s").value));
});

// The vault holds whatever the user typed. "USA" / "US" / "America" must disambiguate a shared code
// just as well as "United States" — otherwise the first country sharing +1 wins (Antigua).
for (const written of ["USA", "US", "America", "united states of america"]) {
  test(`country written as "${written}" still picks the right +1 row`, async () => {
    const dom = mount(`<label>Country dialing code
      <select id="s"><option value=""></option><option value="AG">Antigua +1</option><option value="US">United States +1</option></select></label>`);
    await fillPage({ country: written, cell_phone: "9195550123" });
    assert.equal(dom.window.document.getElementById("s").value, "US");
  });
}

// Onboarding seeds the dialling code from the device timezone but leaves Country BLANK — the common
// real-world vault. With no country to go on, fall back to the device region rather than row order.
test("no country stored: the device region disambiguates the shared code", async () => {
  const dom = mount(`<label>Country dialing code
    <select id="s"><option value=""></option><option value="AG">Antigua +1</option><option value="US">United States +1</option></select></label>`);
  // Node exposes its own read-only `navigator`, so plain assignment is silently ignored — define it.
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, get: () => ({ language: "en-US", languages: ["en-US"] }) });
  try {
    await fillPage({ phone_country_code: "+1", cell_phone: "9195550123" });
    assert.equal(dom.window.document.getElementById("s").value, "US");
  } finally {
    if (saved) Object.defineProperty(globalThis, "navigator", saved); else delete globalThis.navigator;
  }
});
