# Publish the marketing site to the OKE-hosted polyglotformfill.mooo.com.
# One command: rebuild -> repackage -> upload to Object Storage -> restart pods
# (the init container re-downloads the fresh tarball on restart).
#
# Usage (PowerShell):  .\deploy\k8s\publish-site.ps1                  # site content only (fast)
#                      .\deploy\k8s\publish-site.ps1 -WithBinaries    # also re-upload installers
#
# INSTALLERS ARE NOT IN THE TARBALL. They are uploaded as their own Object Storage objects
# and pulled into /web/download/ by the init container (see site.yaml). Reason: the tarball
# had grown to 86 MB because it carried ~62 MB of installers, so every HTML-only publish
# re-uploaded them - ~5.5 min on a 2 Mbps upstream. Content-only publishes are now ~14 MB.
#
# NOTE: keep this file pure ASCII. PowerShell 5.1 reads .ps1 as ANSI unless it has a BOM, so a
# UTF-8 em dash becomes 3 CP1252 chars ending in 0x94 (a curly closing quote) - inside a string
# literal that terminates the string and breaks the parse. Guarded by scripts/ps1-ascii.test.mjs.
# Pass -WithBinaries only when the installers themselves changed.
#
# Prereqs (already set up on this machine): oci CLI (~/bin), kubectl (Docker Desktop),
# node, and the kubeconfig at ~/.kube/ppf-oke.yaml.
[CmdletBinding()]
param([switch] $WithBinaries)

$ErrorActionPreference = "Stop"

# --- config ---
$NS_OBJ   = "idlqdkwlstnb"            # Object Storage namespace
$BUCKET   = "polyglotformfill-dl"
$OBJECT   = "ppf-site.tar.gz"
$K8S_NS   = "polyglotformfill"
$DEPLOY   = "ppf-site"

# Served from /download/ but shipped OUTSIDE the tarball (see the note above). Keep this list
# in step with the init container's fetch list in site.yaml.
$BINARIES = @("PolyglotFormFill-Setup.exe", "polyglotformfill-extension.zip")

# --- locate repo root (this script lives in <root>/deploy/k8s) ---
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

# --- tools on PATH + kubeconfig ---
$env:PATH = "$env:USERPROFILE\bin;$env:PATH;C:\Program Files\Docker\Docker\resources\bin"
$env:KUBECONFIG = "$env:USERPROFILE\.kube\ppf-oke.yaml"

Write-Host "1/4  Building the site..." -ForegroundColor Cyan
node docs/marketing/build-site.mjs

$siteDir = Join-Path $root "docs\marketing\site"
$tgz = Join-Path $env:TEMP "ppf-site.tar.gz"

Write-Host "2/4  Packaging $siteDir -> $tgz (installers excluded) ..." -ForegroundColor Cyan
if (Test-Path $tgz) { Remove-Item -Force $tgz }
$excludes = $BINARIES | ForEach-Object { "--exclude=./download/$_" }
tar -czf $tgz -C $siteDir @excludes .
if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
Write-Host ("     Tarball {0:N1} MB" -f ((Get-Item $tgz).Length / 1MB)) -ForegroundColor Green

# Guard: a binary sneaking back into the tarball silently restores the slow-publish problem.
$leaked = (tar -tzf $tgz | Where-Object { $_ -match '\.(exe|msi)$' })
if ($leaked) { throw "installers leaked into the site tarball: $($leaked -join ', ')" }

Write-Host "3/4  Uploading to Object Storage ($BUCKET/$OBJECT)..." -ForegroundColor Cyan
# oci writes progress to stderr; in PowerShell 5.1 that becomes a NativeCommandError
# which, under $ErrorActionPreference=Stop, aborts the script even on success. Drop to
# Continue for just this native call and gate on the real exit code.
$ErrorActionPreference = "Continue"
oci os object put -ns $NS_OBJ -bn $BUCKET --name $OBJECT --file $tgz --force 2>$null | Out-Null
$uploadCode = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($uploadCode -ne 0) { throw "oci upload failed (exit $uploadCode)" }

if ($WithBinaries) {
  Write-Host "3b/4 Uploading installers as their own objects..." -ForegroundColor Cyan
  foreach ($b in $BINARIES) {
    $path = Join-Path $siteDir "download\$b"
    if (-not (Test-Path $path)) { throw "missing installer '$path' - build it before -WithBinaries." }
    Write-Host ("     {0} ({1:N1} MB)..." -f $b, ((Get-Item $path).Length / 1MB))
    $ErrorActionPreference = "Continue"
    oci os object put -ns $NS_OBJ -bn $BUCKET --name $b --file $path --force 2>$null | Out-Null
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($code -ne 0) { throw "oci upload of '$b' failed (exit $code)" }
  }
  Write-Host "     Installers uploaded. Pods will re-fetch them on restart." -ForegroundColor Green
} else {
  Write-Host "3b/4 Skipping installers (content-only publish). Use -WithBinaries when they change." -ForegroundColor Yellow
}

Write-Host "4/4  Restarting pods to pull the new content..." -ForegroundColor Cyan
kubectl -n $K8S_NS rollout restart "deploy/$DEPLOY"
kubectl -n $K8S_NS rollout status  "deploy/$DEPLOY"

Write-Host "`nPublished. https://polyglotformfill.mooo.com is now serving the latest build." -ForegroundColor Green
