# Windows code signing (Authenticode)

> **Current shipping policy ([ADR-0020](../adr/0020-distribution-trust-without-paid-certificate.md)):
> public releases go out UNSIGNED, deliberately.** No certificate has been purchased yet. A
> self-signed certificate must **not** be used for public artifacts: its chain does not validate on
> anyone else's machine, so SmartScreen behaves exactly as it does for an unsigned binary, and some
> enterprise/AV policies treat *"signature present but chain invalid"* more harshly than no signature
> at all. Self-signing below is a **dev-only** tool for exercising this pipeline.
>
> Trust is instead carried by: extension-first distribution, `winget` (no certificate required), and
> a published SHA-256 per artifact (`scripts/release-manifest.mjs`). When a certificate is bought,
> set `WINDOWS_CERT_THUMBPRINT` and rebuild — nothing else changes.

The Windows desktop app (`tauri build`) can Authenticode-sign every produced binary —
the app `.exe`, the MSI, and the NSIS `-setup.exe` — plus RFC-3161 timestamp them so
signatures stay valid after the certificate expires.

Signing is **opt-in and secret-free in git**: the build calls
[`apps/app/src-tauri/sign-windows.ps1`](../../apps/app/src-tauri/sign-windows.ps1)
(wired via `bundle.windows.signCommand` in
[`tauri.conf.json`](../../apps/app/src-tauri/tauri.conf.json)) once per artifact. That
script signs **only** when a certificate is provided through environment variables; with
none set it **skips signing and the build still succeeds** (unsigned). No thumbprint,
`.pfx`, or password is ever committed.

## Configuration (environment variables)

Set **one** of these two, in your shell or `.env` (never in git):

| Variable | Meaning |
|---|---|
| `WINDOWS_CERT_THUMBPRINT` | SHA1 thumbprint of a code-signing cert already in the Windows store (`CurrentUser\My` or `LocalMachine\My`). |
| `WINDOWS_CERT_PFX` + `WINDOWS_CERT_PASSWORD` | Path to a `.pfx`/`.p12` file and its password (password optional). |

Optional:

| Variable | Default |
|---|---|
| `WINDOWS_TS_URL` | `http://timestamp.digicert.com` — RFC-3161 timestamp server. |
| `SIGNTOOL` | Auto-located from the Windows SDK if unset. |

## Quick test today (self-signed dev cert)

A self-signed cert proves the *pipeline* (sign + timestamp + verify) without buying a
cert. It is **not trusted** on other machines — SmartScreen still warns — so it is for
dev only.

```powershell
# 1. Create a disposable dev cert (prints its thumbprint)
powershell -ExecutionPolicy Bypass -File scripts/new-dev-signing-cert.ps1

# 2. Enable signing for this shell, then build
$env:WINDOWS_CERT_THUMBPRINT = "<thumbprint from step 1>"
pnpm --filter @projectpdfs/app tauri build

# 3. (optional) confirm the artifact is signed
$env:SIGNTOOL_DIR = (Get-ChildItem "$env:ProgramFiles (x86)\Windows Kits\10\bin" -Recurse -Filter signtool.exe | Where-Object FullName -match '\\x64\\' | Sort-Object FullName -Desc | Select-Object -First 1).DirectoryName
& "$env:SIGNTOOL_DIR\signtool.exe" verify /pa /v target\release\bundle\nsis\PolyglotFormFill_*-setup.exe
```

With a self-signed cert the `verify` chain check reports "root not trusted" — that is
expected and the sign script downgrades it to a warning. A CA-issued cert (below) chains
cleanly and verifies.

Remove the dev cert when done: `Remove-Item Cert:\CurrentUser\My\<thumbprint>`.

## Release step: publish hashes (required while unsigned)

After `tauri build`, copy the artifacts into `docs/marketing/site/download/`, then:

```powershell
node scripts/release-manifest.mjs generate --dir docs/marketing/site/download --version <ver>
node scripts/release-manifest.mjs verify   --dir docs/marketing/site/download
.\deploy\k8s\publish-site.ps1
```

`--version` must be the version the binaries actually report (check with
`(Get-Item <file>).VersionInfo.ProductVersion`) — not the version in `package.json`. The install page
reads `release-manifest.json` at runtime to display the hashes, so it can never drift from what was
published. The same SHA-256 values are what a winget manifest PR needs.

## Production (real certificate)

For public distribution you need a certificate from a trusted CA (DigiCert, Sectigo,
GlobalSign, …):

- **OV (Organization Validated)** — cheaper; builds SmartScreen reputation over time/downloads.
- **EV (Extended Validation)** — instant SmartScreen trust; the private key lives on an
  HSM / USB token or a cloud HSM (Azure Key Vault, DigiCert KeyLocker), so the key is not
  a file. For cloud-HSM signing, point `SIGNTOOL`/args at the vendor's `signtool`
  dlib provider (extend `sign-windows.ps1` accordingly).

Then either import the cert into the Windows store and set `WINDOWS_CERT_THUMBPRINT`, or
point `WINDOWS_CERT_PFX` (+ `WINDOWS_CERT_PASSWORD`) at the `.pfx`. Build as usual.

## CI notes

- Provide the cert to CI as a **secret** (base64 the `.pfx`, decode to a temp path at
  runtime, set `WINDOWS_CERT_PFX`/`WINDOWS_CERT_PASSWORD`). Never store it in the repo.
- For EV/HSM, run the signing job on a runner that can reach the token/vault.
- Timestamping requires outbound network to `WINDOWS_TS_URL` (build-time only — this is
  tooling egress, not user content, so it does not touch the privacy invariant).

## Privacy invariant

Signing is a build-time operation on our own binaries. It sends nothing but a hash to the
timestamp authority and never touches user content — fully consistent with the on-device
privacy model.
