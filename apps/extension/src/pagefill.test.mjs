// Automated browser-fill tests (jsdom) for the injected fillPage — the logic that used to
// be verified only by hand on live forms. Each test builds a synthetic form covering an
// edge case we actually hit (Material inputs, dd/mm date pickers, gender Male/Female trap,
// typo'd ids, tel-less phone, country dropdowns) and asserts the fill result.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fillPage } from "./pagefill.js";

// Mount a synthetic document and expose the DOM globals fillPage relies on.
function mount(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ["window", "document", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
    "MouseEvent", "KeyboardEvent", "Event", "Node", "Element"]) global[k] = w[k];
  // jsdom doesn't do layout, so offsetParent is always null; make visible nodes report a
  // parent so the custom-dropdown option filter (o.offsetParent !== null) can work.
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });
  return dom;
}
const $ = (dom, sel) => dom.window.document.querySelector(sel);

test("basic fields fill from the vault (given/family/email)", async () => {
  const dom = mount(`
    <label>First name <input id="a"></label>
    <label>Last name <input id="b"></label>
    <label>Email <input id="c" type="email"></label>`);
  await fillPage({ first_name: "Asha", last_name: "Rao", email_address: "asha@example.com" });
  assert.equal($(dom, "#a").value, "Asha");
  assert.equal($(dom, "#b").value, "Rao");
  assert.equal($(dom, "#c").value, "asha@example.com");
});

test("matched by VISIBLE caption despite a typo'd id (passportExpirtyDate)", async () => {
  const dom = mount(`
    <div class="form-field"><span>Passport Number</span><input id="pn"></div>
    <div class="form-field"><span>Passport Expiry Date</span>
      <input id="passportExpirtyDate" placeholder="Please select the date"></div>`);
  await fillPage({ passport_no: "A35227954", passport_expiry_date: "08/09/2033" });
  assert.equal($(dom, "#pn").value, "A35227954");
  const exp = $(dom, "#passportExpirtyDate").value;
  assert.notEqual(exp, "A35227954");           // NOT the passport number (the bug)
  assert.ok(/2033/.test(exp), `expiry has the year: ${exp}`);
});

test("date self-corrects to the format the field accepts (dd/mm) on the FIRST fill", async () => {
  const dom = mount(`<div class="field"><span>Date of Birth</span><input id="dob"></div>`);
  const el = $(dom, "#dob");
  // Simulate a picker that ONLY accepts dd/mm/yyyy: mark ng-invalid unless day<=31 & month<=12
  // when read as dd/mm. (US "11/30/1968" => day 11, month 30 => invalid.)
  el.addEventListener("input", () => {
    const m = el.value.match(/^(\d{1,2})\/(\d{1,2})\/\d{4}$/);
    const ok = m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12;
    el.className = ok ? "field ng-valid" : "field ng-invalid";
  });
  await fillPage({ date_of_birth: "11/30/1968" });
  assert.equal(el.value, "30/11/1968"); // swapped into the accepted order automatically
});

test("phone fills from a numeric-example placeholder + maxlength (no type/label)", async () => {
  const dom = mount(`<div class="mat-form-field"><input id="ph" placeholder="012345648382" maxlength="15"></div>`);
  await fillPage({ home_phone: "6503905612" });
  assert.ok(/6503905612/.test($(dom, "#ph").value), `phone filled: ${$(dom, "#ph").value}`);
});

test("phone heuristic does NOT hijack a Reference Number field", async () => {
  const dom = mount(`<div class="field"><span>Reference Number</span><input id="ref" placeholder="0123456789" maxlength="12"></div>`);
  await fillPage({ home_phone: "6503905612" });
  assert.equal($(dom, "#ref").value, ""); // guarded — reference number is left alone
});

test("native <select> gender: 'M' picks Male, never Female", async () => {
  const dom = mount(`
    <label>Gender <select id="g"><option value="">Select</option><option>Female</option><option>Male</option></select></label>`);
  await fillPage({ gender: "M" });
  assert.equal($(dom, "#g").value, "Male");
});

test("native <select> nationality: 'USA' selects United States", async () => {
  const dom = mount(`
    <label>Nationality <select id="n"><option value="">Select</option><option>India</option><option>United States</option></select></label>`);
  await fillPage({ nationality: "USA", country: "USA" });
  assert.equal($(dom, "#n").value, "United States");
});

test("unrelated fields are left untouched (no false fills)", async () => {
  const dom = mount(`<label>Favourite colour <input id="fav"></label>`);
  await fillPage({ first_name: "Asha" });
  assert.equal($(dom, "#fav").value, "");
});
