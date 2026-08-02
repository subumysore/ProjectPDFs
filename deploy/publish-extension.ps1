# One command: rebuild the browser-extension .zip from apps/extension and publish it
# to https://polyglotformfill.com/download/ (rebuilds the site tarball, uploads to
# Object Storage, restarts the OKE pods).
#
# Usage (PowerShell):  .\deploy\publish-extension.ps1
#                      .\deploy\publish-extension.ps1 -NoPublish   # rebuild the zip ONLY
#
# -NoPublish rebuilds docs\marketing\site\download\polyglotformfill-extension.zip and stops,
# touching nothing outward-facing. Use it when staging a release locally (e.g. regenerating
# release-manifest.json) so the live site is only ever updated by an explicit publish.
#
# No manual zipping. Edit files under apps\extension, run this, done.
[CmdletBinding()]
param([switch] $NoPublish)

$ErrorActionPreference = "Stop"
$root  = Resolve-Path (Join-Path $PSScriptRoot "..")
$ext   = Join-Path $root "apps\extension"
$dl    = Join-Path $root "docs\marketing\site\download"
$stage = Join-Path $env:TEMP "ppf-ext-stage"

Write-Host "1/4  Assembling the extension zip..." -ForegroundColor Cyan

# ONE assembler, not two. build-extension-zip.ps1 is the single source of truth for what goes
# into the package: it strips the dev key (the store rejects a package whose key differs from the
# item's own) and excludes tests. This script used to keep its own copy of the file list, and it
# had drifted - the published zip still carried the dev key, so an upload would have been
# rejected the moment store publishing was switched on.
if (-not (Test-Path $dl)) { New-Item -ItemType Directory -Force -Path $dl | Out-Null }
$zip = Join-Path $dl "polyglotformfill-extension.zip"
& (Join-Path $PSScriptRoot "build-extension-zip.ps1") -OutFile $zip

if ($NoPublish) {
  Write-Host "2/3  -NoPublish: skipping the site publish. Zip rebuilt locally only." -ForegroundColor Yellow
  Write-Host "     Remember to regenerate the release manifest before publishing:" -ForegroundColor Cyan
  Write-Host "       node scripts/release-manifest.mjs generate --dir docs/marketing/site/download --version <ver>" -ForegroundColor Cyan
  return
}

Write-Host "2/4  Publishing the site (tar -> Object Storage -> restart pods)..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "k8s\publish-site.ps1")

# Every deploy that rebuilds the extension also SUBMITS it to the Chrome Web Store - but only
# when the store credentials are configured. Without them the step prints what is missing and
# returns 0, so a publish never fails on a machine that has no credentials.
Write-Host "3/4  Chrome Web Store..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "publish-webstore.ps1")

Write-Host "4/4  Done. Public download: https://polyglotformfill.com/download/polyglotformfill-extension.zip" -ForegroundColor Green
Write-Host ""
Write-Host "NOTE: this publishes the DOWNLOADABLE zip to the website. It does NOT load the" -ForegroundColor Yellow
Write-Host "      extension into your Chrome (Chrome has no CLI for that)." -ForegroundColor Yellow
Write-Host "For LOCAL testing you don't need the zip at all:" -ForegroundColor Cyan
Write-Host ("  1. chrome://extensions -> Load unpacked -> {0}" -f $ext) -ForegroundColor Cyan
Write-Host "  2. After each change, just click Reload on the card (same ID -> vault survives)." -ForegroundColor Cyan
