# Clean-launch the desktop app in dev. ALWAYS cleans up the PREVIOUS session first — the recurring
# "Port 5173 is already in use" / stale app.exe failures came from a prior run that didn't fully die.
# Usage:  pwsh scripts/dev-app.ps1            (also: `make dev-app`)
#         pwsh scripts/dev-app.ps1 -NoCdp     (without the WebView2 debug port)
[CmdletBinding()]
param([switch] $NoCdp)
$ErrorActionPreference = 'SilentlyContinue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')

function Stop-OnPort([int]$port) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p) { Write-Host "  · freeing :$port ($($p.ProcessName) PID $($p.Id))"; Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
}

Write-Host '[dev-app] cleaning up any previous session…' -ForegroundColor Cyan
# 1. Stop stray desktop instances (a crashed/killed run can leave app.exe holding files + the CDP port).
$apps = Get-Process app -ErrorAction SilentlyContinue
if ($apps) { Write-Host "  · stopping $($apps.Count) stray app.exe"; $apps | Stop-Process -Force -ErrorAction SilentlyContinue }
# 2. Free the vite dev port and the WebView2 debug port (leftover node/vite / webview).
Stop-OnPort 5173
Stop-OnPort 9222
# 3. Clear a stale unlock sentinel so the extension bridge doesn't trust a dead session (the app also
#    does this on startup, but clearing here covers the window before it boots).
$flag = Join-Path $env:APPDATA 'com.projectpdfs.app\app-session.flag'
if (Test-Path $flag) { Remove-Item $flag -Force -ErrorAction SilentlyContinue; Write-Host '  · cleared stale app-session.flag' }
Start-Sleep -Milliseconds 800

Write-Host '[dev-app] launching…' -ForegroundColor Green
if (-not $NoCdp) { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222' }
Set-Location (Join-Path $root 'apps\app')
pnpm tauri dev
