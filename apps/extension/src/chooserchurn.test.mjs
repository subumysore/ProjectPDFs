// A combobox SEARCH box is transient: the widget wipes it once an option is chosen. Nothing may read
// that wipe as "our value was lost", or we re-type the term, the widget wipes it again, and the field
// visibly dances for seconds (measured on a live ATS: 4 extra bursts over 8s, 237 value writes).
//
// The rule is stated in ARIA terms FIRST (role=combobox, aria-autocomplete, aria-haspopup=listbox), so
// it holds for any widget library that implements the pattern correctly, with class-name matching only
// as a backstop for libraries that skip the roles. These tests assert the ARIA rule, no vendor names.
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

// Count value writes, and let the widget wipe its own search box right after each write — the exact
// behaviour that used to trigger an endless re-type.
function instrument(dom, selector) {
  const w = dom.window;
  const target = w.document.querySelector(selector);
  // Patch the PROTOTYPE accessor — that is the one the filler writes through. A per-element override
  // would never be called, and the test would silently measure nothing.
  const d = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value");
  const log = [];
  Object.defineProperty(w.HTMLInputElement.prototype, "value", {
    configurable: true,
    get() { return d.get.call(this); },
    set(v) {
      if (this !== target) return d.set.call(this, v);
      log.push(String(v));
      d.set.call(this, v);
      // The widget clears its own text and takes focus away — keep-alive deliberately never fights a
      // field that still has focus, so the blur is what makes this a fair test of the revert path.
      if (v) setTimeout(() => { d.set.call(this, ""); try { this.blur(); } catch (_) { /* jsdom */ } }, 5);
    },
  });
  return log;
}

test("a search box of an ARIA combobox is not re-typed when the widget clears it", async () => {
  const dom = mount(`<div><span>Country</span>
    <input id="cb" role="combobox" aria-expanded="false" aria-autocomplete="list"></div>`);
  const log = instrument(dom, "#cb");
  await fillPage({ country: "United States" });
  await new Promise((r) => setTimeout(r, 1500)); // past the settle retry and the keep-alive passes
  assert.ok(log.length <= 4, `search box was written ${log.length} times: ${JSON.stringify(log)}`);
});

test("a PLAIN text field is still re-typed when a framework really does revert it", async () => {
  const dom = mount(`<label>First name <input id="fn"></label>`);
  const log = instrument(dom, "#fn"); // same hostile wipe, but this is a real field
  await fillPage({ first_name: "Asha" });
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(log.length >= 2, `a reverted plain field must be re-applied, saw ${log.length} write(s)`);
});

test("the rule is ARIA-based, not class-based: no vendor class, still recognised", async () => {
  const dom = mount(`<div><span>Country</span>
    <input id="cb" aria-haspopup="listbox" aria-expanded="false"></div>`);
  const log = instrument(dom, "#cb");
  await fillPage({ country: "United States" });
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(log.length <= 4, `search box was written ${log.length} times: ${JSON.stringify(log)}`);
});
