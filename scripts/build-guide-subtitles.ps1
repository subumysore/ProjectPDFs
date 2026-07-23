# Build a correctly timed subtitle file for the guide video.
#
#   .\scripts\build-guide-subtitles.ps1
#   -> docs\guide\guide.en.srt        (upload this to YouTube, or ship it beside the video)
#
# Subtitles are not optional politeness here. The narration is a synthetic English voice, and a
# large share of the people this product exists for do not have English as a first language - they
# will read the words far more comfortably than they will hear them. YouTube also uses the uploaded
# track to power its own auto-translation, so one accurate English file gives every other language
# a usable starting point.
#
# HOW THE TIMING IS DERIVED. The video is slides concatenated in order, each lasting exactly as long
# as its narration. So: re-synthesize each segment with the same voice and rate, measure the wav,
# and the segment boundaries are known exactly. Within a segment, sentences get time in proportion
# to their length, which is close enough for reading and never drifts across segments because every
# boundary is re-anchored to the measured total.
#
# The narration comes from docs\guide\narration.json - the same file build-guide-video.ps1 reads, so
# subtitles and video cannot describe different things.
#
# Requires: ffprobe (comes with ffmpeg) and Windows SAPI (built in).
# NOTE: keep this file pure ASCII (PowerShell 5.1 reads .ps1 as ANSI; see scripts\ps1-ascii.test.mjs).
[CmdletBinding()]
param(
    # Compare the computed total against the real video and warn if they disagree.
    [string] $VerifyAgainst = "docs\marketing\site\app-assets\guide.mp4"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$narrationPath = Join-Path $root "docs\guide\narration.json"
$outPath = Join-Path $root "docs\guide\guide.en.srt"
$work = Join-Path $env:TEMP "ppf-subs"

if (-not (Test-Path $narrationPath)) { throw "Missing $narrationPath" }
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Force -Path $work | Out-Null

# ffprobe: PATH, $env:FFPROBE, or the winget install location.
$fp = $env:FFPROBE
if (-not $fp) { $c = Get-Command ffprobe -ErrorAction SilentlyContinue; if ($c) { $fp = $c.Source } }
if (-not $fp) {
    $g = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\*ffmpeg*\*\bin\ffprobe.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($g) { $fp = $g.FullName }
}
if (-not $fp) { throw "ffprobe not found. Install ffmpeg (winget install Gyan.FFmpeg) or set `$env:FFPROBE." }

$narration = Get-Content $narrationPath -Raw | ConvertFrom-Json

# Written by build-guide-video.ps1: the real encoded length of every segment.
$timingsPath = Join-Path $root "docs\guide\timings.json"
$timings = $null
if (Test-Path $timingsPath) {
    $timings = Get-Content $timingsPath -Raw | ConvertFrom-Json
    Write-Host "     using measured clip timings from timings.json" -ForegroundColor DarkGray
}

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $synth.SelectVoice($narration.voice) } catch { Write-Host "     voice '$($narration.voice)' unavailable; using the default" -ForegroundColor Yellow }
$synth.Rate = 0; $synth.Volume = 100

function Format-SrtTime([double] $seconds) {
    $ts = [TimeSpan]::FromSeconds($seconds)
    "{0:00}:{1:00}:{2:00},{3:000}" -f $ts.Hours, $ts.Minutes, $ts.Seconds, $ts.Milliseconds
}

# Split narration into caption-sized cues: sentence by sentence, and long sentences at a comma, so
# no cue is a wall of text on a phone screen.
function Split-Cues([string] $text) {
    $parts = [regex]::Split($text, '(?<=[.!?])\s+') | Where-Object { $_.Trim() }
    $cues = @()
    foreach ($p in $parts) {
        $p = $p.Trim()
        if ($p.Length -le 90) { $cues += $p; continue }
        $buf = ""
        foreach ($frag in ($p -split '(?<=,)\s+')) {
            if (($buf + " " + $frag).Trim().Length -gt 90 -and $buf) { $cues += $buf.Trim(); $buf = $frag }
            else { $buf = ($buf + " " + $frag).Trim() }
        }
        if ($buf) { $cues += $buf.Trim() }
    }
    return $cues
}

$lines = New-Object System.Collections.Generic.List[string]
$index = 1
$clock = 0.0

Write-Host "Building subtitles from $($narration.segments.Count) segments..." -ForegroundColor Cyan

for ($i = 0; $i -lt $narration.segments.Count; $i++) {
    $seg = $narration.segments[$i]

    # Prefer the durations the VIDEO BUILD measured from its encoded clips. Re-synthesizing the
    # narration and measuring the wav looks equivalent and is not: the encoded clip runs about nine
    # percent longer (AAC priming plus whole-frame padding on a still image), which put the whole
    # subtitle track seventeen seconds out by the end. Falling back to the wav only when the
    # sidecar is absent keeps this usable before the first video build.
    $dur = $null
    if ($timings) {
        $match = $timings.segments | Where-Object { $_.img -eq $seg.img } | Select-Object -First 1
        if ($match) { $dur = [double]$match.seconds }
    }
    if (-not $dur) {
        $wav = Join-Path $work ("seg{0}.wav" -f $i)
        $synth.SetOutputToWaveFile($wav)
        $synth.Speak($seg.text)
        $synth.SetOutputToNull()
        $dur = [double](& $fp -v error -show_entries format=duration -of default=nk=1:nw=1 $wav)
        Write-Host "     (no measured timing for $($seg.img) - estimated from the narration)" -ForegroundColor Yellow
    }
    if (-not $dur -or $dur -le 0) { throw "could not determine a duration for $($seg.img)" }

    $cues = Split-Cues $seg.text
    $chars = ($cues | Measure-Object -Property Length -Sum).Sum
    $segStart = $clock

    for ($c = 0; $c -lt $cues.Count; $c++) {
        $share = if ($chars -gt 0) { $cues[$c].Length / $chars } else { 1 / $cues.Count }
        $cueDur = $dur * $share
        $start = $clock
        # The last cue of a segment ends exactly on the measured boundary, so rounding never
        # accumulates across the video.
        $end = if ($c -eq $cues.Count - 1) { $segStart + $dur } else { $clock + $cueDur }

        $lines.Add([string]$index)
        $lines.Add("$(Format-SrtTime $start) --> $(Format-SrtTime $end)")
        $lines.Add($cues[$c])
        $lines.Add("")
        $index++
        $clock = $end
    }

    Write-Host ("  segment {0}: {1,-20} {2,6:N1}s  {3} cue(s)" -f ($i + 1), $seg.img, $dur, $cues.Count)
}

$synth.Dispose()
[IO.File]::WriteAllLines($outPath, $lines, (New-Object Text.UTF8Encoding $false))
Write-Host ("Wrote {0}  ({1} cues, {2:N1}s)" -f $outPath, ($index - 1), $clock) -ForegroundColor Green

# Sanity: the subtitles must line up with the video that is actually published.
$videoPath = Join-Path $root $VerifyAgainst
if (Test-Path $videoPath) {
    $vd = [double](& $fp -v error -show_entries format=duration -of default=nk=1:nw=1 $videoPath)
    $drift = [math]::Abs($vd - $clock)
    Write-Host ("Video is {0:N1}s; subtitles end at {1:N1}s; drift {2:N1}s" -f $vd, $clock, $drift)
    if ($drift -gt 2.0) {
        Write-Host "     DRIFT over 2s - the video was probably built from different narration." -ForegroundColor Yellow
        Write-Host "     Rebuild it with .\scripts\build-guide-video.ps1 so both come from narration.json." -ForegroundColor Yellow
    } else {
        Write-Host "     In step with the published video." -ForegroundColor Green
    }
} else {
    Write-Host "     ($VerifyAgainst not found - skipped the drift check)" -ForegroundColor DarkGray
}
