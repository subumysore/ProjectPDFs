// The multi-step fill loop (docs/specs/multi-step-fill.md).
//
// One press of "Fill this form" should carry a multi-page application as far as it can HONESTLY go:
// fill this step, bank the answers, move to the next step, repeat — and stop, out loud, the moment it
// would be guessing or would be pressing Submit. It never submits: the user does, always.
//
// The loop is kept free of chrome.* here so it can be exercised against fakes in the tests and so the
// background worker holds only the injection plumbing. `deps`:
//   fillStep()          -> number of fields filled on the current step
//   captureStep()       -> number of NEW key/value pairs banked into the vault from this step
//   probeStep()         -> { stepKey, requiredEmpty[], advance, submit, reviewText }
//   clickAdvance()      -> clicks the advance control (no return value needed)
//   waitForChange(key)  -> true once the step's fingerprint differs from `key`, false on timeout
//
// Stop reasons are part of the contract — the summary must always be able to say WHY it stopped:
//   needs-you | at-submit | no-next | stuck | max-steps | error
export const MAX_STEPS = 12;

export async function runStepLoop(deps, opts = {}) {
  const max = opts.max || MAX_STEPS;
  const out = { ok: true, steps: [], filled: 0, saved: 0, stopped: "", needs: [] };

  for (let n = 1; n <= max; n++) {
    const filled = (await deps.fillStep(n)) || 0;
    // BANK THE ANSWER before leaving the step: once the wizard moves on, this step's markup is gone and
    // anything the user typed here is unrecoverable. Honours the user's "save new details" setting
    // inside captureStep, which is where the vault lives.
    const saved = (await deps.captureStep(n)) || 0;
    const probe = (await deps.probeStep(n)) || {};
    const step = {
      step: n,
      filled,
      saved,
      requiredEmpty: probe.requiredEmpty || [],
      advance: probe.advance || null,
      submit: probe.submit || null,
    };
    out.steps.push(step);
    out.filled += filled;
    out.saved += saved;

    // AN ACCOUNT STEP IS THE USER'S. Signing in or creating an account is an outward-facing act with
    // their name on it; we fill what we can and hand it back.
    if (probe.authStep) { out.stopped = "sign-in"; break; }
    // WAIT, DON'T SKIP. A required question we could not answer is the user's to answer; advancing past
    // it either loses the application or submits it wrong.
    if (step.requiredEmpty.length) { out.stopped = "needs-you"; out.needs = step.requiredEmpty; break; }
    // THE END OF THE WIZARD. A submit control (or a "Review your application" step) means the next click
    // is the user's. We stop here even if something advance-shaped is also on the page.
    if (probe.submit || probe.reviewText) { out.stopped = "at-submit"; break; }
    if (!probe.advance) { out.stopped = "no-next"; break; }

    await deps.clickAdvance(n);
    const moved = await deps.waitForChange(probe.stepKey, n);
    if (!moved) { out.stopped = "stuck"; break; }   // the click did nothing — never loop on the same step
  }
  if (!out.stopped) out.stopped = "max-steps";
  return out;
}

// One line the user can act on, for the popup. Plain language, no jargon, and it always says why.
export function summarise(res) {
  if (!res || !res.ok) return (res && res.error) || "The fill couldn't run.";
  const n = res.steps.length;
  const pages = n === 1 ? "this page" : `${n} pages`;
  const head = `Filled ${res.filled} field${res.filled === 1 ? "" : "s"} across ${pages}` +
    (res.saved ? `, saved ${res.saved} new answer${res.saved === 1 ? "" : "s"} to your vault` : "") + ".";
  const why = {
    "needs-you": `Stopped on page ${n}: please answer ${res.needs.join(", ")}, then press Fill again.`,
    "at-submit": "You're at the last page — check it over and press Submit yourself.",
    "sign-in": "This page wants you to sign in or create an account — that part is yours; press Fill again afterwards.",
    "no-next": n === 1 ? "" : "No next step on this page.",
    stuck: `Page ${n} didn't move on — the form may need something more from you.`,
    "max-steps": `Stopped after ${MAX_STEPS} pages.`,
  }[res.stopped];
  return why ? `${head} ${why}` : head;
}
