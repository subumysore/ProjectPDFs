# ADR-0021 — Boxes the app will NOT fill, and asking before it learns

- Status: Accepted
- Date: 2026-07-23
- Relates to: ADR-0016 (intelligent fill), ADR-0018 (language-agnostic engine). Does not supersede
  anything; it constrains the fill engine that ADR-0016 introduced.

## Context

End-to-end testing against real government forms (HK GF340, HK ID995A, Atal Pension Yojana) showed
that the fill engine's failure mode is not "leaves a box empty" — that is visible and cheap. It is
**confidently writing a wrong answer into a box the user does not re-read**, which is invisible and
expensive: the form is submitted, and the error is discovered by the receiving authority.

Three concrete instances:

1. `HKIDCheckingDigit` — a DERIVED value (a check digit computed from the ID number). Its printed
   caption is "Last Digit", "last" is one of our surname aliases, and the box holds one character,
   so it resolved to the surname INITIAL. The form went out claiming a check digit of "C".
2. A **correspondence address** received a copy of the residential address. The form offers a
   "same as above" tick precisely *because* the two often differ; copying invents a fact.
3. Anything typed onto a form that the vault did not hold was **saved silently by one app and lost
   entirely by the other** — the desktop reviewed and asked, the extension had no capture at all.

## Decision

**1. Some boxes are never the applicant's to fill, and the engine leaves them alone.**

- **Derived boxes** — check digit, checking digit, checksum, verification/control digit, and a box
  captioned as the "last/final digit". Their value is a function of another field; guessing it is
  never better than blank.
- **Office-use boxes** — "for official/office/departmental/staff/internal use", "do not write
  below", "received/approved/verified/processed by".
- The test is applied to **both the human caption and the raw field name**. On the very form that
  exposed this, each one alone looks innocent: the caption says "Last Digit" and the field name says
  `HKIDCheckingDigit`. Requiring both to look suspicious would have missed it; requiring either is
  enough catches it. `resolveFields` descriptors therefore carry `name` alongside `label`.

**2. A QUALIFIED field is a different fact, not a synonym.**

- A qualified address (correspondence, mailing, postal, office, business, work, employer, permanent,
  previous, former, overseas, foreign) is filled **only** from a vault key carrying that same
  qualifier — but only when the form ALSO asks for the plain/residential address. If the qualified
  address is the only one the form asks for, it *is* the address wanted, and the plain one fills it.
- This mirrors the rule already adopted for **script-qualified names** ("Chinese name" is never
  filled with the Latin name). Same principle: a qualifier changes the question being asked.

**3. Nothing is learned without being shown and ticked.**

The desktop's posture is the product's posture: values typed onto a form that the vault does not
hold are listed for review — each with the value it would replace — and only ticked rows are saved,
to the local vault only. The extension now implements the same flow (`pagecapture.js` + a popup
review list). Passwords, hidden inputs, file pickers and untouched fields are never read.

**4. Both engines carry every rule, and the build enforces it.**

`resolver.js` (PDF) and `pagefill.js` (web, self-contained by necessity) must both carry each rule;
`engine-parity.test.mjs` now guards the SAFETY rules as well as the concept tables. A PDF that
leaves the check-digit box alone while the web version fills it is the same class of bug as the
concept drift that guard was originally written for.

## Consequences

- The engine fills slightly FEWER boxes, deliberately. Coverage is not the metric; a form the user
  can trust without re-reading every box is.
- Every rule is a keyword list and will therefore be incomplete in languages and phrasings we have
  not met yet. It is applied to the label the engine already resolved (translated where the form
  was translated), so it improves as detection improves — and when it misses, the failure is the
  status quo, not a regression.
- A qualified address the user genuinely wants duplicated now needs its own vault key. That is one
  extra entry, and it is the honest representation: the user said the two are the same.
- Precedent for anything added to the engine later: **if a box's correct value is derived from
  another field, owned by a third party, or qualified in a way the vault cannot match, leave it
  blank and say so.**

## Verification

`notmine.test.mjs` covers both engines, using the real `HKIDCheckingDigit` field with its real
caption and real name; `pagecapture.test.mjs` covers what may be read and what counts as new; the
fixes were re-run against the actual GF340 PDF (533 fields) — the check digit is now empty and the
Chinese name is written.
