# Runbook — paid platform signing & distribution (execute at purchase time)

Turnkey steps to light up the paid tiers from ADR-0023/0024. **Everything is entity-gated** and
deferred until "revenue allows." The build pipeline hooks are **already wired** — each step below is
mostly *obtain the credential → set an env var → rebuild*.

**Step 0 — Register the business entity.** Unlocks EV validation + the Azure org tier; needed for
invoicing. Nothing below starts without it.

---

## A. Windows code signing — hook is READY (`apps/app/src-tauri/sign-windows.ps1`)
The Tauri build already calls the signing hook per-artifact (`tauri.conf.json → bundle.windows.signCommand`).
It signs with SHA-256 + RFC-3161 timestamp and **fails the build on a real signing error**. To enable:

1. **Choose the cert** (ADR order): **Azure Trusted Signing** (~US$9.99/mo, *re-check India-org
   eligibility first*) → **OV** (~US$150–400/yr, reputation over time) → **EV** (~US$300–700+/yr,
   **instant** SmartScreen trust, HW token / cloud HSM). For instant trust once the entity exists, EV.
2. **Install it** in the Windows cert store (CurrentUser\My or LocalMachine\My), note its **SHA-1 thumbprint**.
3. **Set the env var** (never commit it):
   ```powershell
   setx WINDOWS_CERT_THUMBPRINT "<thumbprint>"     # or WINDOWS_CERT_PFX + WINDOWS_CERT_PASSWORD
   ```
   *(Azure Trusted Signing uses its own signtool dlib — if you go that route, point `SIGNTOOL`/the
   signCommand at the Azure signing tool; ping me and I'll adjust `sign-windows.ps1`.)*
4. **Rebuild** — `node scripts/set-version.mjs <v>` → `pnpm tauri build` → artifacts are signed →
   `node scripts/release-manifest.mjs` → `deploy/k8s/publish-site.ps1 -WithBinaries`.
5. **Verify:** `signtool verify /pa /v <setup.exe>` chains to a trusted root (EV/OV pass; self-signed won't).

## B. Azure Trusted Signing (org tier) — cheapest CA-chained
- **Gate:** eligibility is region-gated (orgs US/Canada/EU/UK). **Re-check the India-org tier** before relying on it.
- Azure account → create **Trusted Signing** resource → validate **org identity** → wire its signtool
  into the signCommand (I'll update `sign-windows.ps1` to call the Azure dlib). Then same rebuild as (A).

## C. macOS — config is READY (`bundle.macOS` + `entitlements.plist` + `scripts/notarize-macos.sh`)
Tauri notarizes automatically during `tauri build` when the Apple creds are in the env.
1. **Get a build Mac** (Tauri can't cross-compile macOS from Windows) + Xcode CLT.
2. **Apple Developer Program — US$99/yr.** Create a **"Developer ID Application"** cert; install in the login keychain.
3. **Set env** (one auth method): `APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"`,
   plus either `APPLE_API_KEY_ID`/`APPLE_API_ISSUER`/`APPLE_API_KEY_PATH` **or**
   `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`.
4. **Build on the Mac:** `pnpm tauri build` → produces a signed, hardened-runtime, **notarized** `.dmg`.
   *(Fallback / re-staple: `scripts/notarize-macos.sh path/to.dmg`.)*
5. **Verify:** `xcrun stapler validate <dmg>` and `spctl --assess`.
6. Distribute the `.dmg` at a stable `…/download/` URL (mirror the Windows flow) + optional Homebrew Cask.

## D. Microsoft Store / MSIX — lowest priority
- **Cost:** one-time dev registration (~US$19 individual / ~US$99 company). The **Store signs** the package.
- Register **Microsoft Partner Center** → package app as **MSIX** (add `msi`/`msix` to targets or use the
  MSIX tooling) → submit → Store review signs + publishes. Removes the unsigned-download warning + adds discovery.

---

## Order & triggers (ADR-0024)
Entity registered → **EV cert → re-check Azure org → macOS → MS Store**. Triggers = **entity registered**
+ **revenue allows**; never a date. (Minimize-spend order instead = **Azure → OV → EV**, ADR-0023.)

## Privacy note
Signing/notarization are **build-time** operations on our own binaries — no user content, no runtime
egress. The privacy invariant is untouched.
