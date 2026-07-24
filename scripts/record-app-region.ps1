# Record ONLY the PolyglotFormFill app window's screen region - never the whole desktop.
#
#   powershell scripts/record-app-region.ps1 -Seconds 14 -Out clip.mp4
#
# WHY REGION, NOT WINDOW-TITLE. ffmpeg's gdigrab "title=" capture proved unreliable here - it once
# grabbed a Chrome window instead of the app, which is how real data nearly leaked. Capturing the
# app's exact client rectangle (GetClientRect + ClientToScreen) records only what the app draws, so
# a browser, tabs, notifications and any personal context are never in frame. Combined with an EMPTY
# vault / synthetic demo profile, nothing real can be recorded.
#
# Requires: ffmpeg (or set $env:FFMPEG). The app must be running and maximised.
param(
    [int] $Seconds = 10,
    [Parameter(Mandatory = $true)] [string] $Out,
    [int] $Fps = 20,
    # Client pixels to crop off the TOP of the capture. The app shows a "Saved to your Desktop:
    # C:\Users\<name>\..." banner in its header, so cropping the header keeps the owner's Windows
    # username out of every frame (and focuses on the working content). 0 = full window.
    [int] $TopCrop = 0
)
$ErrorActionPreference = "Stop"

Add-Type @"
using System;using System.Runtime.InteropServices;
public class Rec{
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref POINT p);
 public struct RECT{public int l,t,r,b;}
 public struct POINT{public int x,y;}
}
"@
[Rec]::SetProcessDPIAware() | Out-Null

$p = Get-Process -Name app -ErrorAction SilentlyContinue | Where-Object MainWindowTitle -eq 'PolyglotFormFill' | Select-Object -First 1
if (-not $p) { throw "The app is not running. Launch it (maximised) first." }
[Rec]::ShowWindow($p.MainWindowHandle, 3) | Out-Null   # maximise
[Rec]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 800

$rc = New-Object Rec+RECT
[Rec]::GetClientRect($p.MainWindowHandle, [ref]$rc) | Out-Null
$tl = New-Object Rec+POINT; $tl.x = 0; $tl.y = 0
[Rec]::ClientToScreen($p.MainWindowHandle, [ref]$tl) | Out-Null
$w = $rc.r - $rc.l; $h = $rc.b - $rc.t
if ($TopCrop -gt 0) { $tl.y = $tl.y + $TopCrop; $h = $h - $TopCrop }   # crop the header (name banner) off the top
if ($w % 2) { $w-- }; if ($h % 2) { $h-- }   # even dims for yuv420p

$ff = $env:FFMPEG
if (-not $ff) { $c = Get-Command ffmpeg -ErrorAction SilentlyContinue; if ($c) { $ff = $c.Source } }
if (-not $ff) {
    $g = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\*ffmpeg*\*\bin\ffmpeg.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($g) { $ff = $g.FullName }
}
if (-not $ff) { throw "ffmpeg not found. Install it or set `$env:FFMPEG." }

Write-Host ("Recording app region {0}x{1} at ({2},{3}) for {4}s -> {5}" -f $w, $h, $tl.x, $tl.y, $Seconds, $Out)
# ffmpeg writes its banner to stderr; under ErrorActionPreference=Stop PowerShell treats that as a
# terminating error even on success. Relax it around the call and gate on the exit code instead.
$ErrorActionPreference = "Continue"
& $ff -y -f gdigrab -framerate $Fps -offset_x $tl.x -offset_y $tl.y -video_size ("{0}x{1}" -f $w, $h) `
    -t $Seconds -i desktop -c:v libx264 -preset veryfast -pix_fmt yuv420p $Out 2>$null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Out)) { throw "ffmpeg recording failed" }
Write-Host "Done."
