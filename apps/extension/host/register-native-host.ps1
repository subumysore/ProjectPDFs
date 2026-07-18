# Register the ProjectPDFs native-messaging host for Chrome/Edge (Windows, per-user).
# Fills the manifest template with the host EXE path + your extension id, writes it to
# LOCALAPPDATA, and points the browser's NativeMessagingHosts registry key at it.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File register-native-host.ps1 `
#     -ExtensionId <id from chrome://extensions> `
#     [-HostExe <path to projectpdfs-host.exe>] [-Browser chrome|edge]
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $ExtensionId,
  [string] $HostExe = "",
  [ValidateSet("chrome", "edge")] [string] $Browser = "chrome"
)
$ErrorActionPreference = "Stop"

if (-not $HostExe) {
  # Default to the release build in this repo.
  $repo = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
  $HostExe = Join-Path $repo "target\release\projectpdfs-host.exe"
}
if (-not (Test-Path $HostExe)) {
  throw "Host exe not found at '$HostExe'. Build it first: cargo build -p native-host --release"
}

$template = Get-Content (Join-Path $PSScriptRoot "com.projectpdfs.host.template.json") -Raw
$json = $template.Replace("__HOST_EXE__", ($HostExe -replace '\\', '\\')).Replace("__EXTENSION_ID__", $ExtensionId)

$destDir = Join-Path $env:LOCALAPPDATA "ProjectPDFs"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$manifestPath = Join-Path $destDir "com.projectpdfs.host.json"
Set-Content -Path $manifestPath -Value $json -Encoding utf8

$root = if ($Browser -eq "edge") { "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts" }
        else { "HKCU:\Software\Google\Chrome\NativeMessagingHosts" }
New-Item -Path $root -Force | Out-Null
New-ItemProperty -Path (Join-Path $root "com.projectpdfs.host") -Name "(Default)" -Value $manifestPath -PropertyType String -Force | Out-Null

Write-Host "Registered com.projectpdfs.host for $Browser"
Write-Host "  host exe : $HostExe"
Write-Host "  manifest : $manifestPath"
Write-Host "  extension: $ExtensionId"
Write-Host "Reload the extension, then use 'Fill from native app' in the popup."
