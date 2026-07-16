// ProjectPDFs account / identity broker — **identity assertions only, never content**.
//
// Signing flow (REQ-09 Tier 1): the app builds the authorize URL, the user
// authenticates at their IdP, the app receives the code via a loopback/custom-scheme
// redirect, `handleCallback` verifies the ID token, and the resulting SsoProfile
// (subject/email) is bound to an **on-device Ed25519 signature** (non-delegable).
// A thin HTTP broker endpoint lands next; the OIDC logic is here and unit-tested.
export * from "./oidc.ts";
