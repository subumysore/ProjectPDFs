// The multi-step run, end to end on a real wizard: the REAL filler, the REAL capture pipeline and the
// REAL probe, driven by the loop. What is faked is only the browser plumbing (injection, storage).
// Two promises are under test above all others: we NEVER press Submit, and every answer on a step is
// BANKED into the vault as a key/value pair before the wizard throws that step away.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fillPage } from "./pagefill.js";
import { collectTypedValues, newInformation } from "./pagecapture.js";
import { keyFromLabel, isCapturableLabel } from "./vaultkey.js";
import { stepProbe } from "./stepprobe.js";
import { runStepLoop, summarise } from "./multistep.js";

const VAULT = {
  first_name: "Asha", last_name: "Rao", email_address: "asha.rao@example.com",
  cell_phone: "9195550123", address_line_1: "12 Elm Street", city: "Raleigh", country: "United States",
};

// A wizard: `steps` are HTML pages. Clicking the advance control moves to the next one, but only if
// this step's own required fields are filled — exactly like a real form's validation.
function wizard(steps, opts = {}) {
  const dom = new JSDOM(`<!doctype html><body>${steps[0]}</body>`, { pretendToBeVisual: true, url: "https://jobs.example.com/apply" });
  const w = dom.window;
  for (const k of ["window", "document", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
    "MouseEvent", "KeyboardEvent", "Event", "Node", "Element", "getComputedStyle"]) global[k] = w[k];
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });
  w.Element.prototype.getBoundingClientRect = function () { return { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }; };
  const state = { i: 0, submitClicks: 0, vault: { ...VAULT }, saved: [] };
  const wire = () => {
    for (const b of w.document.querySelectorAll("button")) {
      const t = (b.textContent || "").trim();
      if (/submit|send application/i.test(t)) { b.addEventListener("click", () => { state.submitClicks++; }); continue; }
      b.addEventListener("click", () => {
        if (opts.validate !== false) {
          const bad = [...w.document.querySelectorAll("[required]")].some((el) => !String(el.value || "").trim() && !el.checked);
          if (bad) return;                                   // the page refuses to move on
        }
        if (state.i < steps.length - 1) { state.i++; w.document.body.innerHTML = steps[state.i]; wire(); }
      });
    }
  };
  wire();
  return { dom, w, state, wire };
}

function deps(h) {
  return {
    fillStep: () => fillPage(h.state.vault),
    // The capture path the extension really uses: collect what is on the step, keep only what the
    // vault does not already hold, and write those key/value pairs in.
    captureStep: () => {
      const fresh = newInformation(collectTypedValues(), h.state.vault, keyFromLabel, isCapturableLabel)
        .filter((p) => p.existing === undefined && !/^data:/i.test(String(p.value)));
      for (const p of fresh) { h.state.vault[p.key] = p.value; h.state.saved.push(p); }
      return fresh.length;
    },
    probeStep: () => stepProbe({}),
    clickAdvance: () => { stepProbe({ click: true }); },
    waitForChange: (before) => stepProbe({}).stepKey !== before,
  };
}

const NAMES = `<label>First name <input name="fn" required></label><label>Last name <input name="ln" required></label>`;
const CONTACT = `<label>Email <input name="em" type="email" required></label><label>Phone <input name="ph" type="tel"></label>`;

test("a SINGLE-page form fills once and reports that there is no next step", async () => {
  const h = wizard([`<form>${NAMES}${CONTACT}</form>`]);
  const res = await runStepLoop(deps(h));
  assert.equal(res.steps.length, 1);
  assert.equal(res.stopped, "no-next");
  assert.ok(res.filled >= 3, `only ${res.filled} fields filled`);
});

test("a 3-step wizard advances twice and STOPS at Submit — the submit button is never clicked", async () => {
  const h = wizard([
    `<h1>Step 1</h1><form>${NAMES}<button type="button">Next</button></form>`,
    `<h1>Step 2</h1><form>${CONTACT}<button type="button">Next</button></form>`,
    `<h1>Step 3</h1><form><label>Anything else? <textarea name="x"></textarea></label>
       <button type="button">Submit application</button></form>`,
  ]);
  const res = await runStepLoop(deps(h));
  assert.equal(res.steps.length, 3, `reached ${res.steps.length} steps`);
  assert.equal(res.stopped, "at-submit");
  assert.equal(h.state.submitClicks, 0, "WE PRESSED SUBMIT — that is the user's click, never ours");
  assert.match(summarise(res), /press Submit yourself/i);
});

test("a step whose only forward control is 'Submit application' is never clicked past", async () => {
  const h = wizard([`<form>${NAMES}<button type="button">Submit application</button></form>`]);
  const res = await runStepLoop(deps(h));
  assert.equal(res.stopped, "at-submit");
  assert.equal(h.state.submitClicks, 0);
  assert.equal(res.steps.length, 1);
});

test("a step that refuses to move on is reported as stuck, not filled over and over", async () => {
  const h = wizard([
    `<form>${NAMES}<label>Note <input name="n"></label><button type="button">Next</button></form>`,
    `<h1>Step 2</h1><form>${CONTACT}</form>`,
  ]);
  // The page refuses regardless of what we do (a server-side error the engine cannot see): strip the
  // advance handler by replacing the button with a clone.
  for (const b of h.w.document.querySelectorAll("button")) b.replaceWith(b.cloneNode(true));
  const res = await runStepLoop(deps(h));
  assert.equal(res.stopped, "stuck");
  assert.equal(res.steps.length, 1);
  assert.match(summarise(res), /didn't move on/i);
});

test("an unanswered REQUIRED question pauses the run and is named in the summary", async () => {
  const h = wizard([
    `<form>${NAMES}<label>Years of Kubernetes experience <input name="k8s" required></label>
     <button type="button">Next</button></form>`,
    `<h1>Step 2</h1><form>${CONTACT}<button type="button">Submit</button></form>`,
  ]);
  const res = await runStepLoop(deps(h));
  assert.equal(res.stopped, "needs-you");
  assert.equal(res.steps.length, 1, "it advanced past a question it could not answer");
  assert.ok(res.needs.some((n) => /kubernetes/i.test(n)), `needs = ${JSON.stringify(res.needs)}`);
  assert.match(summarise(res), /Kubernetes/i);
});

// The user's requirement, verbatim: "once answered, document it in the Vault".
test("a NEW question answered on step 1 is banked as a KEY/VALUE pair before the wizard moves on", async () => {
  const h = wizard([
    `<form>${NAMES}<label>Mother maiden name <input name="mmn"></label><button type="button">Next</button></form>`,
    `<h1>Step 2</h1><form>${CONTACT}<button type="button">Submit application</button></form>`,
  ]);
  // The user types an answer the vault has never seen.
  h.w.document.querySelector('input[name="mmn"]').value = "Kamala";
  const res = await runStepLoop(deps(h));
  assert.equal(res.stopped, "at-submit");
  const pair = h.state.saved.find((p) => /maiden/i.test(p.label));
  assert.ok(pair, `nothing about the maiden name reached the vault: ${JSON.stringify(h.state.saved.map((p) => p.label))}`);
  assert.equal(pair.value, "Kamala");
  assert.match(pair.key, /^[a-z0-9_]+$/);
  assert.equal(h.state.vault[pair.key], "Kamala", "the pair is not readable back from the vault");
  assert.ok(res.saved >= 1, "the summary does not count the saved answer");
  assert.match(summarise(res), /saved \d+ new answer/i);
});

test("answers on a LATER step are banked too, and an image value never is", async () => {
  const h = wizard([
    `<form>${NAMES}<button type="button">Next</button></form>`,
    `<h1>Step 2</h1><form><label>Preferred shift <select name="sh">
        <option value="">Select one</option><option>Night shift</option></select></label>
      <label>Headshot <input name="pic"></label>
      <button type="button">Submit application</button></form>`,
  ]);
  const res = await runStepLoop(deps(h));
  assert.equal(res.stopped, "at-submit");
  h.w.document.querySelector('select[name="sh"]').value = "Night shift";
  h.w.document.querySelector('input[name="pic"]').value = "data:image/png;base64,AAAA";
  await deps(h).captureStep();
  const shift = h.state.saved.find((p) => /shift/i.test(p.label));
  assert.ok(shift && shift.value === "Night shift", "a later step's answer was lost");
  assert.equal(h.state.saved.find((p) => /^data:/i.test(p.value)), undefined, "an image was written into the vault");
});

test("the run is capped so a looping form cannot fill forever", async () => {
  let n = 0;
  const h = wizard([`<form><label>Note <input name="n1"></label><button type="button">Next</button></form>`]);
  const d = deps(h);
  d.clickAdvance = () => { n++; h.w.document.body.innerHTML = `<form><label>Note ${n} <input name="n${n}"></label><button type="button">Next</button></form>`; };
  d.waitForChange = () => true;
  const res = await runStepLoop(d, { max: 12 });
  assert.equal(res.stopped, "max-steps");
  assert.equal(res.steps.length, 12);
});
