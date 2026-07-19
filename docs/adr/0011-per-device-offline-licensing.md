# ADR-0011: Per-device, offline device-bound licensing

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Subramanya Mysore
- **Related:** ADR-0005 (offline licensing), RFC-0005

## Context
The product is licensed per device ("must be paid per device"), and the buyer is verified
via federated SSO at purchase. We must enforce per-device entitlement without breaking the
core promise that nothing leaves the device at runtime (no phone-home, no telemetry).

## Options considered
1. **Online activation server** — each device registers/validates against our server; true
   seat control, but adds infrastructure, receives device identifiers, and breaks the
   "nothing leaves your device" posture (needs a documented privacy carve-out).
2. **Offline device-bound token** — the offline Ed25519 license (ADR-0005) additionally
   carries a `device_id`; the app verifies the token is valid **and** bound to this device.
   No runtime server; SSO is used only at purchase/issuance on the storefront.
3. **Account-bound (SSO at runtime)** — the app checks a live SSO session; strongest identity
   but requires runtime network + an identity egress on every launch.

## Decision
**Option 2.** `License` gains an optional `device_id` (empty = valid on any device, for
backward compatibility). New `verify_on_device(token, vendor_public, now, this_device)`
verifies the signature, expiry, **and** that `device_id` matches this device — all offline.
The `device_id` is a random per-install identifier stored locally (an installation id, not a
hardware fingerprint), which avoids privacy-invasive hardware probing while still being
per-device. It is inside the signed payload, so it cannot be swapped without breaking the
signature (covered by tests). SSO authenticates the buyer at the storefront, which issues one
device-bound token per purchased device; the app never contacts a server.

## Consequences
- **Positive:** per-device enforcement with zero runtime network; privacy invariant intact
  (no identity egress at runtime); backward compatible (unbound tokens still work); tamper-proof
  binding.
- **Negative / cost:** re-installing / new device needs a new token for that device's id (this
  is the intended seat model); a user who wipes the install id gets a new device identity —
  acceptable, since the token would then not match and must be re-issued. Moving data between
  the devices a user has licensed is handled by encrypted export/import (ADR-0003), not by
  sharing a license.
- **Follow-ups:** storefront issuance flow (SSO → issue device-bound token); optional
  account-bound export/import (same-person guarantee) once SSO lands.
