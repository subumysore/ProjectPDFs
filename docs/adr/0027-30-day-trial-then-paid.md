# ADR-0027 — 7-day free trial, then paid (no free-forever tier)

- Status: Accepted
- Date: 2026-07-28
- Implements the locked pricing decision (memory: pricing-model-locked; RFC-0010/ADR-0015 offline license).
  Corrects the shipped code, which wrongly allowed **core autofill free forever** (only translation/
  images/signature were gated).

## Context
Pricing is a **7-day full-featured trial, then a one-time/annual purchase** — there is no permanent
free tier. But the trial-enforcement piece was never built, so shipped builds let anyone fill forms
indefinitely. We must gate ALL fill/export behind an active entitlement, on both surfaces, without a
phone-home (privacy invariant): the ONE sanctioned network call is minting the trial token at first run.

## Decision
Entitlement = **paid license (valid) → active trial (≤7 days) → locked**. `active` gates every fill/
export path. A trial is a normal signed token: `tier:"trial"`, full `features`, `device_id` bound,
`expires_at = issued_at + 30d`. It verifies on-device exactly like a paid license (no new verify path).

- **Issuer** (`issuer-server.mjs`): `GET /issuer/trial?device=<id>` mints the device-bound 7-day token
  (CORS-open; receives only a random device id — never user content). Zero storage, stateless.
- **Desktop** (`lib.rs` `ensure_trial`): on unlock, if not licensed and no trial was consumed on this
  install (`trial.used` marker), fetch+verify+store the trial via `core-fetch` (Rust does the call —
  the webview CSP forbids external fetch). `LicenseStatus.days_left` drives the countdown UI. The React
  fill handlers (`fillPdf`/`detectAndFill`/`applyReview`/`autoFillForm`/`exportOfficePdf`) early-return
  through `requireEntitlement()` when inactive.
- **Extension** (`license.js`): `ensureTrial()` mints once (a stored trial token — valid OR expired —
  blocks a re-mint, so an expired trial can't be silently renewed); `getEntitlement()` returns
  `{active,trial,daysLeft,expired}`; `ensureActive()` gates the popup **Fill** button and the
  background auto-fill-on-load. `TIER_RANK.trial = pro`, so a trial unlocks the Pro features too.

## Anti-abuse (honest limits)
The device id is a **client-generated random UUID**, not a hardware fingerprint (privacy invariant), and
the issuer is stateless. So a determined user can reset the trial by clearing app/extension storage
(which regenerates the device id). We accept this: hardware fingerprinting or server-side device
tracking would violate the privacy guarantee, and at launch scale the leakage is negligible. Casual
"just keep using it free" is fully closed.

## Consequences
- (+) No free-forever tier; every install converts to trial→paid. (+) Extensions auto-update, so existing
  installs get gated automatically once the gated build publishes. (+) Reuses the existing offline verify
  path — a trial IS a license.
- (−) Requires one network call at first run to start the trial (fails closed if offline until it can
  reach the issuer — acceptable; the mint is tiny). (−) Storage-reset trial farming is possible (above).
- Desktop enforcement ships in **1.0.3** (signed). Extension enforcement rides the next store release
  (**1.0.4**) — 1.0.3 is mid-review and can't be replaced until it clears.

## Follow-ups
- Optional: Tauri auto-updater so desktop installs propagate the gate without a manual reinstall.
- Optional: a short offline grace (e.g. cache last-known-good) if first-run connectivity proves a problem.
