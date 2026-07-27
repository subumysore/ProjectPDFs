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

// --- readOnly handling (bug found 2026-07-23 by end-to-end testing against real forms) ---
// A readOnly TEXT field is one the site does not want changed (server-issued reference number,
// computed total); writing there can corrupt a submission or fail server-side validation.
// But date pickers are routinely readOnly and MUST still fill, so this cannot be a blanket skip.

test("readOnly text field is NOT filled (site-locked value)", async () => {
  const dom = mount(`
    <label>Street address <input id="addr"></label>
    <label>Reference number <input id="ref" readonly></label>`);
  await fillPage({ street_address: "12 Nathan Road", city: "Kowloon" });
  assert.equal($(dom, "#ref").value, "", "a readOnly reference field must stay empty");
  assert.equal($(dom, "#addr").value, "12 Nathan Road");
});

test("readOnly NATIVE date input is still filled (picker, not locked)", async () => {
  const dom = mount(`<label>Date of birth <input id="dob" type="date" readonly></label>`);
  await fillPage({ date_of_birth: "1990-04-15" });
  assert.notEqual($(dom, "#dob").value, "", "a readOnly native date input must still fill");
});

test("readOnly datepicker-widget field is still filled", async () => {
  const dom = mount(`<label>Date of birth <input id="dob" class="mat-datepicker-input" readonly></label>`);
  await fillPage({ date_of_birth: "1990-04-15" });
  assert.notEqual($(dom, "#dob").value, "", "a readOnly datepicker widget must still fill");
});

test("disabled field is never filled", async () => {
  const dom = mount(`<label>System ID <input id="sys" disabled></label>`);
  await fillPage({ first_name: "Asha", street_address: "12 Nathan Road" });
  assert.equal($(dom, "#sys").value, "");
});

test("password fields fill from the vault (Password + Confirm Password), typed key-by-key", async () => {
  const dom = mount(`
    <label>Password <input id="p1" type="password"></label>
    <label>Confirm Password <input id="p2" type="password"></label>`);
  const n = await fillPage({ password: "Tashkent08!!" });
  assert.equal($(dom, "#p1").value, "Tashkent08!!");
  assert.equal($(dom, "#p2").value, "Tashkent08!!");
  assert.ok(n >= 2, `filled at least the two password fields (got ${n})`);
});

test("a HIDDEN password field is never filled (anti-harvesting)", async () => {
  const dom = mount(`<label>Password <input id="hp" type="password"></label>`);
  // Simulate an offscreen/hidden field: offsetParent null (our mock returns parentNode otherwise).
  Object.defineProperty($(dom, "#hp"), "offsetParent", { configurable: true, get() { return null; } });
  await fillPage({ password: "secret123" });
  assert.equal($(dom, "#hp").value, "", "hidden password field must stay empty");
});

test("education: routes Master's / Bachelor's blocks to the right stored qualification", async () => {
  const dom = mount(`
    <fieldset><legend>Master's Degree</legend>
      <label>Field of study <input id="m_field"></label>
      <label>University <input id="m_school"></label>
      <label>Graduation Year <input id="m_year"></label>
    </fieldset>
    <fieldset><legend>Bachelor's Degree</legend>
      <label>Field of study <input id="b_field"></label>
      <label>University <input id="b_school"></label>
      <label>Graduation Year <input id="b_year"></label>
    </fieldset>`);
  const { parseEducation } = await import("./education.js");
  const vault = {
    masters: "MS, Computer Science, Stanford University, 2015",
    bachelors: "BS, Electronics, BMS College, 2013",
  };
  const [{ result }] = [{ result: await (await import("./pagefill.js")).fillPage(vault, null, parseEducation(vault)) }];
  assert.equal($(dom, "#m_field").value, "Computer Science");
  assert.equal($(dom, "#m_school").value, "Stanford University");
  assert.equal($(dom, "#m_year").value, "2015");
  assert.equal($(dom, "#b_field").value, "Electronics");
  assert.equal($(dom, "#b_school").value, "BMS College");
  assert.equal($(dom, "#b_year").value, "2013");
  assert.ok(result >= 6);
});

test("alternate-name fields never receive the legal/full name (Preferred/Former Name stay empty)", async () => {
  // UltiPro/LinkedIn bug: "Preferred Name" / "Former Name" matched the generic full-name concept and
  // got the wrong value (a leftover "John Doe" test entry). They must only fill from a stored alt-name.
  const dom = mount(`
    <label>First Name <input id="fn"></label>
    <label>Last Name <input id="ln"></label>
    <label>Preferred Name <input id="pref"></label>
    <label>Former Name <input id="former"></label>`);
  await fillPage({ first_name: "Subramanya", last_name: "Mysore", full_name: "John Doe" });
  assert.equal($(dom, "#fn").value, "Subramanya");
  assert.equal($(dom, "#ln").value, "Mysore");
  assert.equal($(dom, "#pref").value, "");    // NOT "John Doe"
  assert.equal($(dom, "#former").value, "");  // NOT "John Doe"
});

test("alternate-name field DOES fill when the user stored that specific alt-name", async () => {
  const dom = mount(`<label>Preferred Name <input id="pref"></label>`);
  await fillPage({ first_name: "Subramanya", "preferred name": "Subbu" });
  assert.equal($(dom, "#pref").value, "Subbu");
});

test("free-text catch-all fields (Description) are never auto-filled (no password/address leak)", async () => {
  // UltiPro repeats a "Description" textarea per Work-Experience / Education block. Its label resolves
  // only via a sibling, so loose matching dumped vault data (a saved password, the home address) into it.
  const dom = mount(`
    <div class="form-group"><label id="d0">Description</label>
      <textarea aria-labelledby="d0" id="desc0"></textarea></div>
    <div class="form-group"><label id="d1">Description</label>
      <textarea aria-labelledby="d1" id="desc1"></textarea></div>`);
  await fillPage({ password: "TashkenT08!!", street_address: "4308 ALBINO DEER WAY" });
  assert.equal($(dom, "#desc0").value, "");
  assert.equal($(dom, "#desc1").value, "");
});

test("education: UltiPro-style blocks (label 'Level of Education / Degree', id ...0/1) route by order", async () => {
  // Regression: the word "degree" in the field label was read as a *bachelor's* level, collapsing both
  // blocks onto the bachelor entry ("Bachelors" twice). With no legend, blocks must route by index.
  const dom = mount(`
    <div class="row"><label>School Name <input id="NewEducation_SchoolId0"></label></div>
    <div class="row"><label>Level of Education / Degree <input id="NewEducation_DegreeId0"></label></div>
    <div class="row"><label>School Name <input id="NewEducation_SchoolId1"></label></div>
    <div class="row"><label>Level of Education / Degree <input id="NewEducation_DegreeId1"></label></div>`);
  const { parseEducation } = await import("./education.js");
  const vault = {
    masters: "MS, Computer Science, Stanford University, 2015",
    bachelors: "BS, Electronics, BMS College, 2013",
  };
  await fillPage(vault, null, parseEducation(vault));
  assert.equal($(dom, "#NewEducation_SchoolId0").value, "Stanford University"); // block 0 → masters
  assert.equal($(dom, "#NewEducation_SchoolId1").value, "BMS College");         // block 1 → bachelors
  assert.notEqual($(dom, "#NewEducation_DegreeId0").value, $(dom, "#NewEducation_DegreeId1").value); // NOT both the same
});

test("already-filled fields are never overwritten (résumé prefill is kept)", async () => {
  const dom = mount(`
    <label>First Name <input id="fn" value="Subramanya"></label>
    <label>Preferred Name <input id="pref"></label>`);
  await fillPage({ first_name: "OVERWRITE-ME", "preferred name": "Subu" });
  assert.equal($(dom, "#fn").value, "Subramanya");  // kept, NOT clobbered
  assert.equal($(dom, "#pref").value, "Subu");      // blank field still filled
});

test("a value WE filled can be corrected by a second fill; external values stay put", async () => {
  const dom = mount(`
    <label>Email <input id="e" type="email"></label>
    <label>First Name <input id="fn" value="ResumePrefill"></label>`);
  await fillPage({ email_address: "old@example.com" });
  assert.equal($(dom, "#e").value, "old@example.com");
  await fillPage({ email_address: "new@example.com", first_name: "X" });
  assert.equal($(dom, "#e").value, "new@example.com");  // our own earlier fill got corrected
  assert.equal($(dom, "#fn").value, "ResumePrefill");   // external prefill untouched
});

test("'Former Name' does not pick up an unrelated 'former…' vault key (e.g. NO)", async () => {
  const dom = mount(`<label>Former Name <input id="fmr"></label>`);
  await fillPage({ first_name: "Subramanya", "formerly employed here": "NO" });
  assert.equal($(dom, "#fmr").value, ""); // only a real "former name" would fill this
});

test("a screening question / prompt is not GUESSED, but IS filled when a captured answer matches", async () => {
  const dom = mount(`
    <label>Please provide an active link to your LinkedIn profile <textarea id="li"></textarea></label>
    <label>Please describe your ideal work environment <textarea id="env"></textarea></label>
    <label>How many years of experience do you have? <input id="yrs"></label>`);
  await fillPage({ linkedin_profile: "https://linkedin.com/in/subramanya", age: "38", years: "38" });
  assert.equal($(dom, "#li").value, "https://linkedin.com/in/subramanya"); // captured answer fills the prompt
  assert.equal($(dom, "#env").value, "");   // no matching vault key → left for the user (never guessed)
  assert.equal($(dom, "#yrs").value, "");   // stray "38" never lands here
});

test("a Year box only accepts a 4-digit year, never an address", async () => {
  const dom = mount(`<label>From Year (YYYY) <input id="fy" placeholder="YYYY" maxlength="4"></label>`);
  await fillPage({ street_address: "4308 ALBINO DEER WAY" });
  assert.equal($(dom, "#fy").value, ""); // address rejected from a year field
});

test("repeated work-experience: current job title fills only the FIRST entry, not every block", async () => {
  const dom = mount(`
    <div data-automation="work-experience-item"><label>Job Title <input id="NewWorkExperience_JobTitle0"></label></div>
    <div data-automation="work-experience-item"><label>Job Title <input id="NewWorkExperience_JobTitle1"></label></div>`);
  await fillPage({ occupation: "Engineer" });
  assert.equal($(dom, "#NewWorkExperience_JobTitle0").value, "Engineer"); // most recent role only
  assert.equal($(dom, "#NewWorkExperience_JobTitle1").value, "");         // NOT stamped into every block
});

test("filled fields are marked for verification; untouched fields are not", async () => {
  const dom = mount(`
    <label>First name <input id="a"></label>
    <label>Reference Number <input id="ref" placeholder="0123456789" maxlength="12"></label>`);
  await fillPage({ first_name: "Asha" });
  assert.equal($(dom, "#a").getAttribute("data-ppf-filled"), "1");        // filled → highlighted
  assert.ok(/outline/.test($(dom, "#a").getAttribute("style") || ""));    // has a visible box
  assert.equal($(dom, "#ref").getAttribute("data-ppf-filled"), null);     // never filled → not marked
});

test("saved answers: Yes/No eligibility radios are answered from the user's saved choice", async () => {
  const dom = mount(`
    <fieldset><legend>Are you authorized to work in the United States?</legend>
      <label><input type="radio" name="us" id="us_y"> Yes</label>
      <label><input type="radio" name="us" id="us_n"> No</label></fieldset>
    <fieldset><legend>Are you authorized to work in Canada?</legend>
      <label><input type="radio" name="ca" id="ca_y"> Yes</label>
      <label><input type="radio" name="ca" id="ca_n"> No</label></fieldset>`);
  await fillPage({}, null, [], { savedAnswers: { work_auth_us: "yes", work_auth_ca: "no" } });
  assert.equal($(dom, "#us_y").checked, true);
  assert.equal($(dom, "#us_n").checked, false);
  assert.equal($(dom, "#ca_n").checked, true);
  assert.equal($(dom, "#ca_y").checked, false);
});

test("saved answers: EEO self-ID (veteran radio + race checkboxes) from saved choices; nothing guessed", async () => {
  const dom = mount(`
    <fieldset><legend>Protected Veteran Status</legend>
      <label><input type="radio" name="vet" id="v1"> I am a veteran</label>
      <label><input type="radio" name="vet" id="v2"> I am not a veteran</label>
      <label><input type="radio" name="vet" id="v3"> Decline to self-identify</label></fieldset>
    <fieldset><legend>Race/Ethnicity</legend>
      <label><input type="checkbox" id="r_white"> White</label>
      <label><input type="checkbox" id="r_asian"> Asian</label>
      <label><input type="checkbox" id="r_black"> Black or African American</label></fieldset>`);
  await fillPage({}, null, [], { savedAnswers: { veteran: "no", race: "asian" } });
  assert.equal($(dom, "#v2").checked, true);       // "I am not a veteran"
  assert.equal($(dom, "#v1").checked, false);
  assert.equal($(dom, "#r_asian").checked, true);  // only the chosen race
  assert.equal($(dom, "#r_white").checked, false);
  assert.equal($(dom, "#r_black").checked, false);
});

test("saved answers: custom ARIA-radio widgets + a plain-div heading (Ashby/Greenhouse style)", async () => {
  const dom = mount(`
    <div class="q">
      <div class="q-title">Disability Status</div>
      <div role="radiogroup">
        <div role="radio" aria-checked="false" id="d1">I have a disability</div>
        <div role="radio" aria-checked="false" id="d2">I do not have a disability</div>
        <div role="radio" aria-checked="false" id="d3">Decline to specify</div>
      </div>
    </div>`);
  await fillPage({}, null, [], { savedAnswers: { disability: "no" } });
  assert.equal($(dom, "#d2").getAttribute("aria-checked"), "true"); // "I do not have a disability"
  assert.equal($(dom, "#d1").getAttribute("aria-checked"), "false");
});

test("saved answers: a visually-hidden real radio (styled control) is still selected", async () => {
  const dom = mount(`
    <div class="field">
      <div class="field-label">Are you authorized to work in the United States?</div>
      <label><input type="radio" name="wa" id="wy" style="position:absolute;opacity:0"> Yes</label>
      <label><input type="radio" name="wa" id="wn" style="position:absolute;opacity:0"> No</label>
    </div>`);
  await fillPage({}, null, [], { savedAnswers: { work_auth_us: "yes" } });
  assert.equal($(dom, "#wy").checked, true);
});

test("saved answers: React radios with a SIBLING label + data-value, no name/id (Ladders)", async () => {
  // Real markup: <div><input type=radio value="…"><label data-value="…">…</label></div>
  const dom = mount(`
    <div class="field"><div class="field-title">Protected Veteran Status</div>
      <div class="answers-edit_radio"><input type="radio" value="I am a veteran" id="rv1"><label data-value="I am a veteran">I am a veteran</label></div>
      <div class="answers-edit_radio"><input type="radio" value="I am not a veteran" id="rv2"><label data-value="I am not a veteran">I am not a veteran</label></div>
      <div class="answers-edit_radio"><input type="radio" value="Decline to self-identify" id="rv3"><label data-value="Decline to self-identify">Decline to self-identify</label></div>
    </div>`);
  await fillPage({}, null, [], { savedAnswers: { veteran: "no" } });
  assert.equal($(dom, "#rv2").checked, true);   // "I am not a veteran"
  assert.equal($(dom, "#rv1").checked, false);
});

test("saved answers: checkboxes with label[for] + data-value (race), only chosen ticked", async () => {
  const dom = mount(`
    <div class="field"><div class="field-title">Race/Ethnicity</div>
      <div><input type="checkbox" id="PI-1-1"><label for="PI-1-1" data-value="White">White</label></div>
      <div><input type="checkbox" id="PI-2-3"><label for="PI-2-3" data-value="Asian">Asian</label></div></div>`);
  await fillPage({}, null, [], { savedAnswers: { race: "asian" } });
  assert.equal($(dom, "#PI-2-3").checked, true);
  assert.equal($(dom, "#PI-1-1").checked, false);
});

test("generic: captured VAULT answers drive radios/checkboxes (no Common answers set)", async () => {
  // The user captured screening answers as vault key=question, value=answer. This must work generically.
  const dom = mount(`
    <div><div class="t">Protected Veteran Status</div>
      <div class="r"><input type="radio" value="I am a veteran" id="gv1"><label data-value="I am a veteran">I am a veteran</label></div>
      <div class="r"><input type="radio" value="I am not a veteran" id="gv2"><label data-value="I am not a veteran">I am not a veteran</label></div></div>
    <div><div class="t">Disability Status</div>
      <div class="r"><input type="radio" value="yes" id="gd1"><label>I have a disability and would like to be considered</label></div>
      <div class="r"><input type="radio" value="no" id="gd2"><label>I do not have a disability or would not like to be considered under the affirmative action program</label></div></div>
    <div><div class="t">Race/Ethnicity</div>
      <div><input type="checkbox" id="gr1"><label for="gr1">White</label></div>
      <div><input type="checkbox" id="gr2"><label for="gr2">Asian</label></div></div>`);
  await fillPage({
    veteran_status: "I am not a veteran",
    disability_status: "I do not have any disability", // note "any" vs the form's "a" — must still match
    race_ethhicity: "Asian",                            // misspelt KEY — matched via the value instead
  });
  assert.equal($(dom, "#gv2").checked, true);
  assert.equal($(dom, "#gd2").checked, true);   // wording-tolerant match
  assert.equal($(dom, "#gr2").checked, true);   // Asian
  assert.equal($(dom, "#gr1").checked, false);
});

test("smart: a DIFFERENTLY-worded question fills from a captured answer via shared intent", async () => {
  // Captured under one wording; the form asks it another way — must still fill (same intent).
  const dom = mount(`
    <fieldset><legend>Do you have the legal right to be employed in the U.S.?</legend>
      <label><input type="radio" name="w" id="s_y"> Yes</label>
      <label><input type="radio" name="w" id="s_n"> No</label></fieldset>
    <fieldset><legend>Will you now or in the future need immigration sponsorship?</legend>
      <label><input type="radio" name="sp" id="sp_y"> Yes</label>
      <label><input type="radio" name="sp" id="sp_n"> No</label></fieldset>`);
  await fillPage({
    are_you_authorized_to_work_in_the_united_states: "Yes",       // different wording than the form
    do_you_require_visa_sponsorship_to_work_here: "No",
  });
  assert.equal($(dom, "#s_y").checked, true);   // matched by intent, not wording
  assert.equal($(dom, "#sp_n").checked, true);
  assert.equal($(dom, "#sp_y").checked, false);
});

test("generic: captured Yes/No answer keyed by the question fills; a stray value never leaks", async () => {
  const dom = mount(`
    <fieldset><legend>Are you authorized to work in the United States?</legend>
      <label><input type="radio" name="wus" id="au_y"> Yes</label>
      <label><input type="radio" name="wus" id="au_n"> No</label></fieldset>
    <fieldset><legend>Are you authorized to work in Canada?</legend>
      <label><input type="radio" name="wca" id="ca_y"> Yes</label>
      <label><input type="radio" name="wca" id="ca_n"> No</label></fieldset>`);
  // Vault has an answer for the US question (keyed by it) and an UNRELATED "Yes" value.
  await fillPage({ are_you_authorized_to_work_in_the_united_states: "Yes", newsletter_optin: "Yes" });
  assert.equal($(dom, "#au_y").checked, true);   // US question answered from its captured key
  assert.equal($(dom, "#ca_y").checked, false);  // Canada NOT ticked by the stray "Yes" (key-gated)
  assert.equal($(dom, "#ca_n").checked, false);
});

test("saved answers: a question with NO saved answer is left untouched (never guessed)", async () => {
  const dom = mount(`
    <fieldset><legend>Do you currently have a DoD security clearance?</legend>
      <label><input type="radio" name="cl" id="cl_y"> Yes</label>
      <label><input type="radio" name="cl" id="cl_n"> No</label></fieldset>`);
  await fillPage({}, null, [], { savedAnswers: { work_auth_us: "yes" } }); // no clearance answer set
  assert.equal($(dom, "#cl_y").checked, false);
  assert.equal($(dom, "#cl_n").checked, false);
});

test("custom dropdown: a mis-guessed value never selects an option (Yes/No question stays empty)", async () => {
  const dom = mount(`
    <div class="form-group">
      <label>Are/were you or anyone in your immediate family a government official?</label>
      <div role="combobox" class="Select"><span>Select...</span></div>
      <div role="listbox"><div role="option">Yes</div><div role="option">No</div></div>
    </div>
    <div class="form-group">
      <label>Gender</label>
      <div role="combobox" class="Select"><span>Select...</span></div>
      <div role="listbox"><div role="option">Male</div><div role="option">Female</div></div>
    </div>`);
  const clicked = [];
  for (const o of dom.window.document.querySelectorAll('[role="option"]')) {
    o.addEventListener("click", () => clicked.push(o.textContent.trim()));
  }
  // last_name would wrongly match a "family" concept; gender should still fill correctly.
  await (await import("./pagefill.js")).fillPage({ last_name: "Mysore", gender: "Male" });
  assert.equal(clicked.includes("Mysore"), false);
  assert.equal(clicked.includes("Yes"), false, "must not pick Yes/No from a name guess");
  assert.equal(clicked.includes("No"), false, "the government-official box must be left empty");
  assert.equal(clicked.includes("Male"), true, "a real match (Gender → Male) still fills");
});
