// A wrong value is worse than a blank. Reported from a live form: the email address landed in the FAX
// box. "Fax" is not a concept the engine knows, so a neighbouring label ("Email Address" sits directly
// above it on that form) can bleed into the match — the same failure mode that put today's date into
// "LinkedIn Profile". A field whose OWN identity names something we do not hold must stay empty.
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
const VAULT = { first_name: "Asha", last_name: "Rao", email_address: "asha.rao@example.com", cell_phone: "9195550123" };

test("the email address never lands in a Fax box", async () => {
  // Laid out as the real form is: the email fields immediately above the fax field.
  const dom = mount(`
    <div><label>Email Address <input id="e"></label></div>
    <div><label>Confirm Email Address <input id="e2"></label></div>
    <div><label>Fax <input id="fax"></label></div>`);
  await fillPage(VAULT);
  const d = dom.window.document;
  assert.equal(d.getElementById("e").value, "asha.rao@example.com");
  assert.equal(d.getElementById("fax").value, "", `Fax received "${d.getElementById("fax").value}"`);
});

test("a fax field fills only from a stored fax number", async () => {
  const dom = mount(`<label>Fax Number <input id="fax"></label>`);
  await fillPage({ ...VAULT, fax: "9195559999" });
  assert.equal(dom.window.document.getElementById("fax").value, "9195559999");
});

test("a phone number never lands in a fax box either", async () => {
  const dom = mount(`
    <div><label>Mobile Phone Number <input id="m"></label></div>
    <div><label>Fax <input id="fax"></label></div>`);
  await fillPage(VAULT);
  assert.equal(dom.window.document.getElementById("m").value, "9195550123");
  assert.equal(dom.window.document.getElementById("fax").value, "");
});
