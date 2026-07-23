# Submit the built extension .zip to the Chrome Web Store.
#
# Called automatically at the end of deploy\publish-extension.ps1, so every deploy that rebuilds the
# extension also submits it - but ONLY when the four credentials below are present. Without them the
# script prints what is missing and exits 0, exactly like the Windows code-signing hook: a machine
# that has no credentials must still be able to run a full publish.
#
# WHAT YOU NEED, ONCE (none of it can be automated):
#   1. A Chrome Web Store developer account - one-time USD 5 registration fee.
#   2. ONE manual upload at chrome.google.com/webstore/devconsole to create the item. The API can
#      update an existing item but cannot create one. Copy the item ID from the console URL.
#   3. An OAuth client (type "Desktop app") in a Google Cloud project with the Chrome Web Store API
#      enabled, and a refresh token for it. docs\reference\chrome-web-store.md has the exact steps.
#
# Then set these four environment variables (they are secrets - never commit them):
#   WEBSTORE_ITEM_ID         the 32-character item id from the developer console
#   WEBSTORE_CLIENT_ID       OAuth client id
#   WEBSTORE_CLIENT_SECRET   OAuth client secret
#   WEBSTORE_REFRESH_TOKEN   OAuth refresh token
#
# TWO THINGS TO EXPECT:
#   - Uploads go into REVIEW. "Updated on every deploy" means SUBMITTED on every deploy; going live
#     takes hours to a few days and is Google's decision, not ours.
#   - The store rejects an upload whose version equals the published one. Versions are frozen at
#     1.0.0 right now, so use -BumpPatch when you actually want a new store submission.
#
# PRIVACY: this uploads OUR OWN build artifact to Google. No user content is involved - the zip is
# the same public package served from the download page.
#
# NOTE: keep this file pure ASCII (PowerShell 5.1 reads .ps1 as ANSI; guarded by
# scripts\ps1-ascii.test.mjs).
[CmdletBinding()]
param(
    # Upload only; leave the item as a draft instead of submitting it for review.
    [switch] $DraftOnly,
    # Increment the patch number in apps\extension\manifest.json first. The store refuses an upload
    # that reuses a published version, so a resubmission needs this (or a manual bump).
    [switch] $BumpPatch,
    # Print what would happen and exit, without contacting Google.
    [switch] $DryRun,
    # Verify the credentials really work: get a token and READ the item. Uploads nothing, publishes
    # nothing, changes nothing. Run this once after setting the four variables.
    [switch] $Check
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$zip = Join-Path $root "docs\marketing\site\download\polyglotformfill-extension.zip"
$manifestPath = Join-Path $root "apps\extension\manifest.json"

Write-Host "Chrome Web Store: preparing submission..." -ForegroundColor Cyan

# --- credentials: absent is NOT an error, it is the normal state on a fresh machine -------------
$itemId = $env:WEBSTORE_ITEM_ID
$clientId = $env:WEBSTORE_CLIENT_ID
$clientSecret = $env:WEBSTORE_CLIENT_SECRET
$refreshToken = $env:WEBSTORE_REFRESH_TOKEN

$missing = @()
if (-not $itemId) { $missing += "WEBSTORE_ITEM_ID" }
if (-not $clientId) { $missing += "WEBSTORE_CLIENT_ID" }
if (-not $clientSecret) { $missing += "WEBSTORE_CLIENT_SECRET" }
if (-not $refreshToken) { $missing += "WEBSTORE_REFRESH_TOKEN" }

if ($missing.Count -gt 0) {
    Write-Host "     Skipping the Chrome Web Store step - not configured yet." -ForegroundColor Yellow
    Write-Host ("     Missing: " + ($missing -join ", ")) -ForegroundColor Yellow
    Write-Host "     See docs\reference\chrome-web-store.md for the one-time setup." -ForegroundColor Yellow
    exit 0
}

if (-not $Check -and -not (Test-Path $zip)) {
    throw "Extension zip not found at $zip. Run deploy\publish-extension.ps1 first."
}

# --- -Check: prove the four values actually work, before trusting them in a real release ---------
# Reads the item and stops. Uploads nothing, publishes nothing, changes nothing.
if ($Check) {
    Write-Host "     Credentials found. Verifying them against the store..." -ForegroundColor Cyan
    $tb = @{ client_id = $clientId; client_secret = $clientSecret; refresh_token = $refreshToken; grant_type = "refresh_token" }
    try {
        $tok = (Invoke-RestMethod -Method Post -Uri "https://oauth2.googleapis.com/token" -Body $tb).access_token
    } catch {
        throw "The refresh token was rejected. It may have been revoked, or the client id/secret do not match it. Re-run: node scripts/webstore-auth.mjs <CLIENT_ID> <CLIENT_SECRET>"
    }
    if (-not $tok) { throw "No access token came back - check the OAuth client." }
    Write-Host "     Access token: OK" -ForegroundColor Green

    $h = @{ Authorization = "Bearer $tok"; "x-goog-api-version" = "2" }
    try {
        $item = Invoke-RestMethod -Method Get -Headers $h -Uri "https://www.googleapis.com/chromewebstore/v1.1/items/$itemId`?projection=DRAFT"
    } catch {
        throw "Could not read item $itemId. Either the id is wrong, or this Google account does not own that item."
    }
    Write-Host "     Item $($item.id): reachable, upload state $($item.uploadState)" -ForegroundColor Green
    Write-Host "     Credentials are good - releases will submit automatically from now on." -ForegroundColor Green
    exit 0
}

# --- version ------------------------------------------------------------------------------------
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version

if ($BumpPatch) {
    $parts = $version.Split(".")
    while ($parts.Count -lt 3) { $parts += "0" }
    $parts[$parts.Count - 1] = [string]([int]$parts[$parts.Count - 1] + 1)
    $version = ($parts -join ".")
    # Rewrite the version in place, preserving the file's formatting (a full ConvertTo-Json
    # round-trip would reorder and reindent the whole manifest).
    $raw = Get-Content $manifestPath -Raw
    $raw = [regex]::Replace($raw, '("version"\s*:\s*")[^"]+(")', ('${1}' + $version + '${2}'), 1)
    Set-Content -LiteralPath $manifestPath -Value $raw -Encoding utf8 -NoNewline
    Write-Host "     Version bumped to $version - REBUILD the zip before uploading." -ForegroundColor Yellow
    Write-Host "     Run: .\deploy\publish-extension.ps1 -NoPublish" -ForegroundColor Yellow
    exit 0
}

$sizeMb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "     Item $itemId, version $version, package $sizeMb MB"

if ($DryRun) {
    Write-Host "     -DryRun: nothing was sent to Google." -ForegroundColor Yellow
    exit 0
}

# --- 1. exchange the refresh token for a short-lived access token --------------------------------
Write-Host "     Getting an access token..."
$tokenBody = @{
    client_id     = $clientId
    client_secret = $clientSecret
    refresh_token = $refreshToken
    grant_type    = "refresh_token"
}
$token = (Invoke-RestMethod -Method Post -Uri "https://oauth2.googleapis.com/token" -Body $tokenBody).access_token
if (-not $token) { throw "Could not obtain an access token - check the OAuth credentials." }

$headers = @{
    Authorization    = "Bearer $token"
    "x-goog-api-version" = "2"
}

# --- 2. upload the package -----------------------------------------------------------------------
Write-Host "     Uploading the package..."
$uploadUri = "https://www.googleapis.com/upload/chromewebstore/v1.1/items/$itemId"
$upload = Invoke-RestMethod -Method Put -Uri $uploadUri -Headers $headers -InFile $zip -ContentType "application/zip"

if ($upload.uploadState -eq "FAILURE") {
    $detail = ($upload.itemError | ForEach-Object { $_.error_detail }) -join "; "
    if ($detail -match "version") {
        throw "Upload rejected: $detail`nThe store will not accept a version it has already published. Run this script with -BumpPatch, rebuild the zip, then publish again."
    }
    throw "Upload failed: $detail"
}
Write-Host "     Upload state: $($upload.uploadState)" -ForegroundColor Green

if ($DraftOnly) {
    Write-Host "     -DraftOnly: uploaded as a draft, not submitted for review." -ForegroundColor Yellow
    exit 0
}

# --- 3. submit for review ------------------------------------------------------------------------
Write-Host "     Submitting for review..."
$publishUri = "https://www.googleapis.com/chromewebstore/v1.1/items/$itemId/publish"
# -ContentLength does not exist on Invoke-RestMethod in PowerShell 5.1 (it was added in 7.x), and
# passing it fails AFTER the upload has already succeeded - the confusing case where the package is
# sitting in the store as a draft but nothing was submitted. An empty body sends Content-Length: 0.
$publish = Invoke-RestMethod -Method Post -Uri $publishUri -Headers $headers -Body ""

$status = ($publish.status -join ", ")
Write-Host "     Status: $status" -ForegroundColor Green
if ($publish.statusDetail) { Write-Host ("     " + ($publish.statusDetail -join " ")) }
Write-Host "     Submitted. Google reviews it before it reaches users - usually hours, sometimes days." -ForegroundColor Cyan
