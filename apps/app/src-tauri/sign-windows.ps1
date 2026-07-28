# Authenticode signing hook for `tauri build` (wired via bundle.windows.signCommand).
#
# Tauri calls this once per produced binary (the app .exe, the MSI, the NSIS setup),
# passing the file path as the sole argument. Signing is OPT-IN via environment.
#
# PREFERRED — Azure Trusted Signing (ADR-0026; CA-chained, ~US$10/mo, builds SmartScreen
# reputation). Set all three and (optionally) the dlib path + Azure credentials:
#   TRUSTED_SIGNING_ENDPOINT   e.g. https://wus2.codesigning.azure.net/
#   TRUSTED_SIGNING_ACCOUNT    the Trusted Signing account name
#   TRUSTED_SIGNING_PROFILE    the certificate profile name
#   TRUSTED_SIGNING_DLIB       path to Azure.CodeSigning.Dlib.dll (from the
#                              Microsoft.Trusted.Signing.Client NuGet); auto-located if unset
#   AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET  service-principal auth (or `az login`)
#
# FALLBACK — a classic cert (OV/EV) in the store or a PFX file:
#   WINDOWS_CERT_THUMBPRINT   SHA1 thumbprint of a code-signing cert in the Windows store.
#   -- OR --
#   WINDOWS_CERT_PFX          Path to a .pfx/.p12 code-signing certificate file.
#   WINDOWS_CERT_PASSWORD     Password for that .pfx (optional if none).
#
#   WINDOWS_TS_URL            RFC-3161 timestamp server (default: Trusted Signing's when in
#                             Trusted-Signing mode, else DigiCert).
#   SIGNTOOL                  Explicit path to signtool.exe (else auto-located).
#
# If NO signing env var is set, signing is SKIPPED and the build continues (unsigned) —
# so plain dev builds work without any secret. Secrets stay in the environment and
# never enter git. On a real signing failure the script exits non-zero so a build
# never silently produces an "unsigned artifact that looks signed".
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $File
)

$ErrorActionPreference = 'Stop'

$tsEndpoint = $env:TRUSTED_SIGNING_ENDPOINT
$tsAccount  = $env:TRUSTED_SIGNING_ACCOUNT
$tsProfile  = $env:TRUSTED_SIGNING_PROFILE
$trustedMode = -not ([string]::IsNullOrWhiteSpace($tsEndpoint) -or [string]::IsNullOrWhiteSpace($tsAccount) -or [string]::IsNullOrWhiteSpace($tsProfile))

$thumb   = $env:WINDOWS_CERT_THUMBPRINT
$pfx     = $env:WINDOWS_CERT_PFX
$pfxPass = $env:WINDOWS_CERT_PASSWORD
# Trusted Signing REQUIRES its own RFC-3161 timestamp server; classic certs default to DigiCert.
$defaultTs = if ($trustedMode) { 'http://timestamp.acs.microsoft.com' } else { 'http://timestamp.digicert.com' }
$tsUrl   = if ($env:WINDOWS_TS_URL) { $env:WINDOWS_TS_URL } else { $defaultTs }

if (-not $trustedMode -and [string]::IsNullOrWhiteSpace($thumb) -and [string]::IsNullOrWhiteSpace($pfx)) {
  Write-Host "[sign-windows] No signing credentials set (Trusted Signing or cert) - skipping signing (unsigned build)."
  exit 0
}

# Locate signtool.exe: explicit override, PATH, then newest Windows SDK.
function Find-SignTool {
  if ($env:SIGNTOOL -and (Test-Path $env:SIGNTOOL)) { return $env:SIGNTOOL }
  $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $roots = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
    "${env:ProgramFiles}\Windows Kits\10\bin"
  ) | Where-Object { Test-Path $_ }
  $found = foreach ($r in $roots) {
    Get-ChildItem -Path $r -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\' }
  }
  $best = $found | Sort-Object { [version]($_.Directory.Parent.Name) } -Descending | Select-Object -First 1
  if (-not $best) { throw "signtool.exe not found. Install the Windows 10/11 SDK or set `$env:SIGNTOOL." }
  return $best.FullName
}

# Locate the Azure Trusted Signing dlib (Azure.CodeSigning.Dlib.dll) shipped by the
# Microsoft.Trusted.Signing.Client NuGet — explicit override, then common install roots.
function Find-TrustedDlib {
  if ($env:TRUSTED_SIGNING_DLIB -and (Test-Path $env:TRUSTED_SIGNING_DLIB)) { return $env:TRUSTED_SIGNING_DLIB }
  $roots = @(
    "$env:USERPROFILE\.nuget\packages\microsoft.trusted.signing.client",
    "${env:ProgramFiles}\Microsoft Trusted Signing Client",
    "$PSScriptRoot"
  ) | Where-Object { Test-Path $_ }
  foreach ($r in $roots) {
    $hit = Get-ChildItem -Path $r -Recurse -Filter 'Azure.CodeSigning.Dlib.dll' -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  throw "Azure.CodeSigning.Dlib.dll not found. Install the Microsoft.Trusted.Signing.Client NuGet or set `$env:TRUSTED_SIGNING_DLIB."
}

$signtool = Find-SignTool
Write-Host "[sign-windows] Signing '$File' with $signtool"

$sargs = @('sign', '/fd', 'SHA256', '/tr', $tsUrl, '/td', 'SHA256', '/v')
$tmpMeta = $null
if ($trustedMode) {
  # Azure Trusted Signing: signtool signs via the CA dlib + a metadata file naming the
  # endpoint / account / certificate profile. Auth comes from AZURE_* env or `az login`.
  $dlib = Find-TrustedDlib
  $meta = [ordered]@{
    Endpoint               = $tsEndpoint
    CodeSigningAccountName = $tsAccount
    CertificateProfileName = $tsProfile
  }
  $tmpMeta = [System.IO.Path]::GetTempFileName() + '.json'
  # Write UTF-8 WITHOUT a BOM — the Trusted Signing dlib's JSON parser rejects a leading 0xEF BOM
  # (Set-Content -Encoding utf8 emits one on Windows PowerShell 5.1).
  [System.IO.File]::WriteAllText($tmpMeta, ($meta | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "[sign-windows] Trusted Signing: account '$tsAccount', profile '$tsProfile', endpoint '$tsEndpoint'"
  $sargs += @('/dlib', $dlib, '/dmdf', $tmpMeta)
} elseif (-not [string]::IsNullOrWhiteSpace($thumb)) {
  $sargs += @('/sha1', $thumb)
} else {
  if (-not (Test-Path $pfx)) { throw "WINDOWS_CERT_PFX '$pfx' does not exist." }
  $sargs += @('/f', $pfx)
  if (-not [string]::IsNullOrWhiteSpace($pfxPass)) { $sargs += @('/p', $pfxPass) }
}
$sargs += $File

try {
  & $signtool @sargs
  if ($LASTEXITCODE -ne 0) { throw "signtool sign failed (exit $LASTEXITCODE) for '$File'." }
} finally {
  if ($tmpMeta -and (Test-Path $tmpMeta)) { Remove-Item $tmpMeta -Force -ErrorAction SilentlyContinue }
}

# Verify the signature chains to a trusted root. This is informational: a real CA
# (OV/EV) cert chains and passes; a SELF-SIGNED dev cert does NOT (its root isn't
# trusted), which is expected — so a failed verify is a WARNING, not a build error.
# The `sign` step above is authoritative and already failed the build on real error.
& $signtool verify /pa /v $File
if ($LASTEXITCODE -ne 0) {
  Write-Warning "[sign-windows] verify did not chain to a trusted root for '$File'. Expected with a self-signed dev cert; a CA-issued cert will pass. Signing itself succeeded."
} else {
  Write-Host "[sign-windows] OK: signed + verified '$File'"
}
exit 0
