// The probe decides three things the multi-step run cannot get wrong: which required questions are
// still unanswered, whether there is a way FORWARD, and whether the next click would be SUBMIT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { stepProbe } from "./stepprobe.js";

export function mount(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ["window", "document", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
    "MouseEvent", "KeyboardEvent", "Event", "Node", "Element", "getComputedStyle"]) global[k] = w[k];
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });
  // jsdom has no layout: give every element a real box so the visibility test behaves as on a page.
  w.Element.prototype.getBoundingClientRect = function () { return { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }; };
  return dom;
}

test("a Next button is the way forward; Submit is never treated as one", () => {
  mount(`<form><input name="a"><button type="button">Next</button></form>`);
  const p = stepProbe({});
  assert.equal(p.advance, "Next");
  assert.equal(p.submit, null);
});

test("a button labelled 'Submit application' is reported as submit, never as advance", () => {
  mount(`<form><input name="a"><button type="button">Submit application</button></form>`);
  const p = stepProbe({});
  assert.equal(p.advance, null, `"${p.advance}" was offered as a way forward`);
  assert.match(p.submit, /submit application/i);
});

test("'Save and continue' counts as advance", () => {
  mount(`<button type="button">Save and continue</button>`);
  assert.match(stepProbe({}).advance, /save and continue/i);
});

test("a required empty field is named; a required filled one is not", () => {
  const dom = mount(`
    <label>First name <input id="f" required></label>
    <label>Last name <input id="l" required></label>`);
  dom.window.document.getElementById("f").value = "Asha";
  const p = stepProbe({});
  assert.deepEqual(p.requiredEmpty, ["Last name"]);
});

test("a required question marked only with an asterisk still counts", () => {
  mount(`<label>Work authorisation * <input id="w"></label>`);
  assert.equal(stepProbe({}).requiredEmpty.length, 1);
});

test("a custom dropdown that already shows a choice is not reported as empty", () => {
  mount(`<div class="field"><label id="q">Country</label>
      <div class="ant-select" role="combobox" aria-required="true" aria-labelledby="q">
        <span class="ant-select-selection-item">United States</span></div></div>
    <input aria-labelledby="q" aria-required="true" value="">`);
  assert.deepEqual(stepProbe({}).requiredEmpty, []);
});

test("an unanswered custom dropdown IS reported", () => {
  mount(`<div class="field"><label id="q">Country</label>
      <div class="ant-select" role="combobox"><span class="ant-select-selection-item">Select one</span></div>
      <input aria-labelledby="q" required value=""></div>`);
  assert.deepEqual(stepProbe({}).requiredEmpty, ["Country"]);
});

test("a radio group answered anywhere in the group counts as answered", () => {
  const dom = mount(`<fieldset><legend>Are you 18 or over? *</legend>
      <label><input type="radio" name="age" required value="Yes"> Yes</label>
      <label><input type="radio" name="age" required value="No"> No</label></fieldset>`);
  assert.equal(stepProbe({}).requiredEmpty.length, 1);
  dom.window.document.querySelector('input[value="Yes"]').checked = true;
  assert.deepEqual(stepProbe({}).requiredEmpty, []);
});

test("clicking advance clicks ONLY the advance control", () => {
  const dom = mount(`<button id="n" type="button">Continue</button><button id="s" type="button">Submit</button>`);
  const d = dom.window.document;
  let next = 0, submit = 0;
  d.getElementById("n").addEventListener("click", () => next++);
  d.getElementById("s").addEventListener("click", () => submit++);
  stepProbe({ click: true });
  assert.equal(next, 1);
  assert.equal(submit, 0, "the submit button was pressed");
});

test("the step fingerprint changes when the questions change", () => {
  const dom = mount(`<label>First name <input></label>`);
  const a = stepProbe({}).stepKey;
  dom.window.document.body.innerHTML = `<label>Home address <input></label>`;
  assert.notEqual(stepProbe({}).stepKey, a);
});

test("a 'Review your application' page is recognised as the end, even without a Submit button yet", () => {
  mount(`<h1>Review your application</h1><button type="button">Next</button>`);
  assert.equal(stepProbe({}).reviewText, true);
});
