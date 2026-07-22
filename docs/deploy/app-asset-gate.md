# App-only asset gate (OKE) — guide video & rich docs

Implements [ADR-0019](../adr/0019-app-only-hosted-assets.md): the guide video is served **downward**
from `polyglotformfill.mooo.com/app-assets/…` **only** to genuine app builds, with **no user
identifier** in the request (so no tracking).

## Contract the apps use

The app sends, on the asset GET:

- `X-PPF-App: <per-release token>` — the same value for every install of a release (identifies *an
  app build*, never a user). Desktop: `APP_ASSET_TOKEN` in `apps/app/src-tauri/src/lib.rs`.
  Extension: the mirror constant in the extension's asset helper.
- `Origin: app://polyglotformfill`

The app then **verifies the response against a pinned SHA-256** and caches it locally. So the gate is
a **deterrent** (blocks public web / hotlinking / casual scraping), not DRM — a downloadable client's
token is extractable, and that's accepted deliberately because the privacy-invariant alternative
(per-user identity) would introduce tracking.

## nginx location (edge / ingress)

```nginx
# Serve /app-assets/* only to requests bearing the current app token + an allowed Origin.
location /app-assets/ {
    # Rotate this per release; keep the previous value for one release to avoid breaking old apps.
    set $ppf_ok 0;
    if ($http_x_ppf_app = "ppf-app-2026-07-beta") { set $ppf_ok 1; }
    if ($http_origin = "app://polyglotformfill") { set $ppf_ok "${ppf_ok}1"; }
    if ($ppf_ok != "11") { return 403; }

    # No identity logging for these requests (no tracking).
    access_log off;
    add_header Cache-Control "public, max-age=604800, immutable";
    add_header Cross-Origin-Resource-Policy "cross-origin";
    root /srv/polyglotformfill;            # /srv/polyglotformfill/app-assets/guide.mp4
    # (Optional hardening: also gate on a rotating HMAC over the path instead of a static token.)
}
```

> The static-token form above is intentionally simple. For a stronger deterrent, replace the token
> compare with an HMAC check: the app sends `X-PPF-App: <hex(hmac_sha256(path, release_key))>` and the
> edge recomputes it. Still app-level (no user identity), just not a copy-pasteable constant.

## Release checklist (when the video/docs change)

1. `powershell -File scripts/build-guide-video.ps1` → note the printed **SHA-256**.
2. Update `GUIDE_SHA256` in `apps/app/src-tauri/src/lib.rs` (and the extension mirror) to that hash.
3. Rotate `APP_ASSET_TOKEN` (app) and the nginx `$http_x_ppf_app` compare (keep the old value one
   release for overlap).
4. `deploy/publish-site.ps1` uploads `docs/marketing/site/app-assets/guide.mp4` to the host.
5. Rebuild the app binaries so the new token + pinned hash ship.
