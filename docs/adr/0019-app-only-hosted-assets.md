# ADR-0019 — App-only hosted assets (guide video) served downward, gated at app level, no tracking

- Status: Accepted
- Date: 2026-07-22
- Context RFC: [RFC-0009](../rfc/0009-app-only-hosted-docs-and-video.md)

## Context

The guide video (~3 MB) must not be bundled in the extension/desktop app, must be reachable only
through our apps, and must not break the privacy invariant (downward-only serving, no user content
up, no identifiers, no telemetry).

## Decision

- **Host** the guide video on the OKE asset host and serve it **downward** to the apps (permitted by
  the invariant). Ship apps with the **written docs only** (small, always-offline) plus the video's
  pinned SHA-256.
- **Gate at the app level, not the user level.** The edge serves the asset only for requests bearing
  a per-release signed capability header (`X-PPF-App`) and an allowed `Origin`. The capability is
  identical across all installs of a release, so it authenticates *"a real app build"* without
  identifying any user — **no tracking, no identifiers** leave the device.
- **Verify integrity** against a pinned SHA-256 before use; **cache** the verified bytes on-device
  and play from cache thereafter (offline-capable).
- **Never** attach a user/device identifier, cookie, or telemetry to the request.

## Consequences

- Smaller app/extension bundles; docs/video updatable without an app release (rotate hash + asset).
- "App-only" is enforced as a **deterrent**, not DRM: the shared capability is extractable from a
  downloadable client. We accept this deliberately because the invariant-compliant alternative
  (no per-user identity) cannot do better, and user-level gating would introduce tracking. Stated
  honestly in-product and in docs.
- Requires: per-release build-key rotation, the OKE edge rule, and the pinned-hash update step in
  the release checklist.

## Alternatives considered

Bundle-in-app (bloat, release-coupled), public URL (scrapable), user-token gate (tracking —
violates the invariant), signed-URL-only (weaker, needs a signer). See RFC-0009.

Supersedes nothing. Related: ADR-0015 (offline license), ADR-0018 (language-agnostic engine),
the PRIVACY INVARIANT in `CLAUDE.md`.
