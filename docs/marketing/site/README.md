# Static-root passthrough (`docs/marketing/well-known/`)

Everything in this folder is copied **verbatim to the site root** by `build-site.mjs` on every build,
preserving subdirectories. Use it for ownership-proof and trust files that must survive rebuilds.

Currently hosted:
- `.well-known/security.txt` → `https://polyglotformfill.com/.well-known/security.txt`

## To add Google Search Console verification (clears the Chrome "Virus detected" verdict)
1. In Search Console, add property `polyglotformfill.com`, choose **HTML file** verification.
2. Download the `googleXXXXXXXXXXXX.html` file Google gives you.
3. Drop it **directly in this folder** (`docs/marketing/well-known/googleXXXXXXXXXXXX.html`).
4. `node docs/marketing/build-site.mjs` then `deploy/k8s/publish-site.ps1` — it will be live at
   `https://polyglotformfill.com/googleXXXXXXXXXXXX.html`.
5. Back in Search Console, click **Verify**, then open **Security & Manual Actions → Security Issues**
   and **Request Review** (see `docs/runbooks/safe-browsing-appeal.md`).
