// Verification-framework tests: assessForm() reports, for ANY form, what was asked and whether each
// control was filled — with special attention to vault-backed fields. Uses JSDOM; since JSDOM has no
// layout, we stub the visibility signals (offsetParent / getBoundingClientRect) so the enumerator runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { assessForm } from "./fillassess.js";

function withDom(html, fn) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  const { window } = dom;
  // Make every element "visible" for the assessment (JSDOM reports 0 size / null offsetParent).
  Object.defineProperty(window.HTMLElement.prototype, "offsetParent", { get() { return this.parentNode; }, configurable: true });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
  const g = globalThis;
  const saved = { document: g.document, window: g.window, getComputedStyle: g.getComputedStyle, CSS: g.CSS, HTMLElement: g.HTMLElement };
  g.document = window.document; g.window = window; g.getComputedStyle = window.getComputedStyle.bind(window);
  g.CSS = window.CSS || { escape: (s) => s }; g.HTMLElement = window.HTMLElement;
  try { return fn(window); } finally { Object.assign(g, saved); }
}

test("assessForm: reports each control the form asks for, across types", () => {
  withDom(`
    <label>First Name*<input aria-label="First Name" required></label>
    <label>Email*<input aria-label="Email" type="email" required></label>
    <label>Mobile<input aria-label="Mobile" type="tel" value="+1"></label>
    <fieldset><legend>Are you eligible?</legend>
      <input type="radio" name="elig" value="yes"><input type="radio" name="elig" value="no"></fieldset>
  `, () => {
    const r = assessForm();
    const labels = r.items.map((i) => i.label);
    assert.ok(labels.includes("First Name"), "First Name asked");
    assert.ok(labels.includes("Email"), "Email asked");
    assert.ok(labels.includes("Mobile"), "Mobile asked");
    assert.equal(r.total, r.items.length);
  });
});

test("assessForm: a tel field showing only a dialing-code stub counts as NOT filled", () => {
  withDom(`<label>Mobile<input aria-label="Mobile" type="tel" value="+1"></label>`, () => {
    const r = assessForm();
    const mob = r.items.find((i) => i.label === "Mobile");
    assert.equal(mob.filled, false, "\"+1\" stub is empty, not filled");
  });
});

test("assessForm: filled vs missed — required empties surface in `missed`", () => {
  withDom(`
    <label>First Name*<input aria-label="First Name" required value="SUBRAMANYA"></label>
    <label>Email*<input aria-label="Email" required></label>
  `, () => {
    const r = assessForm();
    const first = r.items.find((i) => i.label === "First Name");
    const email = r.items.find((i) => i.label === "Email");
    assert.equal(first.filled, true, "First Name filled");
    assert.equal(email.filled, false, "Email empty");
    assert.ok(r.missed.some((m) => m.label === "Email"), "required-empty Email is a miss");
    assert.ok(!r.missed.some((m) => m.label === "First Name"), "filled required is not a miss");
    assert.equal(r.required, 2);
    assert.equal(r.requiredFilled, 1);
  });
});

test("assessForm: a select left on its placeholder is not counted as filled", () => {
  withDom(`
    <label>Country<select aria-label="Country">
      <option value="">Please choose…</option><option value="US">United States</option>
    </select></label>
  `, () => {
    const r = assessForm();
    const c = r.items.find((i) => i.label === "Country");
    assert.equal(c.filled, false, "unchosen select is not filled");
  });
});
