# Build the in-app guided-tour video (apps/app/public/guide.mp4) FULLY ON-DEVICE.
# Narration is synthesized with the built-in Windows SAPI voice (no cloud TTS); slides are
# real app screenshots in docs/guide/slides/; ffmpeg muxes them into an H.264 + AAC MP4.
# This keeps the walkthrough reproducible and honors the privacy invariant (nothing leaves
# the device to make it). Re-run after the UI changes to refresh the video.
#
#   powershell -ExecutionPolicy Bypass -File scripts/build-guide-video.ps1
#
# Requires: ffmpeg on PATH (or set $env:FFMPEG). Windows SAPI (System.Speech) is built in.

# NB: ffmpeg writes its banner to stderr; under "Stop" PowerShell treats that as terminating.
# Keep "Continue" and gate on $LASTEXITCODE instead so real ffmpeg failures still surface.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
# Output to the SITE asset-host staging dir (NOT the app bundle — ADR-0019). publish-site uploads
# it to polyglotformfill.com/app-assets/guide.mp4, gated to app builds. It's *.mp4 → gitignored.
$slides = Join-Path $root "docs\guide\slides"
$work = Join-Path $env:TEMP "ppf-guide"
$assetDir = Join-Path $root "docs\marketing\site\app-assets"
$out = Join-Path $assetDir "guide.mp4"
New-Item -ItemType Directory -Force -Path $work | Out-Null
New-Item -ItemType Directory -Force -Path $assetDir | Out-Null

# ffmpeg: PATH, or $env:FFMPEG, or the winget install location.
$ff = $env:FFMPEG
if (-not $ff) { $c = Get-Command ffmpeg -ErrorAction SilentlyContinue; if ($c) { $ff = $c.Source } }
if (-not $ff) {
  $g = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\*ffmpeg*\*\bin\ffmpeg.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($g) { $ff = $g.FullName }
}
if (-not $ff) { throw "ffmpeg not found. Install it (winget install Gyan.FFmpeg) or set `$env:FFMPEG." }

# Slides and narration come from docs\guide\narration.json - the SAME file
# build-guide-subtitles.ps1 reads. They used to be a literal array in this script, which is how
# the published video ended up describing a version of the app that no longer existed while the
# subtitles described another (a 10 second drift gave it away).
$narrationPath = Join-Path $root "docs\guide\narration.json"
if (-not (Test-Path $narrationPath)) { throw "Missing $narrationPath" }
$narration = Get-Content $narrationPath -Raw | ConvertFrom-Json
$segments = $narration.segments

# Narration voice: PIPER (free, on-device neural TTS), not the robotic Windows SAPI voice. Runs
# entirely on this machine - the same on-device principle the product is built on - and sounds
# natural. Get it with: node scripts/fetch-piper.mjs
$piper = Join-Path $root "tools\piper\bin\piper.exe"
$piperModel = Join-Path $root "tools\piper\en_US-amy-medium.onnx"
if (-not (Test-Path $piper) -or -not (Test-Path $piperModel)) {
  throw "Piper not found. Run: node scripts/fetch-piper.mjs"
}

$concat = Join-Path $work "concat.txt"
Set-Content -Path $concat -Value "" -Encoding ascii
$clipDurations = @()
$scale = "scale=1280:960:force_original_aspect_ratio=decrease,pad=1280:960:(ow-iw)/2:(oh-ih)/2:white,fps=30,format=yuv420p"

for ($i = 0; $i -lt $segments.Count; $i++) {
  $wav = Join-Path $work ("seg{0}.wav" -f $i)
  # Piper reads the text on stdin and writes a wav. sentence_silence adds a natural pause between
  # sentences so the narration does not run together.
  $segments[$i].text | & $piper --model $piperModel --sentence_silence 0.35 --output_file $wav 2>$null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $wav)) { throw "piper failed on segment $i" }
  $img = Join-Path $slides $segments[$i].img
  $clip = Join-Path $work ("clip{0}.mp4" -f $i)
  & $ff -y -loop 1 -i $img -i $wav -vf $scale -c:v libx264 -preset medium -tune stillimage `
    -c:a aac -b:a 160k -shortest $clip 2>$null
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed encoding clip $i ($($segments[$i].img))" }
  Add-Content -Path $concat -Value ("file 'clip{0}.mp4'" -f $i) -Encoding ascii

  # Record the ENCODED length of this clip, not the length of the wav it came from. They differ by
  # about nine percent (AAC priming plus whole-frame padding on a still image), which quietly put
  # the subtitles seventeen seconds out of step across the video. Subtitles read these numbers.
  $probe = $ff -replace 'ffmpeg\.exe$', 'ffprobe.exe'
  $clipDur = [double](& $probe -v error -show_entries format=duration -of default=nk=1:nw=1 $clip)
  $clipDurations += $clipDur
  Write-Host ("segment {0}: {1}" -f ($i + 1), $segments[$i].img)
}

& $ff -y -f concat -safe 0 -i $concat -c copy $out 2>$null
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed concatenating clips into $out" }
# Sidecar of real per-segment durations so build-guide-subtitles.ps1 can time cues against what
# was actually encoded rather than against the raw narration wavs.
$timings = @{ builtUtc = (Get-Date).ToUniversalTime().ToString("o"); segments = @() }
for ($j = 0; $j -lt $segments.Count; $j++) {
  $timings.segments += @{ img = $segments[$j].img; seconds = $clipDurations[$j] }
}
$timingsPath = Join-Path $root "docs" | Join-Path -ChildPath "guide" | Join-Path -ChildPath "timings.json"
# PowerShell 5.1 writes a BOM for -Encoding utf8, which breaks JSON.parse and confuses some
# subtitle readers. WriteAllText with a no-BOM encoding avoids it.
[IO.File]::WriteAllText($timingsPath, ($timings | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
Write-Host ("Wrote {0}" -f $timingsPath)

$hash = (Get-FileHash -Algorithm SHA256 $out).Hash.ToLower()
Write-Host ("Built {0}" -f $out)
Write-Host ("SHA-256: {0}" -f $hash)
Write-Host "Pin this in apps/app/src-tauri/src/lib.rs (GUIDE_SHA256), then run publish-site."
