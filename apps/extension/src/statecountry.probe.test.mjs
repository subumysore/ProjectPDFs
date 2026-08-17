// STATE / COUNTRY, abbreviated vs full: a form may want "NC" or "North Carolina", "US" or "United
// States", in a dropdown or in a plain text box — and the vault may hold either form. Every
// combination must fill. The gap this pins down: a FULL name going into a maxlength-limited box was
// skipped entirely (left blank), because a value with letters that does not fit is normally a wrong
// match. For a state/country it is not a wrong match, it is a form asking for the short code.
//
// Also asserts the capture side: answering a NEW question yields a key/value pair for the vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fillPage } from "./pagefill.js";
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

const VAULT_ABBR = { first_name: "Asha", state: "NC", country: "US" };
const VAULT_FULL = { first_name: "Asha", state: "North Carolina", country: "United States" };

// [id, html, expected-with-abbrev-vault, expected-with-full-vault]
const CASES = [
  ["t1", `<label>State <input id="t1"></label>`, "NC", "North Carolina"],
  ["t2", `<label>State <input id="t2" maxlength="2"></label>`, "NC", "NC"],
  ["t3", `<label>State <input id="t3" placeholder="NC"></label>`, "NC", "North Carolina"],
  ["s1", `<label>State <select id="s1"><option value=""></option><option>North Carolina</option><option>New York</option></select></label>`, "North Carolina", "North Carolina"],
  ["s2", `<label>State <select id="s2"><option value=""></option><option>NC</option><option>NY</option></select></label>`, "NC", "NC"],
  ["s3", `<label>State <select id="s3"><option value=""></option><option value="NC">North Carolina</option></select></label>`, "NC", "NC"],
  ["c1", `<label>Country <input id="c1"></label>`, "US", "United States"],
  ["c2", `<label>Country <input id="c2" maxlength="2"></label>`, "US", "US"],
  ["c3", `<label>Country <input id="c3" maxlength="3"></label>`, "US", "USA"],
  ["c4", `<label>Country <select id="c4"><option value=""></option><option>United States</option><option>India</option></select></label>`, "United States", "United States"],
  ["c5", `<label>Country <select id="c5"><option value=""></option><option>US</option><option>IN</option></select></label>`, "US", "US"],
];

test("state/country fill whichever form the page wants, from whichever form the vault holds", async () => {
  for (const [id, html, wantAbbrVault, wantFullVault] of CASES) {
    for (const [vault, want, which] of [[VAULT_ABBR, wantAbbrVault, "vault=abbrev"], [VAULT_FULL, wantFullVault, "vault=full"]]) {
      const dom = mount(html);
      await fillPage(vault);
      const got = dom.window.document.getElementById(id).value;
      assert.equal(got, want, `${id} (${which}): expected "${want}", got "${got || "(blank)"}"`);
    }
  }
});

test("a value that genuinely does not fit is still skipped, not truncated", async () => {
  // A 2-char box labelled something unrelated must NOT receive a long value (the original guard).
  const dom = mount(`<label>Middle initial <input id="mi" maxlength="2"></label>`);
  await fillPage({ middle_name: "Kumaraswamy" });
  const v = dom.window.document.getElementById("mi").value;
  assert.ok(v === "" || v.length <= 2, `expected blank or an initial, got "${v}"`);
  // An unknown country in a 2-char box: no guess, leave it blank.
  const dom2 = mount(`<label>Country <input id="c" maxlength="2"></label>`);
  await fillPage({ country: "Wakanda" });
  assert.equal(dom2.window.document.getElementById("c").value, "");
});

test("answering a new question produces a key/value pair the vault can store", async () => {
  const dom = mount(`
    <label>What is your mother's maiden name? <input id="q1"></label>
    <label>Preferred pronoun <input id="q2"></label>
    <label>State <input id="q3"></label>`);
  const d = dom.window.document;
  d.getElementById("q1").value = "Kamala";
  d.getElementById("q2").value = "she/her";
  d.getElementById("q3").value = "NC";

  const typed = collectTypedValues();
  assert.ok(typed.length >= 3, `expected the typed answers to be captured, got ${JSON.stringify(typed)}`);

  // Against a vault that already knows the state, only the two NEW answers are offered, each with the
  // key the vault will store them under.
  const fresh = newInformation(typed, { state: "NC" }, keyFromLabel, isCapturableLabel);
  const byKey = Object.fromEntries(fresh.map((p) => [p.key, p.value]));
  assert.ok(Object.values(byKey).includes("Kamala"), `maiden name not offered: ${JSON.stringify(fresh)}`);
  assert.ok(Object.values(byKey).includes("she/her"), `pronoun not offered: ${JSON.stringify(fresh)}`);
  assert.ok(!fresh.some((p) => p.value === "NC"), "already-known state should not be re-offered");
  for (const p of fresh) assert.ok(p.key && /^[a-z0-9_]+$/.test(p.key), `bad vault key: ${p.key}`);
});
