# ADR-0010: Registered roles & verifiable workflows

- **Status:** Accepted (principle) — details pending
- **Date:** 2026-07-16
- **Deciders:** Team
- **Related:** RFC-0001, ADR-0009

## Context
Institutions and governing authorities act in defined roles; their actions must follow a clear
workflow that an authority can verify.

## Decision
Maintain an **Authority/Institution Registry** of organisational identity + **role** + **public key**
(org metadata, **not** user content → a registry server is invariant-safe). On **SSO/OIDC sign-in a
party's RegisteredRole is asserted** (from IdP claims or the registry) — Registrar, Notary,
KYC-officer, Court-clerk, Escrow-agent, Institution-admin — scoping capabilities. Each role runs a
**defined, role-scoped workflow**; every step is **attributed to (role, identity)**, audited, and
**bound into the provenance manifest + signatures**, so an authority can **verify the correct
workflow was followed by the authorised role**.

## Consequences
- Positive: accountable, role-based, independently verifiable workflows.
- Negative: registry trust model (federated claims vs hosted registry), role taxonomy + workflow
  definitions to spec; registry curation.
