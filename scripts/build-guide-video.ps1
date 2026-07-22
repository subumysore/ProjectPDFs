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
# it to polyglotformfill.mooo.com/app-assets/guide.mp4, gated to app builds. It's *.mp4 → gitignored.
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

# (slide file, narration) — one segment per feature tab.
$segments = @(
  @{ img = "slide-license.png"; text = "Welcome to PolyglotFormFill, a private, on-device form filler. Every form you handle is read and filled entirely on your device. Nothing is ever uploaded, and we never see your data. It goes only where you choose to send it. The app opens on the License tab, which shows your license and this device's identity, all verified offline. During the beta, every feature is free." },
  @{ img = "f-forms.png"; text = "Next is Profile and Vault. At the top you create or choose a profile. Below it is that profile's encrypted vault. Your details, like name, date of birth, e-mail, photo, and signature, are sealed at rest on your device." },
  @{ img = "tab-vault.png"; text = "You can add details by hand, or import a passport, licence, or business card. On-device text recognition reads it and fills your vault automatically. You can also back up or transfer the whole vault as a passphrase-encrypted file. There is no plain-text export." },
  @{ img = "h-forms.png"; text = "The Forms tab is where you bring any form. From your device, a network location, a web link, or by searching the web. It is read and filled right here. If the form already has fields, they are filled from your vault. If not, on-device text recognition detects the fields, creates them, and fills them, then exports a ready, filled P D F." },
  @{ img = "k-history.png"; text = "Every form you fill is kept in Past forms, as an encrypted, versioned copy, entirely on this device. You can re-download any past version at any time." },
  @{ img = "l-signed.png"; text = "You can also sign a filled form with this device's own key. A non-delegable provenance signature that proves it came from you, created offline." },
  @{ img = "slide-docs.png"; text = "Finally, the Docs and Video tab holds this walkthrough and full written documentation. Everything you have seen happens on your device. Private by design. Thanks for watching." }
)

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $synth.SelectVoice("Microsoft Zira Desktop") } catch {}
$synth.Rate = 0; $synth.Volume = 100

$concat = Join-Path $work "concat.txt"
Set-Content -Path $concat -Value "" -Encoding ascii
$scale = "scale=1280:960:force_original_aspect_ratio=decrease,pad=1280:960:(ow-iw)/2:(oh-ih)/2:white,fps=30,format=yuv420p"

for ($i = 0; $i -lt $segments.Count; $i++) {
  $wav = Join-Path $work ("seg{0}.wav" -f $i)
  $synth.SetOutputToWaveFile($wav); $synth.Speak($segments[$i].text)
  $img = Join-Path $slides $segments[$i].img
  $clip = Join-Path $work ("clip{0}.mp4" -f $i)
  & $ff -y -loop 1 -i $img -i $wav -vf $scale -c:v libx264 -preset medium -tune stillimage `
    -c:a aac -b:a 160k -shortest $clip 2>$null
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed encoding clip $i ($($segments[$i].img))" }
  Add-Content -Path $concat -Value ("file 'clip{0}.mp4'" -f $i) -Encoding ascii
  Write-Host ("segment {0}: {1}" -f ($i + 1), $segments[$i].img)
}
$synth.SetOutputToNull(); $synth.Dispose()

& $ff -y -f concat -safe 0 -i $concat -c copy $out 2>$null
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed concatenating clips into $out" }
$hash = (Get-FileHash -Algorithm SHA256 $out).Hash.ToLower()
Write-Host ("Built {0}" -f $out)
Write-Host ("SHA-256: {0}" -f $hash)
Write-Host "Pin this in apps/app/src-tauri/src/lib.rs (GUIDE_SHA256), then run publish-site."
