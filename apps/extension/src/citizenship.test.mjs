// "Do you have unrestricted authorization to work in the US?" — a US citizen should never have to
// answer that by hand, and the field should never be left blank while the vault already holds their
// citizenship. Reported on a live Workday application.
//
// This is a derivation from the user's OWN stored fact, so the two negatives matter as much as the
// positive: no citizenship stored -> nothing derived; a non-US citizenship -> nothing derived.
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
const FORM = `
  <fieldset><legend>Do you have unrestricted authorization to work in the US?</legend>
    <label><input type="radio" name="auth" value="Yes"> Yes</label>
    <label><input type="radio" name="auth" value="No"> No</label>
  </fieldset>
  <fieldset><legend>Will you now or in the future require sponsorship for employment visa status?</legend>
    <label><input type="radio" name="spon" value="Yes"> Yes</label>
    <label><input type="radio" name="spon" value="No"> No</label>
  </fieldset>`;
const checked = (dom, name) => {
  const el = [...dom.window.document.querySelectorAll(`input[name="${name}"]`)].find((x) => x.checked);
  return el ? el.value : "";
};

for (const stored of ["US Citizen", "United States", "USA", "American"]) {
  test(`citizenship "${stored}" answers work authorisation and sponsorship`, async () => {
    const dom = mount(FORM);
    await fillPage({ first_name: "Asha", citizenship: stored });
    assert.equal(checked(dom, "auth"), "Yes");
    assert.equal(checked(dom, "spon"), "No");
  });
}

test("no citizenship stored: both questions are left for the user", async () => {
  const dom = mount(FORM);
  await fillPage({ first_name: "Asha" });
  assert.equal(checked(dom, "auth"), "");
  assert.equal(checked(dom, "spon"), "");
});

test("a non-US citizenship does not answer the US question", async () => {
  const dom = mount(FORM);
  await fillPage({ first_name: "Asha", citizenship: "India" });
  assert.equal(checked(dom, "auth"), "", "an Indian citizen's US work authorisation is not ours to assume");
});
