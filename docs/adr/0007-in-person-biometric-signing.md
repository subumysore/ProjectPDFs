# ADR-0007: In-person biometric/witnessed signing (device-less signee)

- **Status:** Accepted (principle) — implementation details pending
- **Date:** 2026-07-16
- **Deciders:** Team
- **Related:** RFC-0001, ADR-0004

## Context
Many signees (field enrolment, low-tech, elderly) have no device/passkey; some jurisdictions accept
a **thumbprint signature**. We still must not allow signing on behalf of another.

## Options considered
1. **In-person witnessed sign:** signee reviews on the operator's device, draws a signature + gives a
   **live fingerprint/thumbprint**; the SSO-authenticated **operator attests** the capture.
2. Only cryptographic self-sign — excludes device-less signees.

## Decision
Add **Tier 2 in-person witnessed signing** alongside Tier 1 (cryptographic self-sign). Non-delegable
via the **live biometric + accountable witness**, but **explicitly lower assurance** than Tier 1.
Biometric is **special-category PII**: on-device only, encrypted, consented, non-reversible template
preferred. **Hardware:** built-in sensors are auth-only (no image) → use an **external scanner SDK**
or an **inked-thumbprint photo**.

## Consequences
- Positive: serves device-less signees (key India CSC use case).
- Negative: lower assurance tier; biometric legal/data-classification per jurisdiction; hardware
  dependency; liveness/anti-spoofing needed.
