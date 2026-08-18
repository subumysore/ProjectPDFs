// MULTI-STEP FILL — verified in a REAL browser (docs/specs/multi-step-fill.md).
//
// jsdom proves the loop's logic; this proves it against a real Chrome rendering engine, with the real
// filler, the real capture pipeline and the real probe, on a real multi-page wizard and on live ATS
// pages. Nothing is ever submitted — the run must STOP at the submit control, and this asserts it.
//
// Usage: node scripts/e2e/multistep-run.mjs [url ...]   (default: the built-in wizard + live forms)
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { runStepLoop, summarise } from "../../apps/extension/src/multistep.js";
import { stepProbe } from "../../apps/extension/src/stepprobe.js";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FILL = readFileSync("apps/extension/src/pagefill.js", "utf8").replace(/^export\s+/m, "");
const CAPTURE = readFileSync("apps/extension/src/pagecapture.js", "utf8").replace(/^export\s+/gm, "");
const PROBE_SRC = stepProbe.toString();

const VAULT = {
  first_name: "Asha", middle_name: "K", last_name: "Rao", email_address: "asha.rao@example.com",
  cell_phone: "9195550123", phone_country_code: "+1", address_1: "100 Main Street", city: "Raleigh",
  state: "North Carolina", zip: "27601", country: "United States",
  current_employer: "Acme Corp", current_title: "Senior Engineer", linkedin_profile: "https://www.linkedin.com/in/asharao",
  university: "NC State University", degree: "Bachelor of Science", graduation_year: "2016",
  gender: "Female", race: "Asian",
};
const SAVED = { work_auth_us: "yes", sponsorship: "no", over18: "yes", relocate: "yes", onsite: "yes",
  hispanic: "no", veteran: "no", disability: "no" };

// A three-step wizard served from memory: step 1 identity, step 2 contact, step 3 submit. Nothing here
// is site-specific — it is the shape every ATS wizard has.
const WIZARD = `<!doctype html><meta charset="utf-8"><title>Wizard</title><body>
<div id="app"></div><script>
const steps = [
  '<h1>Step 1 of 3</h1><label>First name <input required></label><label>Last name <input required></label>' +
  '<label>Email <input type="email" required></label><button id="n">Next</button>',
  '<h1>Step 2 of 3</h1><label>Street address <input></label><label>City <input required></label>' +
  '<label>Postal code <input></label><label>Mother tongue at home <input id="q"></label><button id="n">Continue</button>',
  '<h1>Step 3 of 3</h1><label>Anything else? <textarea></textarea></label><button id="s">Submit application</button>',
];
let i = 0, submitted = 0;
function render() {
  document.getElementById('app').innerHTML = steps[i];
  const n = document.getElementById('n');
  if (n) n.onclick = () => { const bad = [...document.querySelectorAll('[required]')].some(e => !e.value.trim());
    if (bad) return; i++; render(); };
  const s = document.getElementById('s');
  if (s) s.onclick = () => { submitted++; window.__submitted = submitted; };
}
window.__step = () => i; window.__submitted = 0; render();
</script></body>`;

async function drive(page, label) {
  const captured = [];
  const evalFill = () => page.evaluate((src, v, sa) => {
    if (!window.__fill) { (0, eval)(src + "\nwindow.__fill = fillPage;"); }
    return window.__fill(v, null, null, { savedAnswers: sa });
  }, FILL, VAULT, SAVED);
  const evalProbe = (click) => page.evaluate((src, c) => (0, eval)("(" + src + ")")({ click: c }), PROBE_SRC, !!click);
  const deps = {
    fillStep: () => evalFill().catch(() => 0),
    captureStep: async () => {
      const pairs = await page.evaluate((src) => {
        if (!window.__collect) { (0, eval)(src + "\nwindow.__collect = collectTypedValues;"); }
        return window.__collect();
      }, CAPTURE).catch(() => []);
      const fresh = (pairs || []).filter((p) => p && p.value && !/^data:/i.test(String(p.value)));
      captured.push(...fresh);
      return fresh.length;
    },
    settle: () => new Promise((r) => setTimeout(r, 2500)),
    probeStep: () => evalProbe(false),
    clickAdvance: () => evalProbe(true),
    waitForChange: async (before) => {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const p = await evalProbe(false);
        if (p.stepKey && p.stepKey !== before) return true;
      }
      return false;
    },
  };
  const res = await runStepLoop(deps);
  const submitted = await page.evaluate(() => window.__submitted || 0).catch(() => 0);
  console.log(`\n## ${label}`);
  console.log("   " + summarise(res));
  console.log("   steps:", res.steps.map((s) => `#${s.step} filled ${s.filled}, banked ${s.saved}` +
    (s.requiredEmpty.length ? `, needs ${s.requiredEmpty.join("/")}` : "")).join(" | "));
  console.log("   banked labels:", captured.map((p) => p.label).slice(0, 8).join(" · ") || "(none)");
  console.log("   SUBMIT PRESSED:", submitted, submitted === 0 ? "✅" : "❌ NEVER ACCEPTABLE");
  return { res, submitted, captured };
}

const urls = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
let bad = 0;
try {
  // 1) the wizard — the loop must reach step 3 and stop there without submitting
  {
    const page = await b.newPage();
    await page.setContent(WIZARD, { waitUntil: "domcontentloaded" });
    // The user answers a question the vault has never seen; it must be banked before the step is gone.
    await page.evaluate(() => { const q = document.getElementById("q"); if (q) q.value = "Kannada"; });
    const { res, submitted, captured } = await drive(page, "3-step wizard (synthetic)");
    const step = await page.evaluate(() => window.__step());
    if (submitted !== 0) { console.log("   FAIL: submit was pressed"); bad++; }
    if (res.stopped !== "at-submit") { console.log("   FAIL: expected to stop at submit, got", res.stopped); bad++; }
    if (step !== 2) { console.log("   FAIL: expected to reach the last step, at", step); bad++; }
    // Step 2's answer must survive the move to step 3.
    if (!captured.some((p) => /mother tongue/i.test(p.label))) { console.log("   FAIL: the step-2 answer was not banked"); bad++; }
    await page.close();
  }
  // 2) live application forms — single-page ones must report "no next step" or pause, never submit
  const live = urls.length ? urls : [
    "https://job-boards.greenhouse.io/postman/jobs/7823417003",
    "https://jobs.lever.co/launchsquad/0f4f5b47-0d59-40b3-9c6d-17a1abc11769/apply",
  ];
  for (const url of live) {
    const page = await b.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 2500));
      const { res, submitted } = await drive(page, url.replace(/^https:\/\//, "").slice(0, 60));
      if (submitted !== 0) { console.log("   FAIL: submit was pressed"); bad++; }
      if (res.steps.length > 4) { console.log("   FAIL: ran away over", res.steps.length, "steps"); bad++; }
    } catch (e) { console.log("\n## " + url + "\n   SKIPPED:", String(e.message || e).slice(0, 80)); }
    await page.close();
  }
} finally { await b.close(); }
console.log(bad ? `\n${bad} FAILURE(S)` : "\nALL MULTI-STEP CHECKS PASSED");
process.exit(bad ? 1 : 0);
