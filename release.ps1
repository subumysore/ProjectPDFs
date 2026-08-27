<#
.SYNOPSIS
  One-shot release orchestrator for PolyglotFormFill: bumps the version, builds and
  signs the desktop installer, packages the extension, syncs winget + release
  manifests, runs the full test suite, and (optionally) publishes everything.

.USAGE
  ===== WITH a version bump (the normal case — most releases bump the version) =====

  # Safe dry run: bumps version (default: patch), builds + signs + tests, but does
  # NOT touch the live site or the Chrome Web Store. Run this first, every time.
  .\release.ps1 -Bump patch

  # Minor / major bump instead of patch.
  .\release.ps1 -Bump minor
  .\release.ps1 -Bump major

  # Same as above, but actually publish at the end (site + installer + extension
  # submission) once the dry run above looks good.
  .\release.ps1 -Bump patch -Publish

  # Skip the confirmation prompt before the real publish step (e.g. for CI).
  .\release.ps1 -Bump patch -Publish -Yes

  ===== WITHOUT a version bump (rebuild/re-sign/re-publish the SAME version) =====
  # Use -NoBump when you just fixed a build/signing problem and want to redo the
  # release for the version that's already set in package.json, without bumping
  # again (e.g. the exact situation we hit earlier: version was already 1.0.18,
  # we just needed to rebuild it correctly after fixing the signing setup).

  # Safe dry run at the current version — build + sign + test, nothing published.
  .\release.ps1 -NoBump

  # Same, then actually publish the current version once you're happy with it.
  .\release.ps1 -NoBump -Publish

  # Same, skipping the confirmation prompt.
  .\release.ps1 -NoBump -Publish -Yes

.NOTES
  Run from anywhere inside the repo; the script locates the repo root itself.
  Requires the same env vars as sign-windows.ps1 (TRUSTED_SIGNING_ENDPOINT/
  ACCOUNT/PROFILE, optionally TRUSTED_SIGNING_DLIB) and, for -Publish, the
  WEBSTORE_* vars and a working `oci`/`kubectl` setup for publish-site.ps1.
#>
[CmdletBinding()]
param(
  [ValidateSet('patch', 'minor', 'major')]
  [string] $Bump = 'patch',

  # Skip the version bump entirely and release whatever version is currently in
  # package.json. Use this to rebuild/re-sign/re-publish the SAME version — e.g.
  # after fixing a signing or build problem, without bumping again.
  [switch] $NoBump,

  # Actually push to the live site + Chrome Web Store. Without this, the script
  # builds, signs, syncs, and tests everything, then stops before anything public
  # changes — safe to run repeatedly.
  [switch] $Publish,

  # Skip the "are you sure" prompt before the real publish step.
  [switch] $Yes,

  # Continue even if the desktop build is unsigned (NOT recommended for a real
  # release — only useful for testing this script itself).
  [switch] $AllowUnsigned,

  # Skip node scripts/test-all.mjs. NOT recommended.
  [switch] $SkipTests
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Assert-ExitCode($what) {
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)." }
}

# ---------------------------------------------------------------------------
# 0. Locate repo root and move there, regardless of where the script was run from.
# ---------------------------------------------------------------------------
$root = git rev-parse --show-toplevel 2>$null
if (-not $root) { throw "Not inside a git repo. Run this from within ProjectPDFs." }
Set-Location $root
Write-Step "Repo root: $root"

# ---------------------------------------------------------------------------
# 1. Verify signing credentials BEFORE doing any work, not after a 2-minute build.
# ---------------------------------------------------------------------------
Write-Step "Checking Trusted Signing credentials"
$tsOk = $env:TRUSTED_SIGNING_ENDPOINT -and $env:TRUSTED_SIGNING_ACCOUNT -and $env:TRUSTED_SIGNING_PROFILE
if (-not $tsOk -and -not $AllowUnsigned) {
  throw "TRUSTED_SIGNING_ENDPOINT / _ACCOUNT / _PROFILE are not all set. " +
        "Set them (see sign-windows.ps1 header) or pass -AllowUnsigned to proceed unsigned."
}
if ($tsOk) {
  Write-Ok "account '$env:TRUSTED_SIGNING_ACCOUNT', profile '$env:TRUSTED_SIGNING_PROFILE'"
} else {
  Write-Warning "Proceeding UNSIGNED (-AllowUnsigned). Do not publish this build."
}

# ---------------------------------------------------------------------------
# 2. Bump version (touches package.json, extension manifest, tauri.conf.json, Cargo.toml)
#    — unless -NoBump was passed, in which case we just read the current version
#    and rebuild/re-sign/re-publish that same version.
# ---------------------------------------------------------------------------
if ($NoBump) {
  Write-Step "Skipping version bump (-NoBump)"
  $version = (Get-Content apps/app/package.json -Raw | ConvertFrom-Json).version
  Write-Ok "using existing version $version"
} else {
  Write-Step "Bumping version ($Bump)"
  node scripts/set-version.mjs $Bump
  Assert-ExitCode "set-version.mjs"
  $version = (Get-Content apps/app/package.json -Raw | ConvertFrom-Json).version
  Write-Ok "version is now $version"
}

# ---------------------------------------------------------------------------
# 3. Build + sign the desktop app.
# ---------------------------------------------------------------------------
Write-Step "Building desktop app (pnpm exec tauri build)"
Push-Location apps/app
try {
  pnpm exec tauri build
  Assert-ExitCode "tauri build"
} finally {
  Pop-Location
}

# Find the NSIS installer by searching, not by assuming a path — Tauri's output
# location depends on workspace layout and has bitten this exact script before.
$installer = Get-ChildItem -Path "$root\target\release\bundle\nsis" -Filter "*_${version}_x64-setup.exe" -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $installer) { throw "Could not find the built NSIS installer for version $version under target\release\bundle\nsis." }
Write-Ok "installer: $($installer.FullName)"

# ---------------------------------------------------------------------------
# 4. Build the extension zip (local only — publish-extension.ps1 -NoPublish).
# ---------------------------------------------------------------------------
Write-Step "Building extension package"
.\deploy\publish-extension.ps1 -NoPublish
Assert-ExitCode "publish-extension.ps1 -NoPublish"

# ---------------------------------------------------------------------------
# 5. Stage the installer where the site + release manifest expect it.
# ---------------------------------------------------------------------------
Write-Step "Staging installer for release"
$downloadDir = Join-Path $root "docs\marketing\site\download"
Copy-Item $installer.FullName (Join-Path $downloadDir "PolyglotFormFill-Setup.exe") -Force
Write-Ok "copied to $downloadDir\PolyglotFormFill-Setup.exe"

# ---------------------------------------------------------------------------
# 6. Regenerate the release manifest (hashes of the REAL artifacts we just built).
# ---------------------------------------------------------------------------
Write-Step "Regenerating release manifest"
node scripts/release-manifest.mjs generate --dir docs/marketing/site/download --version $version
Assert-ExitCode "release-manifest.mjs"
$manifest = Get-Content (Join-Path $downloadDir "release-manifest.json") -Raw | ConvertFrom-Json
$exeHash = ($manifest.artifacts | Where-Object { $_.name -eq "PolyglotFormFill-Setup.exe" }).sha256.ToUpper()
Write-Ok "installer SHA-256: $exeHash"

# ---------------------------------------------------------------------------
# 7. Sync the three winget manifests automatically (this was previously manual
#    and caused test failures from version/hash drift — now scripted).
# ---------------------------------------------------------------------------
Write-Step "Syncing winget manifests"
$wingetDir = Join-Path $root "deploy\winget"
$today = Get-Date -Format "yyyy-MM-dd"
foreach ($f in @(
  "SubramanyaMysore.PolyglotFormFill.yaml",
  "SubramanyaMysore.PolyglotFormFill.locale.en-US.yaml",
  "SubramanyaMysore.PolyglotFormFill.installer.yaml"
)) {
  $path = Join-Path $wingetDir $f
  $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  $text = $text -replace '(?m)^PackageVersion:\s*\S+', "PackageVersion: $version"
  if ($f -like "*installer.yaml") {
    $text = $text -replace '(?m)^ReleaseDate:\s*\S+', "ReleaseDate: $today"
    $text = $text -replace '(?m)^(\s*InstallerSha256:\s*)\S+', "`${1}$exeHash"
  }
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Ok "synced $f"
}

# ---------------------------------------------------------------------------
# 8. Full test suite — fail the whole release if anything is red.
# ---------------------------------------------------------------------------
if (-not $SkipTests) {
  Write-Step "Running full test suite"
  node scripts/test-all.mjs
  Assert-ExitCode "test-all.mjs — release aborted, fix failures and re-run"
  Write-Ok "all tests passed"
} else {
  Write-Warning "Skipping tests (-SkipTests). Do not publish this build."
}

# ---------------------------------------------------------------------------
# 9. Stop here unless -Publish was passed. Everything above is safe to re-run.
# ---------------------------------------------------------------------------
if (-not $Publish) {
  Write-Host "`nBuild, sign, and test complete for v$version. Nothing was published." -ForegroundColor Yellow
  Write-Host "Re-run with -Publish to push the site, installer, and extension live." -ForegroundColor Yellow
  exit 0
}

# ---------------------------------------------------------------------------
# 10. Pre-flight the Chrome Web Store before touching anything public.
# ---------------------------------------------------------------------------
Write-Step "Checking Chrome Web Store status"
$webstoreCheck = .\deploy\publish-webstore.ps1 -Check 2>&1 | Tee-Object -Variable checkOutput
Assert-ExitCode "publish-webstore.ps1 -Check"
if ($checkOutput -match 'PENDING') {
  throw "A previous extension version is still pending review. Wait for it to clear before publishing v$version."
}
Write-Ok "Chrome Web Store credentials valid, no pending submission blocking this release"

# ---------------------------------------------------------------------------
# 11. Confirm, then publish for real.
# ---------------------------------------------------------------------------
if (-not $Yes) {
  $confirm = Read-Host "`nAbout to publish v$version live (site + installer + extension submission). Type 'yes' to continue"
  if ($confirm -ne 'yes') { Write-Host "Aborted by user." -ForegroundColor Yellow; exit 1 }
}

Write-Step "Publishing site + installer + submitting extension"
.\deploy\k8s\publish-site.ps1 -WithBinaries
Assert-ExitCode "publish-site.ps1 -WithBinaries"

Write-Step "Submitting extension to Chrome Web Store"
.\deploy\publish-webstore.ps1
Assert-ExitCode "publish-webstore.ps1"

Write-Host "`nRelease v$version complete:" -ForegroundColor Green
Write-Host "  EXE: https://polyglotformfill.com/download/PolyglotFormFill-Setup.exe"
Write-Host "  EXT: submitted — check chrome.google.com/webstore/devconsole for review status"
