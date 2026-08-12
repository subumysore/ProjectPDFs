// REAL-browser check for EEO fill + capture — runs the actual engine in real Chrome (real layout,
// real events, real block-text concatenation), which JSDOM cannot reproduce. Standing owner rule:
// verify on real browsers/pages, not mocks. Run:  node apps/app/scripts/real-form-test.mjs
//
// It uses the ADP/Greenhouse EEO shape (question → long description → option rows; option titles that
// run straight into their description). Extend URLS with live public application forms to test those.
import puppeteer from "puppeteer-core";
import { fillPage } from "../../extension/src/pagefill.js";
import { collectTypedValues } from "../../extension/src/pagecapture.js";

const CHROME = process.env.PPF_CHROME
  || "C:/Users/Subramanya Mysore/.cache/puppeteer/chrome/win64-150.0.7871.24/chrome-win64/chrome.exe";

const ADP = `<!doctype html><body style="font-family:Arial">
 <div><div>Are you Hispanic or Latino? *</div><div>A person of Cuban, Mexican, Puerto Rican, South or Central American, or other Spanish culture or origin regardless of race.</div>
   <div><label><input type=radio name=hispanic value=Yes> Yes</label><label><input type=radio name=hispanic value=No> No</label><label><input type=radio name=hispanic value=Decline> Decline to identify</label></div></div>
 <div><div>If you answered 'no', please select one of the following categories:</div><div>Ethnicity *</div>
   <div><label><input type=radio name=race value=White> White<div>Not Hispanic or Latino. Europe.</div></label>
        <label><input type=radio name=race value=Asian> Asian<div>Not Hispanic or Latino. A person having origins in the Far East.</div></label></div></div>
 <select name="metadata-form-0__group__vets100ADisabilitySelect"><option selected>Please check one of the boxes below:</option></select>
</body>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) failures++; };

await page.setContent(ADP, { waitUntil: "load" });
const n = await page.evaluate(async (s) => (eval("(" + s + ")"))({}, null, [], { savedAnswers: { hispanic: "no", race: "asian" } }), fillPage.toString());
const filled = await page.evaluate(() => ({
  hispanic: [...document.querySelectorAll('input[name=hispanic]')].find((i) => i.checked)?.value || null,
  race: [...document.querySelectorAll('input[name=race]')].find((i) => i.checked)?.value || null,
}));
ok(n === 2 && filled.hispanic === "No" && filled.race === "Asian", `FILL both EEO radios (got ${JSON.stringify(filled)}, n=${n})`);

await page.setContent(ADP, { waitUntil: "load" });
await page.evaluate(() => { document.querySelector('input[name=hispanic][value=No]').checked = true; document.querySelector('input[name=race][value=Asian]').checked = true; });
const cap = await page.evaluate((s) => (eval("(" + s + ")"))(), collectTypedValues.toString());
const byLabel = Object.fromEntries(cap.map((c) => [c.label, c.value]));
ok(byLabel["Are you Hispanic or Latino? *"] === "No", "CAPTURE the QUESTION not the description");
ok(byLabel["Ethnicity *"] === "Asian", "CAPTURE race = Asian");
ok(!cap.some((c) => /metadata-form|__group__/.test(c.label) || /please check/i.test(c.value)), "CAPTURE rejects ATS junk ids + placeholders");

await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL REAL-BROWSER CHECKS PASSED");
process.exit(failures ? 1 : 0);
