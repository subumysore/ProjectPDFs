# Authenticode signing hook for `tauri build` (wired via bundle.windows.signCommand).
#
# Tauri calls this once per produced binary (the app .exe, the MSI, the NSIS setup),
# passing the file path as the sole argument. Signing is OPT-IN via environment:
#
#   WINDOWS_CERT_THUMBPRINT   SHA1 thumbprint of a code-signing cert in the Windows
#                             cert store (CurrentUser\My or LocalMachine\My).
#   -- OR --
#   WINDOWS_CERT_PFX          Path to a .pfx/.p12 code-signing certificate file.
#   WINDOWS_CERT_PASSWORD     Password for that .pfx (optional if none).
#
#   WINDOWS_TS_URL            RFC-3161 timestamp server (default: DigiCert).
#   SIGNTOOL                  Explicit path to signtool.exe (else auto-located).
#
# If NO cert env var is set, signing is SKIPPED and the build continues (unsigned) —
# so plain dev builds work without any secret. Secrets stay in the environment and
# never enter git. On a real signing failure the script exits non-zero so a build
# never silently produces an "unsigned artifact that looks signed".
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $File
)

$ErrorActionPreference = 'Stop'

$thumb   = $env:WINDOWS_CERT_THUMBPRINT
$pfx     = $env:WINDOWS_CERT_PFX
$pfxPass = $env:WINDOWS_CERT_PASSWORD
$tsUrl   = if ($env:WINDOWS_TS_URL) { $env:WINDOWS_TS_URL } else { 'http://timestamp.digicert.com' }

if ([string]::IsNullOrWhiteSpace($thumb) -and [string]::IsNullOrWhiteSpace($pfx)) {
  Write-Host "[sign-windows] No WINDOWS_CERT_THUMBPRINT or WINDOWS_CERT_PFX set - skipping signing (unsigned build)."
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

$signtool = Find-SignTool
Write-Host "[sign-windows] Signing '$File' with $signtool"

$sargs = @('sign', '/fd', 'SHA256', '/tr', $tsUrl, '/td', 'SHA256', '/v')
if (-not [string]::IsNullOrWhiteSpace($thumb)) {
  $sargs += @('/sha1', $thumb)
} else {
  if (-not (Test-Path $pfx)) { throw "WINDOWS_CERT_PFX '$pfx' does not exist." }
  $sargs += @('/f', $pfx)
  if (-not [string]::IsNullOrWhiteSpace($pfxPass)) { $sargs += @('/p', $pfxPass) }
}
$sargs += $File

& $signtool @sargs
if ($LASTEXITCODE -ne 0) { throw "signtool sign failed (exit $LASTEXITCODE) for '$File'." }

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
