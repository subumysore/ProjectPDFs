// A blank field is fine; a field filled with the WRONG value is not. Live testing found today's date
// written into "LinkedIn Profile", "Fax" and "County" — the application-date concept (which invents
// today's date when nothing is stored) was matching labels that have nothing to do with a date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fillPage } from "./pagefill.js";

function mount(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ["window", "document", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
    "MouseEvent", "KeyboardEvent", "Event", "Node", "Element"]) global[k] = w[k];
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });
  return dom;
}
const VAULT = { first_name: "Test", last_name: "Candidate", email_address: "t@example.com", city: "Raleigh" };

for (const label of ["LinkedIn Profile", "Fax", "County", "Website", "Twitter Handle", "Referred By"]) {
  test(`"${label}" is left blank, never stamped with today's date`, async () => {
    const dom = mount(`<label>${label} <input id="x"></label>`);
    await fillPage(VAULT);
    const v = dom.window.document.getElementById("x").value;
    assert.equal(v, "", `"${label}" received "${v}"`);
  });
}

test("a genuine application-date field still gets today's date", async () => {
  const dom = mount(`<label>Date of Application <input id="d"></label>`);
  await fillPage(VAULT);
  assert.match(dom.window.document.getElementById("d").value, /\d{2}\/\d{2}\/\d{4}/);
});

// LinkedIn / portfolio links are now real concepts, so a vault holding ANY of the usual key spellings
// fills them — and a nearer concept can no longer claim the field first.
for (const key of ["linkedin", "linkedin_url", "linkedin_profile", "linked_in_url"]) {
  test(`a LinkedIn URL stored as "${key}" fills a LinkedIn field`, async () => {
    const dom = mount(`<label>LinkedIn Profile <input id="li"></label>`);
    await fillPage({ ...VAULT, [key]: "https://www.linkedin.com/in/example" });
    assert.equal(dom.window.document.getElementById("li").value, "https://www.linkedin.com/in/example");
  });
}

test("a portfolio/website field fills from the stored website", async () => {
  const dom = mount(`<label>Personal Website <input id="w"></label>`);
  await fillPage({ ...VAULT, website: "https://example.com" });
  assert.equal(dom.window.document.getElementById("w").value, "https://example.com");
});

// A country stored in ANY short form must select the country ITSELF — never one whose name it merely
// prefixes. Reported live on a Phenom application: "America"/"USA" was selecting "American Samoa".
for (const stored of ["USA", "US", "America", "United States"]) {
  test(`country "${stored}" selects United States, never American Samoa`, async () => {
    const dom = mount(`<label>Country
      <select id="c"><option value=""></option><option>American Samoa</option><option>Antigua and Barbuda</option><option>United States</option></select></label>`);
    await fillPage({ ...VAULT, country: stored });
    assert.equal(dom.window.document.getElementById("c").value, "United States");
  });
}

test("an unknown country still selects nothing rather than a lookalike", async () => {
  const dom = mount(`<label>Country
    <select id="c"><option value=""></option><option>American Samoa</option><option>United States</option></select></label>`);
  await fillPage({ ...VAULT, country: "Wakanda" });
  assert.equal(dom.window.document.getElementById("c").value, "");
});
