# Spec — Fill a multi-step application, stopping at Submit

## Intent

One click fills a whole application, not one page of it. LinkedIn Easy Apply, Workday and most modern
ATS flows are wizards: a few fields, **Next**, a few more, **Next**, then **Review** and **Submit**.
Today the user presses Fill on every step. From this change, pressing Fill once fills the current step,
advances, fills the next, and keeps going until it reaches the point of submission — where it stops and
hands control back.

## Non-goals — deliberately

- **We never press Submit / Send application.** The user does, always. An application cannot be
  un-sent, the engine still misses some screening questions, and automated submission is exactly what
  LinkedIn's User Agreement forbids and what puts a Chrome Web Store listing at risk.
- No login, no navigation to job pages, no bulk applying, no queueing across jobs. The user opens the
  application; we fill what is on screen.
- Nothing new leaves the device. The privacy invariant is untouched.

## Behaviour

1. Fill the current step (existing engine, unchanged).
2. Look for an ADVANCE control: a button whose visible text is Next / Continue / Save and continue /
   Next step — and which is NOT a submit control (submit / send application / apply now / finish).
3. If the step looks like the FINAL one (a submit control is present, or the text says Review your
   application), stop and report. Do not click.
4. Otherwise click advance, wait for the next step to render (a DOM change plus a settle delay, up to
   ~4 s), and repeat from 1.
5. Stop in any of these cases, and always report why:
   - **a required question on this step is still unanswered** — we do NOT skip past it (see below)
   - a submit control is present (normal, expected ending)
   - no advance control (single-page form — behaves exactly as today)
   - the step did not change after advancing (stuck: a validation error, or a required field we could
     not fill)
   - a hard cap of 12 steps (a runaway wizard is a bug, not a form)

## Waiting for the user, and remembering what they answer

A wizard step routinely asks something the vault has never seen — a screening question, a
this-employer-only field. Two rules follow:

**Wait, don't skip.** After filling a step, the assessor checks it. If any REQUIRED control is still
empty, the run PAUSES there and names those fields. Advancing past an unanswered required question
would either fail validation or, worse, carry an incomplete application to the submit step. The user
answers what is missing and presses Fill again to continue from that step.

**Bank the answer.** Every time the run leaves a step — whether it advances on its own or resumes
after the user typed something — the answers on that step are captured and saved to the vault, as
`{key, value}` pairs, through the same capture path used elsewhere (text, textarea, list box, custom
dropdown, radio, checkbox). So a question answered by hand once is filled automatically on the next
application, and the pause happens less on every subsequent run.

Capture obeys the existing "save new details" setting; nothing is written when the user has turned
that off, and image/data-URL values are never captured.

## What the user sees at the end

A summary they can act on before submitting:

- steps filled, fields filled per step
- **required fields still empty**, by name — from the existing assessor, which already knows the
  difference between "filled", "empty" and "not ours to answer"
- why the run stopped

## Where it runs

In the BACKGROUND service worker, not the popup: the loop must survive the popup closing, which
happens the moment the user clicks anywhere on the page. Each step is a fresh `fillPage` injection —
same engine, same guarantees, no new fill logic.

## Safety rules encoded in the code

- The advance button is matched by TEXT, and any candidate that also matches submit wording is
  rejected — so "Submit application" can never be clicked by the advance step.
- After clicking advance, we require evidence the step changed before filling again; otherwise a
  mis-detected button would let the engine fill the same step repeatedly.
- The cap and the stuck-detection mean the loop always terminates.

## Tests

- a single-page form: one fill, no advance, reports "no next step" (today's behaviour preserved)
- a 3-step wizard: fills each step, advances twice, stops at the step holding Submit — and the submit
  button is never clicked (asserted by a click spy)
- a wizard whose "Next" is actually "Submit application": never clicked, loop stops immediately
- a stuck step (advance does nothing): stops, reports stuck, does not loop
- the end-of-run summary lists required-but-empty fields
