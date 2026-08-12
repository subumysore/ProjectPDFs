// New information typed onto a page is offered for review, never saved silently — and the rule
// that decides what counts as "new" is the part that must not get this wrong: proposing a value
// the vault already holds trains the user to tick without reading, which is how a consent step
// stops being consent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { collectTypedValues, newInformation } from "./pagecapture.js";
import { keyFromLabel, isCapturableLabel } from "./vaultkey.js";

const pick = (typed, vault) => newInformation(typed, vault, keyFromLabel, isCapturableLabel);

test("only genuinely new or CHANGED values are proposed", () => {
  const vault = { email: "a@b.com", full_name: "Asha Rao" };
  const out = pick([
    { label: "Email", value: "a@b.com" },        // unchanged — not proposed
    { label: "Full name", value: "Asha R Rao" }, // changed — proposed, with the prior value
    { label: "Passport no", value: "Z123456" },  // new — proposed
  ], vault);
  assert.deepEqual(out.map((o) => o.key), ["full_name", "passport_no"]);
  assert.equal(out[0].existing, "Asha Rao", "the user must see what they would be replacing");
  assert.equal(out[1].existing, undefined);
});

test("non-Latin labels are captured with their own script (not dropped)", () => {
  const out = pick([{ label: "पूरा नाम", value: "राजेश" }, { label: "全名", value: "陳偉明" }], {});
  assert.deepEqual(out.map((o) => o.key), ["पूरा_नाम", "全名"]);
});

test("row numbers, empty values and images are never proposed", () => {
  const out = pick([
    { label: "1", value: "x" },
    { label: "2.", value: "y" },
    { label: "Photo", value: "data:image/png;base64,AAAA" },
    { label: "City", value: "" },
  ], {});
  assert.deepEqual(out, []);
});

test("the same key appearing twice on a page is proposed once", () => {
  const out = pick([{ label: "Email", value: "x@y.z" }, { label: "email", value: "x@y.z" }], {});
  assert.equal(out.length, 1);
});

test("reading a page: passwords and untouched fields are never read", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <label for="n">Full name</label><input id="n" value="Asha Rao">
    <label for="p">Password</label><input id="p" type="password" value="hunter2">
    <label for="e">Email</label><input id="e" value="">
    <input value="orphan">
    <input name="passportNo" value="Z123456">
    <label for="s">Country</label><select id="s"><option>Select…</option><option selected>India</option></select>
  </body>`);
  globalThis.document = dom.window.document;
  const typed = collectTypedValues();
  assert.deepEqual(typed, [
    { label: "Full name", value: "Asha Rao" },
    // No visible caption, but a meaningful field NAME is a usable label — the user still sees
    // and ticks it before anything is saved.
    { label: "passportNo", value: "Z123456" },
    { label: "Country", value: "India" },
  ], "a password, an empty field and a field with no identity at all must not be read");
});

test("a <select> still on its placeholder is not an answer", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <label for="s">Country</label><select id="s"><option selected>Select…</option><option>India</option></select>
  </body>`);
  globalThis.document = dom.window.document;
  assert.deepEqual(collectTypedValues(), []);
});

test("custom dropdown answers (Workday 'Select One') are captured, placeholder ignored", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div class="form-group">
      <label id="q1">Do you now or will you in the future require sponsorship for a work visa?</label>
      <div role="combobox" aria-labelledby="q1" class="wd-select">No</div>
    </div>
    <div class="form-group">
      <label id="q2">Are you legally authorized to work in the U.S?</label>
      <div role="combobox" aria-labelledby="q2" class="wd-select">Yes</div>
    </div>
    <div class="form-group">
      <label id="q3">Unanswered question</label>
      <div role="combobox" aria-labelledby="q3" class="wd-select">Select One</div>
    </div>
  </body>`);
  globalThis.document = dom.window.document;
  const typed = collectTypedValues();
  const byLabel = Object.fromEntries(typed.map((t) => [t.label, t.value]));
  assert.equal(byLabel["Do you now or will you in the future require sponsorship for a work visa?"], "No");
  assert.equal(byLabel["Are you legally authorized to work in the U.S?"], "Yes");
  // the placeholder-only widget is NOT captured
  assert.equal(typed.some((t) => t.value === "Select One"), false);
});

test("EEO radio answer (Hispanic/Latino) is captured as question → chosen option", () => {
  // ADP-style: the question is a plain element just BEFORE the options; radios share a name.
  const dom = new JSDOM(`<!doctype html><body>
    <div class="field">
      <div class="q">Are you Hispanic or Latino?</div>
      <div class="opts">
        <label><input type="radio" name="hisp" value="yes"> Yes</label>
        <label><input type="radio" name="hisp" value="no" checked> No</label>
        <label><input type="radio" name="hisp" value="decline"> Decline to identify</label>
      </div>
    </div>
  </body>`);
  globalThis.document = dom.window.document;
  const byLabel = Object.fromEntries(collectTypedValues().map((t) => [t.label, t.value]));
  assert.equal(byLabel["Are you Hispanic or Latino?"], "No");
});

test("EEO race checkboxes: only the ticked options are captured, tidy titles not long descriptions", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <fieldset>
      <legend>Ethnicity</legend>
      <label><input type="checkbox" name="race" value="white"><strong>White</strong><div>Not Hispanic or Latino. A person having origins in any of the original peoples of Europe.</div></label>
      <label><input type="checkbox" name="race" value="asian" checked><strong>Asian</strong><div>Not Hispanic or Latino. A person having origins in any of the peoples of the Far East.</div></label>
    </fieldset>
  </body>`);
  globalThis.document = dom.window.document;
  const byLabel = Object.fromEntries(collectTypedValues().map((t) => [t.label, t.value]));
  assert.equal(byLabel["Ethnicity"], "Asian"); // tidy title, only the ticked one
});

test("a lone consent checkbox (label IS the option) is not proposed as a Q/A pair", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <label><input type="checkbox" checked> I agree to the terms and conditions</label>
  </body>`);
  globalThis.document = dom.window.document;
  assert.deepEqual(collectTypedValues(), []);
});

test("choice answers inside an OPEN shadow root are captured too (ADP/web-components)", () => {
  const dom = new JSDOM(`<!doctype html><body><div id="host"></div></body>`);
  const host = dom.window.document.getElementById("host");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<fieldset><legend>Protected veteran status</legend>
    <label><input type="radio" name="vet" value="no" checked> I am not a protected veteran</label>
    <label><input type="radio" name="vet" value="yes"> I am a protected veteran</label></fieldset>`;
  globalThis.document = dom.window.document;
  const byLabel = Object.fromEntries(collectTypedValues().map((t) => [t.label, t.value]));
  assert.equal(byLabel["Protected veteran status"], "I am not a protected veteran");
});

test("captured EEO answers, once in the vault, are proposed only when new (learn flow)", () => {
  // The captured question→answer flows through newInformation like any typed value.
  const typed = [{ label: "Are you Hispanic or Latino?", value: "No" }, { label: "Ethnicity", value: "Asian" }];
  const out = pick(typed, { ethnicity: "Asian" }); // ethnicity already known → not re-proposed
  assert.deepEqual(out.map((o) => o.key), ["are_you_hispanic_or_latino"]);
});

test("ADP junk is NOT captured: internal field-name label + instruction value (regression from a real page)", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <!-- ADP renders a select whose only 'label' is an internal id and whose text is an instruction. -->
    <select name="metadata-form-0__group__vets100ADisabilitySelect">
      <option selected>Please check one of the boxes below:</option>
      <option>I have a disability</option>
      <option>I do not have a disability</option>
    </select>
    <!-- A custom-dropdown wrapper whose class matches [class*=Select] but shows an instruction. -->
    <div class="someDisabilitySelect" role="combobox" aria-label="metadata-form-0__group__x">Select one</div>
  </body>`);
  globalThis.document = dom.window.document;
  const typed = collectTypedValues();
  assert.equal(typed.some((t) => /metadata-form|__group__/.test(t.label)), false, "internal ids must never become a label/key");
  assert.equal(typed.some((t) => /please check|select one/i.test(t.value)), false, "instructions/placeholders must never be saved as a value");
});
