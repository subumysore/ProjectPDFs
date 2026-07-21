# Dev loop: launch a DEDICATED Chrome that auto-loads the extension straight from
# apps\extension (always the latest source - no zip, no website, no manual "Load
# unpacked"). Uses its OWN persistent profile so it doesn't disturb your main Chrome,
# and the vault you set up here survives across launches. Opens the remote-debugging
# port so `deploy\dev-reload.mjs` can hot-reload the extension after every change.
#
# Usage:  .\deploy\dev-launch-chrome.ps1                 # opens a blank tab
#         .\deploy\dev-launch-chrome.ps1 -Url <pdf-url>  # optionally open a PDF to test against
#
# Chrome has no CLI to install an extension into an ALREADY-RUNNING browser, so this
# starts its own instance. Your normal Chrome (bookmarks, tabs) is untouched.
#
# NOTE: nothing is auto-opened by default. Pass -Url only if you want a page loaded on
# launch. The extension itself never contacts any external site (privacy invariant).
param([string]$Url = "")

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ext  = Join-Path $root "apps\extension"
$profileDir = Join-Path $env:LOCALAPPDATA "ppf-dev-chrome"   # persistent dev profile
$port = 9222

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw "chrome.exe not found in the usual locations." }

# Already running on the debug port? Then it's live - just reuse it.
$busy = $false
try { $busy = [bool](Test-NetConnection -ComputerName 127.0.0.1 -Port $port -WarningAction SilentlyContinue -InformationLevel Quiet) } catch {}
if ($busy) {
  Write-Host "Dev Chrome already running on :$port - use .\deploy\dev-reload.mjs to hot-reload." -ForegroundColor Yellow
  return
}

if (-not (Test-Path $profileDir)) { New-Item -ItemType Directory -Force -Path $profileDir | Out-Null }

# CRITICAL: both paths sit under a user folder with a SPACE ("Subramanya Mysore").
# Chrome splits --user-data-dir=/--load-extension= at the space and silently ignores
# them (it then merges into the default profile with NO extension). Pass 8.3 SHORT
# paths (no spaces) so Chrome parses each flag as one argument.
$fso = New-Object -ComObject Scripting.FileSystemObject
$extShort  = $fso.GetFolder($ext).ShortPath
$profShort = $fso.GetFolder($profileDir).ShortPath

$chromeArgs = @(
  "--user-data-dir=$profShort",
  "--load-extension=$extShort",
  "--remote-debugging-port=$port",
  "--no-first-run",
  "--no-default-browser-check",
  "--test-type"                        # suppresses the "unsupported flag" warning bubble
)
if ($Url) { $chromeArgs += $Url }      # only open a page if the caller explicitly asked for one
Write-Host "Launching dev Chrome with the extension loaded from:" -ForegroundColor Cyan
Write-Host "  $ext" -ForegroundColor Cyan
Start-Process -FilePath $chrome -ArgumentList $chromeArgs
Write-Host "Done. This dev profile is separate from your main Chrome; set up the vault once here." -ForegroundColor Green
Write-Host "After any code change, run:  node deploy\dev-reload.mjs   (hot-reloads - no manual steps)" -ForegroundColor Green
