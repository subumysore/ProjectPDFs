// COVERAGE RUN — drive the real engine over real application forms and report, per form, every control
// and whether it filled, classifying each miss so we know WHO has to fix it:
//
//   vault gap   the field matched a concept, but the vault holds no value for it (add the key)
//   engine gap  the vault HAS a value and the field still ended up empty (our bug)
//   no concept  nothing in the engine recognises this label (our bug, of a different kind)
//   by design   screening / self-ID / consent — never guessed, only ever from a saved answer
//
// Usage:  node scripts/e2e/coverage-run.mjs [url ...]     (defaults to the built-in form list)
// Nothing is ever submitted: forms are filled and read, then the browser closes. Test data only.
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SRC = readFileSync("apps/extension/src/pagefill.js", "utf8").replace(/^export\s+/m, "");
const ASSESS = readFileSync("apps/extension/src/fillassess.js", "utf8").replace(/^export\s+/gm, "");

// A DELIBERATELY COMPLETE vault: anything still empty afterwards is then a real finding, not a blank key.
const VAULT = {
  first_name: "Asha", middle_name: "K", last_name: "Rao", full_name: "Asha K Rao",
  email_address: "asha.rao@example.com", confirm_email_address: "asha.rao@example.com",
  cell_phone: "9195550123", home_phone: "9195550124", phone_country_code: "+1",
  address_1: "100 Main Street", address_2: "Apt 4B", city: "Raleigh", state: "North Carolina",
  zip: "27601", country: "United States", county: "Wake",
  linkedin_profile: "https://www.linkedin.com/in/asharao", website: "https://asharao.example.com",
  current_employer: "Acme Corp", current_title: "Senior Engineer", years_experience: "8",
  university: "NC State University", degree: "Bachelor of Science", field_of_study: "Computer Science",
  graduation_year: "2016", gpa: "3.8",
  date_of_birth: "11/30/1990", gender: "Female", race: "Asian", hispanic_latino: "No",
  veteran_status: "I am not a protected veteran", disability_status: "No",
  work_authorization: "Yes", sponsorship_required: "No", desired_salary: "150000",
  native_language: "en", preferred_contact_method: "Email",
  salutation: "Ms.", suffix: "", language: "English", current_location: "Raleigh, North Carolina",
};

// Screening / eligibility answers the user has pre-set in "Common answers". The engine NEVER guesses
// these — it only ever selects an answer the user stored — so a coverage run without them understates
// what the product does on an ATS form full of Yes/No eligibility questions.
const SAVED_ANSWERS = {
  work_auth_us: "yes", work_auth_ca: "yes", sponsorship: "no", over18: "yes", relocate: "yes",
  felony: "no", clearance: "no", gov_employee: "no", restrictions: "no", proof_identity: "yes",
  hispanic: "no", veteran: "no", disability: "no",
};

const FORMS = [
  ["Dayforce (Ceridian)", "https://jobs.dayforcehcm.com/en-US/hhglobal/CANDIDATEPORTAL/jobs/23708/apply/manualApplication?source=LinkedIn&applicationSource=Manual"],
  ["Greenhouse (Postman)", "https://job-boards.greenhouse.io/postman/jobs/7823417003"],
  ["Greenhouse (City of Fort Worth)", "https://job-boards.greenhouse.io/cityoffortworth/jobs/7662064003"],
  ["Lever (LaunchSquad)", "https://jobs.lever.co/launchsquad/0f4f5b47-0d59-40b3-9c6d-17a1abc11769/apply"],
  ["Lever (Magna Legal)", "https://jobs.lever.co/magnals/cf051e03-c069-44bb-9590-d98080b4aca5/apply"],
  // Ashby is the fourth ATS the owner's target roles use. Its application is a single page whose place
  // box is a type-ahead and whose screening questions are free text — a good test of "pause, don't guess".
  ["Ashby (Ashby)", "https://jobs.ashbyhq.com/ashby/206c6a86-74e3-4fcf-9175-fdfe07858676/application"],
];

// Labels we deliberately never guess: legal / self-ID / consent.
const BY_DESIGN = /race|ethnic|hispanic|latino|veteran|disab|gender|sex\b|consent|agree|privacy|terms|acknowledg|certif|signature|how did you hear|referr|salary|cover letter|resume|upload|attach|password|captcha/i;

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function runOne(browser, [name, url]) {
  const page = await browser.newPage();
  const out = { name, url, ok: false, items: [], error: null, blocked: false, skipped: false };
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });
    await new Promise((r) => setTimeout(r, 4500));
    // Is this page even measurable? A CAPTCHA / "verify you are human" wall blocks automation by
    // design, and a job LISTING page has no application form at all. Report those as blocked/skipped
    // instead of pretending the engine failed to fill them.
    const gate = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      // Almost every ATS page LOADS recaptcha for submission — that is not a wall. A wall is a visible
      // challenge that replaces the form: a challenge iframe/widget on screen, or the tell-tale text.
      const challengeVisible = [...document.querySelectorAll(
        "iframe[src*='recaptcha'], iframe[src*='hcaptcha'], iframe[src*='challenge'], .g-recaptcha, [class*='turnstile']")]
        .some((e) => e.offsetParent !== null && e.getBoundingClientRect().height > 40);
      const wallText = /are you a human|verify you are human|press and hold|unusual traffic/i.test(document.body.innerText || '');
      const fields = [...document.querySelectorAll('input, textarea, select')]
        .filter((e) => !['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes((e.type || '').toLowerCase()))
        .filter((e) => e.offsetParent !== null).length;
      const applyish = /apply|application|first name|resume|cover letter/i.test(document.body.innerText || '');
      return { blockedNow: (challengeVisible || wallText) && fields < 3, fields, applyish };
    });
    if (gate.blockedNow) { out.error = 'BLOCKED: human verification (CAPTCHA) — cannot be measured automatically'; out.blocked = true; return out; }
    if (gate.fields < 3 || !gate.applyish) { out.error = 'SKIPPED: no application form on this page (listing/search page)'; out.skipped = true; return out; }
    await page.evaluate(async (src, vault, saved) => {
      const fn = new Function(`${src}; return fillPage;`)();
      return await fn(vault, null, null, { diag: true, savedAnswers: saved });
    }, SRC, VAULT, SAVED_ANSWERS);
    await new Promise((r) => setTimeout(r, 7000));
    const readAssessment = () => page.evaluate((assessSrc) => {
      const { assessForm } = new Function(`${assessSrc}\n return { assessForm };`)();
      const a = assessForm({ includeOptional: true });
      const d = window.__ppfDiag || {};
      return { items: a.items || [], matched: d.matched || [] };
    }, ASSESS);
    let res;
    try { res = await readAssessment(); }
    catch (_) { await new Promise((r) => setTimeout(r, 2000)); res = await readAssessment(); }
    out.items = res.items.map((i) => {
      const m = res.matched.find((x) => norm(x.label).includes(norm(i.label)) || norm(i.label).includes(norm(x.label)));
      let why = null;
      if (!i.filled) {
        if (BY_DESIGN.test(i.label)) why = "by design";
        else if (!m) why = "no concept";
        else if (m.resolved === "(EMPTY)") why = "vault gap";
        else why = "engine gap";
      }
      return { label: i.label, filled: i.filled, value: i.value, required: i.required, why };
    });
    out.ok = true;
  } catch (e) {
    out.error = e.message.slice(0, 120);
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}

const urls = process.argv.length > 2 ? process.argv.slice(2).map((u) => ["(cli)", u]) : FORMS;
const browser = await puppeteer.launch({ protocolTimeout: 300000, executablePath: CHROME, headless: false, defaultViewport: null, args: ["--window-size=1400,1100"] });
const results = [];
for (const f of urls) { const r = await runOne(browser, f); results.push(r); console.log(`done: ${r.name} ${r.error ? "ERROR " + r.error : `${r.items.filter((i) => i.filled).length}/${r.items.length}`}`); }
await browser.close();

console.log("\n================ COVERAGE ================");
for (const r of results) {
  if (!r.ok) { console.log(`\n## ${r.name}\n  ERROR: ${r.error}`); continue; }
  const filled = r.items.filter((i) => i.filled);
  console.log(`\n## ${r.name} — ${filled.length}/${r.items.length} filled`);
  const byWhy = {};
  for (const i of r.items.filter((x) => !x.filled)) (byWhy[i.why] ||= []).push(i.label + (i.required ? " *" : ""));
  for (const why of ["engine gap", "no concept", "vault gap", "by design"]) {
    if (byWhy[why]) console.log(`  ${why.padEnd(11)} (${byWhy[why].length}): ${byWhy[why].join(" · ")}`);
  }
}
console.log("\n(* = required field)");
