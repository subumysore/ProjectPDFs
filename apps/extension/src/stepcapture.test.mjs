// A multi-step application (LinkedIn Easy Apply, Workday, Dice, Monster…) never fires `submit` between
// steps: the user clicks Next and the step is replaced. Capture therefore has to happen ON THE WAY OUT
// of each step, or everything answered on steps 1..n-1 is lost and only the final step is ever learned.
//
// These tests exercise the beacon's trigger rules with the real collector.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { collectTypedValues, newInformation } from "./pagecapture.js";
import { keyFromLabel, isCapturableLabel } from "./vaultkey.js";

function mount(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ["window", "document", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
    "MouseEvent", "KeyboardEvent", "Event", "Node", "Element"]) global[k] = w[k];
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });
  return dom;
}

// The beacon's own rule for "this click is leaving the step".
const ADVANCE = /^(next|continue|save (and|&) continue|next step|review|submit|send application|apply)\b/i;
const labelOfButton = (el) => ((el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || "").trim());

test("the advance rule recognises the wizard buttons and ignores unrelated ones", () => {
  const dom = mount(`
    <button id="next">Next</button>
    <button id="cont">Continue</button>
    <button id="sc">Save and continue</button>
    <button id="rev">Review your application</button>
    <button id="sub">Submit application</button>
    <button id="cancel">Cancel</button>
    <button id="back">Back</button>
    <button id="help">Need help?</button>`);
  const d = dom.window.document;
  for (const id of ["next", "cont", "sc", "rev", "sub"]) {
    assert.ok(ADVANCE.test(labelOfButton(d.getElementById(id))), `${id} should trigger a capture`);
  }
  for (const id of ["cancel", "back", "help"]) {
    assert.ok(!ADVANCE.test(labelOfButton(d.getElementById(id))), `${id} must NOT trigger a capture`);
  }
});

test("answers on an intermediate step are captured before the step is replaced", () => {
  const dom = mount(`
    <form>
      <label>Preferred shift <input id="s"></label>
      <label>Notice period <input id="n"></label>
      <button id="next">Next</button>
    </form>`);
  const d = dom.window.document;
  d.getElementById("s").value = "Night";
  d.getElementById("n").value = "2 weeks";

  // What the beacon would send when Next is clicked — collected BEFORE the step is torn down.
  const pairs = collectTypedValues();
  const fresh = newInformation(pairs, {}, keyFromLabel, isCapturableLabel);
  const byKey = Object.fromEntries(fresh.map((p) => [p.key, p.value]));
  assert.equal(byKey.preferred_shift, "Night");
  assert.equal(byKey.notice_period, "2 weeks");
});

test("a step that only repeats known answers offers nothing new", () => {
  const dom = mount(`<label>Preferred shift <input id="s"></label>`);
  dom.window.document.getElementById("s").value = "Night";
  const vault = { [keyFromLabel("Preferred shift")]: "Night" };
  assert.equal(newInformation(collectTypedValues(), vault, keyFromLabel, isCapturableLabel).length, 0);
});
