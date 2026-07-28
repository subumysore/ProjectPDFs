# Runbook — Azure Trusted Signing (Windows installer) — OWNER onboarding

Goal: remove the SmartScreen "Unknown publisher" wall on the Windows installer by signing it with
**Azure Trusted Signing** (~US$9.99/mo). See ADR-0026. The build side is already wired
(`apps/app/src-tauri/sign-windows.ps1`); this runbook is the **owner's one-time Azure setup**. Once you
hand Claude the four values + service-principal creds at the bottom, Claude signs + republishes.

> Identity validation (step 4) takes ~1–3 business days. Everything else is minutes.

## 1. Azure account + subscription
- Sign in at https://portal.azure.com with your Microsoft account (subumysore@gmail.com is fine).
- Create/confirm a **Pay-As-You-Go** subscription (Trusted Signing is not free-tier).
- In **Subscriptions → Resource providers**, register **`Microsoft.CodeSigning`**.

## 2. Create the Trusted Signing account
- Portal → search **"Trusted Signing accounts"** → **Create**.
- Resource group: new, e.g. `polyglotformfill-signing`. Region: **West US 2** (or nearest).
- SKU: **Basic** (~US$9.99/mo). Name it e.g. `polyglotformfill`. Create.
- Note the account's **Endpoint URI** (Overview blade), e.g. `https://wus2.codesigning.azure.net/`.

## 3. Create a certificate profile
- Inside the account → **Certificate profiles** → **Create**.
- Profile type: **Public Trust** (this is what makes SmartScreen trust it).
- Identity type: **Individual** (for a sole proprietor) or **Organization** (needs a verifiable org,
  usually 3+ yrs old). Individual uses your government ID.
- Name it e.g. `ppf-release`. Create — this **starts identity validation**.

## 4. Complete identity validation (the ~1–3 day gate)
- The account's **Identity validations** blade will show a request. Follow it: for **Individual**,
  upload a government ID and confirm your details. Wait for **Completed/Succeeded**.
- You cannot sign until this succeeds.

## 5. Grant a signer identity (service principal)
- **Microsoft Entra ID → App registrations → New registration** (name e.g. `ppf-signer`). Note the
  **Application (client) ID** and **Directory (tenant) ID**.
- Under that app → **Certificates & secrets → New client secret** → copy the **secret VALUE** (once).
- Back on the **Trusted Signing account → Access control (IAM) → Add role assignment**:
  assign **"Trusted Signing Certificate Profile Signer"** to the `ppf-signer` app.

## 6. Signing toolchain (Claude can do this part on the build machine)
- Windows 10/11 SDK (`signtool.exe`) — already present here.
- The signing dlib: install the **Microsoft.Trusted.Signing.Client** NuGet (or the "Trusted Signing"
  dotnet tool); note the path to **`Azure.CodeSigning.Dlib.dll`** → `TRUSTED_SIGNING_DLIB`.

## 7. What to hand Claude (non-secret first three; last three are secrets → set as env, don't paste)
Give Claude these three **non-secret** values:
- `TRUSTED_SIGNING_ENDPOINT`  (from step 2, e.g. `https://wus2.codesigning.azure.net/`)
- `TRUSTED_SIGNING_ACCOUNT`   (the account name, e.g. `polyglotformfill`)
- `TRUSTED_SIGNING_PROFILE`   (the profile name, e.g. `ppf-release`)

Set these **secrets** yourself as **User** env vars (same method as `STRIPE_API_KEY`), then tell Claude "set":
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`  (from step 5)

## 8. Claude signs + republishes (turnkey, after step 7)
1. Export the six env vars for the build shell.
2. Re-sign the staged installer (no full rebuild needed):
   `powershell -File apps/app/src-tauri/sign-windows.ps1 docs/marketing/site/download/PolyglotFormFill-Setup.exe`
   (and the `.msi` if published), then verify: `signtool verify /pa /v <file>` must chain + timestamp OK.
   — or simply re-run `pnpm tauri build` with the env set (Tauri calls the hook per artifact).
3. Regenerate the SHA-256 manifest **with `--signed`** (this is the one flag that flips the whole site):
   `node scripts/release-manifest.mjs generate --dir docs/marketing/site/download --version <ver> --signed`.
4. Rebuild the site: `node docs/marketing/build-site.mjs`. The install page **auto-swaps** the
   "expect a SmartScreen warning" heads-up for a "Digitally signed" note (driven off the manifest's
   `signed` field); the SHA-256 verify block stays. No manual copy edit needed. (Round-trip verified.)
5. Owner runs `deploy/k8s/publish-site.ps1 -WithBinaries` to publish the signed installer.

## Notes
- Secrets NEVER go in git. The signing certificate's private key is held by the Azure CA (no PFX on
  disk) — a security improvement over a local cert.
- If sales stall and you cancel the subscription, the build falls back to unsigned automatically (no
  code change) — the zero-cost ADR-0023 tier still stands.
