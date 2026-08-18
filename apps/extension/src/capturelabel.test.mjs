// A vault KEY is only as good as the label it came from. On a live Lever application the captured
// label for the Gender dropdown was the question PLUS its entire option list and every EEO definition
// paragraph — hundreds of characters, saved as a key. The question is the part before the widget's
// placeholder; anything still paragraph-sized is not a question at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { collectTypedValues } from "./pagecapture.js";

function mount(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ["window", "document", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
    "MouseEvent", "KeyboardEvent", "Event", "Node", "Element"]) global[k] = w[k];
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });
  return dom;
}
const labels = () => collectTypedValues().map((p) => p.label);

test("a dropdown's option list never becomes part of the vault key", () => {
  const dom = mount(`<label>Gender
      <select id="g"><option value="">Select ...</option><option>Male</option><option>Female</option>
        <option>Decline to self-identify</option></select></label>`);
  dom.window.document.getElementById("g").value = "Female";
  const pair = collectTypedValues().find((p) => /gender/i.test(p.label));
  assert.ok(pair, "not captured");
  assert.equal(pair.label, "Gender");
  assert.equal(pair.value, "Female");
});

test("an EEO question keeps its wording but drops the definitions that follow it", () => {
  const dom = mount(`<label>Race
      <select id="r"><option value="">Select ...</option>
        <option>Asian (Not Hispanic or Latino)</option>
        <option>White (Not Hispanic or Latino)</option></select>
      A person having origins in any of the original peoples of the Far East…</label>`);
  dom.window.document.getElementById("r").value = "Asian (Not Hispanic or Latino)";
  const pair = collectTypedValues().find((p) => /^race/i.test(p.label));
  assert.ok(pair, "not captured");
  assert.equal(pair.label, "Race");
  assert.ok(pair.label.length < 40, `label is ${pair.label.length} chars`);
});

test("a plain question is untouched", () => {
  const dom = mount(`<label>How many years of Java experience do you have? <input id="j"></label>`);
  dom.window.document.getElementById("j").value = "8";
  assert.ok(labels().includes("How many years of Java experience do you have?"));
});

test("a paragraph is never saved as a key", () => {
  const dom = mount(`<label>${"We are committed to equal opportunity employment and consider all applicants without regard to any protected characteristic, in line with applicable law, and we ask the following voluntarily. ".repeat(2)}<input id="p"></label>`);
  dom.window.document.getElementById("p").value = "ok";
  assert.equal(labels().find((l) => l.length > 120), undefined, "a paragraph reached the vault as a key");
});
