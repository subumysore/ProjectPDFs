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
