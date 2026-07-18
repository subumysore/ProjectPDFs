# Create a SELF-SIGNED code-signing certificate for DEV testing of the signing
# pipeline. A self-signed cert is NOT trusted by other machines (SmartScreen will
# still warn) - it only proves that build-time signing + timestamp + verify work.
# For distribution you need a real OV/EV cert from a CA (see docs/reference/code-signing.md).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/new-dev-signing-cert.ps1
# Then, for the current shell:
#   $env:WINDOWS_CERT_THUMBPRINT = "<printed thumbprint>"
#   pnpm --filter @projectpdfs/app tauri build
[CmdletBinding()]
param(
  [string] $Subject = "CN=PolyglotFormFill Dev (self-signed), O=PolyglotFormFill",
  [int]    $YearsValid = 2
)

$ErrorActionPreference = 'Stop'

$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $Subject `
  -CertStoreLocation Cert:\CurrentUser\My `
  -KeyExportPolicy Exportable `
  -KeyUsage DigitalSignature `
  -NotAfter (Get-Date).AddYears($YearsValid) `
  -HashAlgorithm SHA256

Write-Host ""
Write-Host "Created self-signed code-signing certificate in Cert:\CurrentUser\My"
Write-Host "  Subject   : $($cert.Subject)"
Write-Host "  Thumbprint: $($cert.Thumbprint)"
Write-Host "  Expires   : $($cert.NotAfter)"
Write-Host ""
Write-Host "Use it for a signed dev build (this shell):"
Write-Host "  `$env:WINDOWS_CERT_THUMBPRINT = `"$($cert.Thumbprint)`""
Write-Host "  pnpm --filter @projectpdfs/app tauri build"
Write-Host ""
Write-Host "To remove it later:"
Write-Host "  Remove-Item Cert:\CurrentUser\My\$($cert.Thumbprint)"
