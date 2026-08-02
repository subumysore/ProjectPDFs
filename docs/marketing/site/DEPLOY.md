# Deploy the PolyglotFormFill site

This folder is a **complete static website** — just these files, no build step, no server:

```
site/
  index.html          → the landing page   (https://your-domain/)
  privacy/index.html  → the privacy policy (https://your-domain/privacy/)
  404.html
```

(Regenerate anytime from the source pages with `node ../build-site.mjs`.)

You do **not** need `polyglotformfill.com` working to launch — any of these gives you a live
**HTTPS** URL in minutes (which the Chrome Web Store requires for the privacy-policy link).

## Option A — Cloudflare Pages (recommended: free host + HTTPS + DNS in one place)
1. Sign in at **dash.cloudflare.com** → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Drag this `site/` folder in → **Deploy**. You get `https://<name>.pages.dev` immediately.
3. (Optional custom domain) Add `polyglotformfill.com` in Cloudflare, change your registrar's
   nameservers to the two Cloudflare gives you, then **Custom domains** → add it. HTTPS is automatic.

## Option B — Netlify (drag-and-drop)
1. Go to **app.netlify.com** → **Add new site** → **Deploy manually**.
2. Drag this `site/` folder → you get `https://<name>.netlify.app`.
3. (Optional) **Domain settings** → add your custom domain and follow the DNS instructions.

## Option C — GitHub Pages
1. Put the contents of `site/` in a repo (e.g. a `docs/` folder or a `gh-pages` branch).
2. Repo **Settings → Pages** → set the source → get `https://<user>.github.io/<repo>/`.
3. (Optional) add a custom domain in Pages settings + a `CNAME` DNS record.

## About the domain you registered
- **`polyglotformfill.com` is "Broken"** in FreeDNS because it isn't delegated yet — set the
  registrar's nameservers to your host's (Cloudflare's, if you use Option A) and it resolves once
  it propagates (minutes–24h for a new registration).
- **`polyglotformfill.com → 45.37.194.118`** currently points at an IP with **no web server**
  (nothing responds). A DNS record alone hosts nothing — use one of the hosts above instead, or run
  a real web server at that IP.

## Before you publicly launch — fill these placeholders
- `privacy/index.html`: `[DATE]`, `[LEGAL ENTITY NAME]`, `[registered address]`, Grievance Officer /
  contact details, `[PROVIDER]`, age threshold — **and have counsel review** (see the banner on the page).
- `index.html`: the **Add to Chrome / Edge / Firefox / Windows** buttons are placeholders (`href="#"`) —
  point them at your store listings / download once live.
