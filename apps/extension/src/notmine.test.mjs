// Boxes that are NOT the applicant's to answer must stay empty — on BOTH engines.
//
// Found 2026-07-23 filling real government forms:
//   • HK ID995A `HKIDCheckingDigit` (a DERIVED check digit) was filled from the ID number.
//   • A "Correspondence address" box was silently filled with the RESIDENTIAL address, which
//     invents a fact: the form offers a "same as above" tick precisely because they differ.
// In both cases a wrong answer is worse than a blank, because the user cannot see it happen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { resolveFields } from "./resolver.js";

const VAULT = {
  full_name: "Li Wei Chen",
  street_address: "12 Nathan Road",
  city: "Kowloon",
  hkid: "A1234567",
  id_number: "A1234567",
};

const ask = (labels, vault = VAULT) =>
  resolveFields(vault, labels.map((label) => ({ label, maxLength: -1 })));

test("PDF: a check digit is never auto-filled", () => {
  const labels = ["HKID Number", "HKIDCheckingDigit", "Check Digit", "Checksum", "Control Digit"];
  const [, ...derived] = ask(labels);
  for (let i = 0; i < derived.length; i++) {
    assert.equal(derived[i], null, `${labels[i + 1]} must be left for the issuing office`);
  }
});

// The exact field from the real HK GF340 form, with its real caption and real name. Its caption
// says "Last Digit" (and "last" is an alias for the surname, in a 1-char box), so it resolved to
// the family-name INITIAL — the form went out claiming a check digit of "C". Neither the caption
// alone nor the name alone is enough to catch it: the caption looks like an identity field and
// the name doesn't split into words. Both are checked.
test("PDF: the real HKIDCheckingDigit field stays empty", () => {
  const [v] = resolveFields(VAULT, [{
    label: "Last Digit\r最後數字",
    name: "form1[0].Page2[0].HKIDCheckingDigit[0]",
    maxLength: 1,
  }]);
  assert.equal(v, null, "a derived check digit must never be guessed");
});

test("PDF: the field NAME alone is enough, even with a wholly innocuous caption", () => {
  const [v] = resolveFields(VAULT, [{ label: "Digit", name: "HKIDCheckingDigit", maxLength: 1 }]);
  assert.equal(v, null);
});

test("PDF: office-use boxes are never auto-filled", () => {
  const labels = ["For Official Use Only", "For office use", "Received by", "Approved by",
    "Do not write below this line", "Verified by"];
  for (const [i, v] of ask(labels).entries()) {
    assert.equal(v, null, `"${labels[i]}" is the office's box, not the applicant's`);
  }
});

test("PDF: correspondence address does NOT mirror the residential one", () => {
  const [home, corr] = ask(["Residential Address", "Correspondence Address"]);
  assert.ok(home, "the plain address should still be filled");
  assert.equal(corr, null, "a different address must not be invented from the residential one");
});

test("PDF: a correspondence address IS filled from its own vault key", () => {
  const vault = { ...VAULT, correspondence_address: "PO Box 88, Central" };
  const [home, corr] = ask(["Residential Address", "Correspondence Address"], vault);
  assert.ok(home);
  assert.equal(corr, "PO Box 88, Central");
});

test("PDF: when the ONLY address asked for is qualified, it is the address wanted", () => {
  const [only] = ask(["Mailing Address"]);
  assert.ok(only && /Nathan Road/.test(only), "a lone mailing-address field should be filled");
});

// ---- the web engine must behave identically -------------------------------------------------
async function fillHtml(html, vault = VAULT) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: "https://example.test/" });
  for (const k of ["window", "document", "HTMLInputElement", "HTMLTextAreaElement", "Event", "HTMLElement"]) {
    globalThis[k] = k === "window" ? dom.window : dom.window[k];
  }
  const { fillPage } = await import("./pagefill.js");
  await fillPage(vault, null);
  return dom;
}
// Build the fixture the way pagefill.test.mjs does: a <label for> that really associates.
const field = (id, text) => `<label for="${id}">${text}</label><input id="${id}" name="${id}">`;

test("web: a check digit and an office-use box are left alone", async () => {
  const dom = await fillHtml(
    field("idno", "HKID Number") + field("cd", "Check Digit") + field("ou", "For Official Use Only"),
  );
  const val = (id) => dom.window.document.getElementById(id).value;
  assert.equal(val("cd"), "", "check digit must stay empty");
  assert.equal(val("ou"), "", "office-use box must stay empty");
});

test("web: correspondence address does not mirror residential, but its own key fills it", async () => {
  const html = field("res", "Residential Address") + field("corr", "Correspondence Address");
  const a = await fillHtml(html);
  assert.equal(a.window.document.getElementById("corr").value, "", "must not copy the home address");
  assert.ok(a.window.document.getElementById("res").value, "the plain address should be filled");

  const b = await fillHtml(html, { ...VAULT, correspondence_address: "PO Box 88, Central" });
  assert.equal(b.window.document.getElementById("corr").value, "PO Box 88, Central");
});

test("web: a script-qualified name is not filled with the Latin name", async () => {
  const html = field("en", "Full Name") + field("zh", "Chinese Name");
  const a = await fillHtml(html);
  assert.equal(a.window.document.getElementById("zh").value, "", "never the Latin name");

  const b = await fillHtml(html, { ...VAULT, chinese_name: "陳偉明" });
  assert.equal(b.window.document.getElementById("zh").value, "陳偉明");
});
