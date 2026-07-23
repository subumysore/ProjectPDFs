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
