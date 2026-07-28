# ADR-0026 — Adopt Azure Trusted Signing for the Windows installer

- Status: Accepted
- Date: 2026-07-28
- Extends ADR-0023 (code-signing & distribution strategy). ADR-0023 planned this as "Tier 2 — when
  revenue allows"; with Stripe live (ADR-0025) and the first sale imminent, we now execute it.

## Context
The unsigned NSIS/MSI installer trips Microsoft Defender SmartScreen ("Windows protected your PC —
Unknown publisher") on first run. ADR-0023 documented the zero-cost interim (disclose-the-warning copy
+ SHA-256 manifest) but flagged that only a CA-chained certificate removes the wall. The standing
"no budget until revenue" rule blocked a paid cert; that rule is now lifted **for signing only**,
because we are taking payments and a scary security wall directly suppresses conversions.

Owner decision (2026-07-28): **Azure Trusted Signing** — the cheapest *real* CA-chained option
(~US$9.99/mo), which removes "Unknown publisher" and accrues SmartScreen reputation like an OV cert.
EV (instant trust, ~US$300–700/yr + HSM) was considered but rejected as overkill for launch scale.

## Decision
Sign every published Windows artifact with Azure Trusted Signing.

- **Build hook** (`apps/app/src-tauri/sign-windows.ps1`) gains a Trusted-Signing mode that takes
  precedence over the classic thumbprint/PFX paths. It is engaged when `TRUSTED_SIGNING_ENDPOINT`,
  `TRUSTED_SIGNING_ACCOUNT`, and `TRUSTED_SIGNING_PROFILE` are set; it signs via
  `signtool /dlib Azure.CodeSigning.Dlib.dll /dmdf <metadata.json>` with the account's own RFC-3161
  timestamp server (`timestamp.acs.microsoft.com`). Auth is a service principal (`AZURE_*`) or
  `az login`. With no signing env set, the build stays unsigned (dev builds need no secret).
- **Secrets** (the service-principal `AZURE_CLIENT_SECRET`, etc.) live ONLY in the build machine's
  environment / CI secret store — never in git. The signing cert itself is custody of the Azure CA
  (no private key on disk), which is a security win over a PFX.
- **Owner onboarding** (account, identity validation, profile, RBAC) is documented in
  `docs/runbooks/azure-trusted-signing.md`. Identity validation (~1–3 business days) is the gate; the
  build side is ready today.

## Consequences
- (+) "Unknown publisher" gone once the first signed build ships; reputation then accrues.
- (+) No private key on disk (cloud HSM custody). (+) ~US$10/mo, cancellable.
- (−) ~1–3 day identity-validation wait before the first signed build. (−) Recurring cost (acceptable —
  it's now revenue-backed; if sales stall we can cancel and fall back to the ADR-0023 zero-cost tier).
- **Privacy invariant unaffected** — signing hashes our own binary and talks only to the Azure CA; no
  user content, no download telemetry.

## Follow-ups (Claude, once credentials exist)
1. Rebuild (or re-sign the staged installer), verify the signature chains + timestamps, regenerate the
   SHA-256 release manifest, republish via `publish-site.ps1 -WithBinaries`.
2. Update the install-page copy: soften/replace the "expect an Unknown-publisher warning" section now
   that the app is signed (keep the SHA-256 verify block).
3. macOS signing/notarization remains deferred (ADR-0023 Tier 3).
