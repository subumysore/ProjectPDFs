# ADR-0031 — The browser extension no longer needs the desktop app open

- Status: accepted
- Date: 2026-08-17
- Supersedes the access gate described in ADR-0019 (shared vault via native host); the shared-vault
  architecture itself is unchanged.

## Context

The extension and the desktop app share ONE vault: the desktop owns `vault.db`, and the extension
reaches it through the native-messaging host. Access was gated on a heartbeat the desktop app writes
while unlocked (`app-session.flag`, 120 s freshness). If the app was closed — or merely locked — every
vault request failed with:

> 🔒 Your vault is shared with the desktop app, which is locked. Open the PolyglotFormFill desktop app
> and unlock it, then click again.

For anyone who works in the browser, that made a form fill a three-step ritual: open the app, type the
passphrase, return to the tab. The friction was reported as the single worst thing about daily use, and
it is self-inflicted: **the desktop app was never what protected the vault.** The data key lives in the
Windows Credential Locker (DPAPI-protected, scoped to the Windows account) and the host already reads it
directly. The passphrase screen was simply the thing that happened to prove a human was present.

## Decision

Prove presence in the host instead of borrowing it from the app.

1. **Opt-in, off by default.** In the desktop app (while unlocked, so only someone who knows the
   passphrase can grant it) the user may allow "let the browser use the vault without opening this app".
   Recorded in the Credential Locker with an expiry.
2. **Windows Hello per window.** When the extension asks for the vault and the app is not unlocked, the
   host calls `UserConsentVerifier::RequestVerificationAsync` — face, fingerprint or PIN. On success it
   writes `bridge-session.flag` and serves the vault for **15 minutes**, then asks again.
3. **Never silent.** Consent is always a real prompt. Without it the answer is the old one: open the app.
4. **The old path still wins first.** An unlocked desktop app serves the vault with no prompt at all, so
   nothing about existing behaviour changes for users who keep the app open.
5. **Revocable and self-expiring.** Turning the switch off, locking the app, or resetting the vault
   clears the permission; the granted window has a hard expiry regardless.

This follows Microsoft's guidance for local secrets on Windows: keep the secret in the Credential
Locker, and gate its use behind `UserConsentVerifier` rather than inventing a bespoke unlock.

## Consequences

- Browser-only use costs one Hello prompt every 15 minutes instead of an app launch and a passphrase.
- The security boundary moves from "the desktop app is unlocked" to "Windows Hello confirmed this person
  in the last 15 minutes, and they opted in". On a machine where the attacker can already satisfy Hello,
  they could already read the Credential Locker — so this does not weaken the model; it stops using the
  app window as a proxy for presence.
- A device with no Hello enrolment gets no behaviour change: the host cannot verify, so it falls back to
  requiring the app. That is a deliberate, honest fallback rather than a silent downgrade.
- The privacy invariant is untouched: everything stays on the device, and nothing new is transmitted.

## Implementation

- `crates/native-host/src/lib.rs` — `may_serve()` (app session → live bridge window → Hello), plus
  `bridge_opt_in`, `bridge_session_fresh`, `hello_verify`; unit tests cover the window opening,
  lapsing, and the app-unlocked path still winning without a prompt.
- `crates/native-host/src/main.rs` — the request gate now calls `may_serve`.
- `apps/app/src-tauri/src/lib.rs` — `set_bridge_without_app` / `bridge_without_app_active` (opt-in and
  its state), and `unlock_with_hello` / `set_remember_unlock` for the same treatment on the app's own
  unlock screen. `lock_app` and `reset_vault` clear both permissions.

## Still to do before release

- The desktop settings UI for the switch (the commands exist; the toggle is not drawn yet).
- End-to-end verification: extension fills a form with the desktop app CLOSED, on a machine with Hello
  enrolled, and the same check with Hello declined (must fall back to the old message).
