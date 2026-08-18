// Screening and self-ID questions are answered on RADIO groups and NATIVE dropdowns — but every modern
// ATS (Greenhouse, Workday, Lever, Ashby) renders them as a CUSTOM dropdown instead, and those were
// never answered: work authorisation, Gender, Veteran status and Disability status all stayed empty on
// live applications. The rule is unchanged — we never guess a legal or EEO declaration, we only ever
// select the answer the user already gave — it now also reaches the custom widgets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fillPage } from "./pagefill.js";

function mount(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ["window", "document", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
    "MouseEvent", "KeyboardEvent", "Event", "Node", "Element", "getComputedStyle", "CSS"]) global[k] = w[k];
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });
  return dom;
}

// Greenhouse's shape: a react-select whose question lives in a <label for> pointing at the hidden input,
// and whose rows are the widget's own (aria-controls → listbox).
function reactSelect(id, question, options) {
  return `<div class="field">
    <label for="${id}">${question}</label>
    <div class="select__control"><div class="select__value-container">
      <div class="select__placeholder">Select...</div>
      <input id="${id}" class="select__input" role="combobox" aria-controls="${id}-listbox" aria-expanded="true">
    </div></div>
    <div id="${id}-listbox" class="select__menu" role="listbox">
      ${options.map((o, i) => `<div id="${id}-option-${i}" role="option" class="select__option">${o}</div>`).join("")}
    </div>
  </div>`;
}

// The widget commits by re-rendering its display — mimic that so the assertion reads what a user sees.
function commitOnClick(dom) {
  for (const row of dom.window.document.querySelectorAll('[role="option"]')) {
    row.addEventListener("click", () => {
      const menu = row.closest('[role="listbox"]');
      const field = menu.closest(".field");
      const ph = field.querySelector(".select__placeholder");
      if (ph) { ph.className = "select__single-value"; ph.textContent = row.textContent; }
    });
  }
}
const shown = (dom, id) => {
  const f = dom.window.document.getElementById(id).closest(".field");
  const el = f.querySelector(".select__single-value, .select__placeholder");
  return (el.textContent || "").trim();
};

const VAULT = { first_name: "Asha", last_name: "Rao", email_address: "asha.rao@example.com" };

test("work authorisation is answered on a CUSTOM dropdown from the saved answer", async () => {
  const dom = mount(reactSelect("q1", "Are you currently eligible to legally work in the United States? *", ["Yes", "No"]));
  commitOnClick(dom);
  await fillPage(VAULT, null, null, { savedAnswers: { work_auth_us: "yes" } });
  assert.equal(shown(dom, "q1"), "Yes");
});

test("visa sponsorship is answered from the saved answer", async () => {
  const dom = mount(reactSelect("q2", "If hired, do you now or in the future require immigration support or visa sponsorship?", ["Yes", "No"]));
  commitOnClick(dom);
  await fillPage(VAULT, null, null, { savedAnswers: { sponsorship: "no" } });
  assert.equal(shown(dom, "q2"), "No");
});

test("an onsite / hybrid question is its own answer, not the relocation one", async () => {
  const dom = mount(reactSelect("q3", "Are you able to work onsite in one of our offices (San Francisco and/or Berkeley)?", ["Yes", "No"]));
  commitOnClick(dom);
  await fillPage(VAULT, null, null, { savedAnswers: { onsite: "yes", relocate: "no" } });
  assert.equal(shown(dom, "q3"), "Yes");
});

test("Veteran status and Disability status are answered on custom dropdowns", async () => {
  const dom = mount(
    reactSelect("v", "Veteran Status", ["I identify as one or more of the classifications of a protected veteran", "I am not a protected veteran", "I don't wish to answer"]) +
    reactSelect("d", "Disability Status", ["Yes, I have a disability", "No, I do not have a disability and have not had one in the past", "I do not want to answer"]));
  commitOnClick(dom);
  await fillPage(VAULT, null, null, { savedAnswers: { veteran: "no", disability: "no" } });
  assert.match(shown(dom, "v"), /not a protected veteran/i);
  assert.match(shown(dom, "d"), /^No, I do not have a disability/i);
});

test("WITHOUT a saved answer nothing is guessed — the declaration stays blank", async () => {
  const dom = mount(reactSelect("q4", "Are you currently eligible to legally work in the United States? *", ["Yes", "No"]));
  commitOnClick(dom);
  await fillPage(VAULT, null, null, { savedAnswers: {} });
  assert.equal(shown(dom, "q4"), "Select...");
});

test("a widget whose list does not offer our answer is left blank, never approximated", async () => {
  const dom = mount(reactSelect("q5", "Are you a protected veteran?", ["Yes", "I decline to answer"]));
  commitOnClick(dom);
  await fillPage(VAULT, null, null, { savedAnswers: { veteran: "no" } });
  assert.equal(shown(dom, "q5"), "Select...");
});

test("answering one question does not stop the ones after it being answered", async () => {
  // Real cause of a live miss: selecting an option re-renders the whole question list, so every widget
  // collected beforehand was detached and silently skipped.
  const dom = mount(
    reactSelect("a1", "Are you currently eligible to legally work in the United States?", ["Yes", "No"]) +
    reactSelect("a2", "Are you Hispanic/Latino?", ["Yes", "No"]) +
    reactSelect("a3", "Gender", ["Male", "Female", "Decline to self-identify"]));
  commitOnClick(dom);
  await fillPage(VAULT, null, null, { savedAnswers: { work_auth_us: "yes", hispanic: "no", gender: "female" } });
  assert.equal(shown(dom, "a1"), "Yes");
  assert.equal(shown(dom, "a2"), "No");
  assert.equal(shown(dom, "a3"), "Female");
});

// Two plain-text concepts that were in NEITHER engine, so the boxes stayed empty on every form.
test("Current company fills from the stored current employer", async () => {
  const dom = mount(`<div class="application-field"><label for="o">Current company</label><input id="o" name="org"></div>`);
  await fillPage({ ...VAULT, current_employer: "Acme Corp" });
  assert.equal(dom.window.document.getElementById("o").value, "Acme Corp");
});

test("Suffix and Preferred language fill from their own vault keys, and stay blank without them", async () => {
  const dom = mount(`<label>Suffix <input id="s"></label><label>Preferred language <input id="l"></label>`);
  await fillPage({ ...VAULT, suffix: "Jr.", language: "English" });
  assert.equal(dom.window.document.getElementById("s").value, "Jr.");
  assert.equal(dom.window.document.getElementById("l").value, "English");

  const dom2 = mount(`<label>Suffix <input id="s2"></label>`);
  await fillPage(VAULT);
  assert.equal(dom2.window.document.getElementById("s2").value, "");
});
