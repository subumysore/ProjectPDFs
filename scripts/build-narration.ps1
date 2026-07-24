# Generate mastered narration WAVs for the guide video from docs/guide/narration.json.
# Piper (en_US-ryan-high) -> broadcast chain (highpass, de-ess, presence EQ, compressor, loudnorm)
# so a free on-device voice sounds polished. Output: docs/guide/output/audio/<img-stem>.wav
# Usage:  powershell scripts/build-narration.ps1
$ErrorActionPreference = "Continue"
$root = Split-Path $PSScriptRoot -Parent
$piper = Join-Path $root "tools\piper\bin\piper.exe"
$model = Join-Path $root "tools\piper\en_US-ryan-high.onnx"
$outDir = Join-Path $root "docs\guide\output\audio"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$nar = Get-Content (Join-Path $root "docs\guide\narration.json") -Raw | ConvertFrom-Json
$ff = (Get-Command ffmpeg -EA SilentlyContinue).Source
if (-not $ff) { $ff = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\*ffmpeg*\*\bin\ffmpeg.exe" -EA SilentlyContinue | Select-Object -First 1).FullName }
$chain = "highpass=f=85,deesser,equalizer=f=180:t=q:w=1:g=-2,equalizer=f=3200:t=q:w=2:g=2.5,acompressor=threshold=-18dB:ratio=3:attack=8:release=180:makeup=2,loudnorm=I=-16:TP=-1.5:LRA=11"
$i = 0
foreach ($s in $nar.segments) {
  $stem = if ($s.img) { [IO.Path]::GetFileNameWithoutExtension($s.img) } else { "{0:d2}" -f $i }
  $raw = [IO.Path]::GetTempFileName() + ".wav"
  $s.text | & $piper -m $model -f $raw 2>$null
  & $ff -y -i $raw -af $chain -ar 44100 -ac 1 (Join-Path $outDir "$stem.wav") 2>$null | Out-Null
  Remove-Item $raw -EA SilentlyContinue
  Write-Host "  $stem"
  $i++
}
Write-Host "Done. Mastered narration in $outDir"
