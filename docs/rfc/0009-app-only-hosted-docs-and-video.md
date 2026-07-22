# RFC-0009 — App-only hosted docs & guide video (not bundled, no tracking)

- Status: Accepted → see [ADR-0019](../adr/0019-app-only-hosted-assets.md)
- Date: 2026-07-22

## Problem

The in-app **guide video** (~3 MB) and richer documentation should be:

1. **Not packaged** inside the Chrome extension or the desktop .exe/.msi — bundling megabytes of
   media in every install bloats downloads and forces an app release to fix a typo in the docs.
2. **Accessible only through our apps** — not freely linkable/scrapable on the open web.
3. **Compatible with the privacy invariant** (non-negotiable): servers may only serve assets
   *downward*, must never receive user content, and we do **no** telemetry and send **no
   identifiers**.

(2) and (3) are in tension: "only our app" usually implies a login/token that *identifies* the
caller — which (3) forbids.

## Key insight

Serving *our own* assets **downward** to the app is explicitly permitted by the invariant
("servers may only serve assets DOWNWARD — fonts, models, app updates"). Fetching a video carries
**no user content upward**. The only rule we must not break is attaching a **per-user / per-device
identifier** to the request (that would create a tracking record).

## Decision

Host the guide video (and future rich docs) on the existing OKE asset host
(`polyglotformfill.mooo.com`). Apps fetch it **downward**, gated by an **app-level** capability —
not a user-level one:

- **Edge gate:** the asset is served only when the request carries a per-release signed capability
  header (`X-PPF-App`, an HMAC over the path with a per-release build key) **and** an allowed
  `Origin`. Public web / hotlinks without it get `403`.
- **No tracking:** the capability is the **same secret for every install of a release**, so it
  proves *"a genuine app build is asking,"* never *which* user. No identifier goes up; no logs of
  identity. This keeps the privacy invariant intact.
- **Integrity:** the app pins the asset's **SHA-256**; fetched bytes are verified before use, so a
  compromised/tampered host cannot inject a different video.
- **Offline after first view:** the app caches the verified bytes locally (desktop: app-data dir;
  extension: Cache API) and plays from cache thereafter — no network on subsequent opens.
- **Written docs stay bundled** (they are tiny text) so the Docs tab is always useful offline; only
  the heavy video is hosted+fetched.

## Honest limitation (recorded deliberately)

A *downloadable* client cannot have an unbreakable "only our app" gate: the shared capability is
extractable from the binary. True per-user lockdown needs a login = an identifier = tracking, which
the invariant forbids. We therefore choose **app-level gating** — a strong deterrent against public
access and hotlinking, with **zero tracking** — over user-level DRM. This is the correct trade for a
privacy product and is stated plainly rather than oversold.

## Alternatives rejected

- **Bundle in the app** — fails (1); every doc edit needs a release.
- **Public unauthenticated URL** — fails (2); freely scrapable.
- **User/device-token gate** — fails (3); creates tracking records/identifiers.
- **Signed-URL only (no header)** — weaker; still hotlinkable within the URL's TTL and needs a
  signer service; the header+Origin+hash combination is simpler and cache-friendly.

## Scope / follow-up

- Client (desktop + extension): fetch-with-capability → verify hash → cache → play; graceful
  offline fallback to the bundled written docs.
- Server: OKE edge rule (nginx) validating `X-PPF-App` + `Origin`; upload the asset via the existing
  `publish-site` flow into the gated path.
- Rotate the per-release build key on each release; update the pinned hash when the video changes.
