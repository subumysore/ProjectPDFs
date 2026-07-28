# ADR-0029 — Machine-stable trial binding (anti-farming, privacy-preserving)

- Status: Accepted
- Date: 2026-07-28
- Supersedes the "Anti-abuse" section of ADR-0027. Owner chose the **local-hardening** path over a
  server-side device registry (which would have required storing identifiers server-side and thus
  retracting the public "no tracking / zero telemetry" claim — rejected to keep the privacy wedge).

## Context
ADR-0027's trial could be farmed by wiping app data (new random device id → new trial). The owner wanted
this closed to protect revenue. A server-side device registry fully closes it but stores persistent
device identifiers on our servers — that makes the site's "no tracking · no identifiers · zero telemetry"
promise false (the product's main differentiator and traction wedge) and needs a paid DB. Rejected.

## Decision (desktop; the extension can't be hardware-bound — browser sandbox)
Harden the trial locally, without any server state and without new egress beyond the existing one-way id:
1. **Machine-stable device id.** `device_id_for` now derives the id from the Windows install's
   **MachineGuid** (HKLM\…\Cryptography), one-way **SHA-256** hashed. Wiping app data no longer yields a
   fresh identity, so a re-mint request comes from the SAME device id. Falls back to the random
   per-install id on non-Windows / when MachineGuid is unreadable.
2. **Registry trial-used marker.** The "trial consumed" flag is written to **HKCU\Software\PolyglotFormFill**
   (per-user registry) in addition to the app-data file, and checked as file-OR-registry. The registry lives
   outside the app-data dir, so clearing app data does not reset it.

Together: clearing app data keeps both the identity (MachineGuid-derived) and the consumed-marker (HKCU),
so the app won't re-mint — closing casual farming.

## Privacy — the wedge is preserved (claims stay TRUE)
- Only a **one-way hash** of MachineGuid is ever used/sent (a stable pseudonym, not reversible to the
  machine, not user profile/vault content). This is the same shape of value we already sent (a device id);
  it's just derived instead of random.
- The **issuer remains stateless** — it stores nothing, tracks nothing. So "no tracking / no identifiers
  retained / zero telemetry" stays accurate. No privacy-policy or marketing change is required.

## Consequences
- (+) Closes casual "wipe app data → new trial" farming with zero server state and no privacy-claim change.
- (+) Bonus: paid licences now bind to a machine-stable id, so they survive an app-data wipe (better UX for
  paying users) instead of breaking with a regenerated random id.
- (−) Not bulletproof: a determined user can edit HKCU or reinstall the OS to reset. Accepted — that user
  was never going to pay, and going further needs server-side tracking we deliberately reject.
- (−) A MachineGuid changes on OS reinstall → that machine can start a fresh trial (acceptable) and a paid
  licence bound to it would need re-issue (rare; support-desk action).
- Extension trial remains reset-able (no hardware access in a browser) — inherent, unchanged.

## Follow-ups
- If farming ever proves material at scale, revisit with an *opt-in, disclosed* device check — never silent.
