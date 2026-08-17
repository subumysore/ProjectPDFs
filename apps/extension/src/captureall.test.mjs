// "Does answering a NEW question teach the vault — whatever kind of control it was?"
// One test per control type, each asserting the answer comes back as a {key, value} pair the vault can
// store: text box, textarea, native <select>, custom dropdown (combobox), radio group, checkbox group.
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
// What the review card would offer to save, against a vault that has never seen these questions.
const offered = () => newInformation(collectTypedValues(), {}, keyFromLabel, isCapturableLabel);
const find = (rx) => offered().find((p) => rx.test(p.label));

test("TEXT box: a new answer is captured as key/value", () => {
  const dom = mount(`<label>Mother's maiden name <input id="a"></label>`);
  dom.window.document.getElementById("a").value = "Kamala";
  const p = find(/maiden/i);
  assert.ok(p, "not captured");
  assert.equal(p.value, "Kamala");
  assert.match(p.key, /^[a-z0-9_]+$/);
});

test("TEXTAREA: a longer answer is captured", () => {
  const dom = mount(`<label>Why do you want this role? <textarea id="t"></textarea></label>`);
  dom.window.document.getElementById("t").value = "Because I like forms.";
  const p = find(/why do you want/i);
  assert.ok(p, "not captured");
  assert.equal(p.value, "Because I like forms.");
});

test("NATIVE <select>: the chosen option is captured, the placeholder is not", () => {
  const dom = mount(`<label>Shift preference
    <select id="s"><option value="">Select one</option><option>Night shift</option><option>Day shift</option></select></label>`);
  const s = dom.window.document.getElementById("s");
  s.value = "Night shift";
  const p = find(/shift preference/i);
  assert.ok(p, "not captured");
  assert.equal(p.value, "Night shift");
});

test("NATIVE <select> left on its placeholder is NOT captured", () => {
  mount(`<label>Shift preference
    <select id="s"><option value="" selected>Select one</option><option>Night shift</option></select></label>`);
  assert.equal(find(/shift preference/i), undefined, "an unanswered dropdown must not be saved");
});

test("CUSTOM dropdown (combobox): the visible selection is captured", () => {
  mount(`<div class="form-group">
      <label>Preferred contact method</label>
      <div role="combobox" class="ant-select"><span class="ant-select-selection-item">Email</span></div>
    </div>`);
  const p = find(/preferred contact/i);
  assert.ok(p, "not captured");
  assert.equal(p.value, "Email");
});

test("RADIO group: the chosen option is captured with its question", () => {
  const dom = mount(`<fieldset><legend>Do you have a valid driver's licence?</legend>
      <label><input type="radio" name="dl" value="Yes"> Yes</label>
      <label><input type="radio" name="dl" value="No"> No</label></fieldset>`);
  dom.window.document.querySelector('input[value="Yes"]').checked = true;
  const p = find(/driver/i);
  assert.ok(p, "not captured");
  assert.match(p.value, /yes/i);
});

test("CHECKBOX group: every ticked option is captured", () => {
  const dom = mount(`<fieldset><legend>Which shifts can you work?</legend>
      <label><input type="checkbox" name="sh" value="Morning"> Morning</label>
      <label><input type="checkbox" name="sh" value="Evening"> Evening</label>
      <label><input type="checkbox" name="sh" value="Night"> Night</label></fieldset>`);
  const d = dom.window.document;
  d.querySelector('input[value="Morning"]').checked = true;
  d.querySelector('input[value="Night"]').checked = true;
  const p = find(/which shifts/i);
  assert.ok(p, "not captured");
  assert.match(p.value, /Morning/i);
  assert.match(p.value, /Night/i);
  assert.ok(!/Evening/i.test(p.value), "an unticked option must not be saved");
});

test("an answer the vault ALREADY holds is not offered again", () => {
  const dom = mount(`<label>Mother's maiden name <input id="a"></label>`);
  dom.window.document.getElementById("a").value = "Kamala";
  const key = keyFromLabel("Mother's maiden name");
  const again = newInformation(collectTypedValues(), { [key]: "Kamala" }, keyFromLabel, isCapturableLabel);
  assert.equal(again.find((p) => /maiden/i.test(p.label)), undefined);
});
