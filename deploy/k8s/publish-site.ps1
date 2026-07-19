# Publish the marketing site to the OKE-hosted polyglotformfill.mooo.com.
# One command: rebuild -> repackage -> upload to Object Storage -> restart pods
# (the init container re-downloads the fresh tarball on restart).
#
# Usage (PowerShell):  .\deploy\k8s\publish-site.ps1
#
# Prereqs (already set up on this machine): oci CLI (~/bin), kubectl (Docker Desktop),
# node, and the kubeconfig at ~/.kube/ppf-oke.yaml.

$ErrorActionPreference = "Stop"

# --- config ---
$NS_OBJ   = "idlqdkwlstnb"            # Object Storage namespace
$BUCKET   = "polyglotformfill-dl"
$OBJECT   = "ppf-site.tar.gz"
$K8S_NS   = "polyglotformfill"
$DEPLOY   = "ppf-site"

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

Write-Host "2/4  Packaging $siteDir -> $tgz ..." -ForegroundColor Cyan
if (Test-Path $tgz) { Remove-Item -Force $tgz }
tar -czf $tgz -C $siteDir .

Write-Host "3/4  Uploading to Object Storage ($BUCKET/$OBJECT)..." -ForegroundColor Cyan
oci os object put -ns $NS_OBJ -bn $BUCKET --name $OBJECT --file $tgz --force

Write-Host "4/4  Restarting pods to pull the new content..." -ForegroundColor Cyan
kubectl -n $K8S_NS rollout restart "deploy/$DEPLOY"
kubectl -n $K8S_NS rollout status  "deploy/$DEPLOY"

Write-Host "`nPublished. https://polyglotformfill.mooo.com is now serving the latest build." -ForegroundColor Green
