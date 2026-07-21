# One command: rebuild the browser-extension .zip from apps/extension and publish it
# to https://polyglotformfill.mooo.com/download/ (rebuilds the site tarball, uploads to
# Object Storage, restarts the OKE pods).
#
# Usage (PowerShell):  .\deploy\publish-extension.ps1
#
# No manual zipping. Edit files under apps\extension, run this, done.

$ErrorActionPreference = "Stop"
$root  = Resolve-Path (Join-Path $PSScriptRoot "..")
$ext   = Join-Path $root "apps\extension"
$dl    = Join-Path $root "docs\marketing\site\download"
$stage = Join-Path $env:TEMP "ppf-ext-stage"

Write-Host "1/3  Assembling the extension zip..." -ForegroundColor Cyan

# The EXACT runtime file set (skips node_modules, dist-lite, host/, build scripts, *.map).
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path `
  (Join-Path $stage "src"),
  (Join-Path $stage "vendor\pdfjs"),
  (Join-Path $stage "vendor\transformers"),
  (Join-Path $stage "vendor\tesseract") | Out-Null

# root: manifest, pages, icons
foreach ($f in "manifest.json","popup.html","options.html","viewer.html","capture.html","icon16.png","icon48.png","icon128.png") {
  Copy-Item (Join-Path $ext $f) $stage
}
# all app source
Copy-Item (Join-Path $ext "src\*.js") (Join-Path $stage "src")

# vendored runtime deps (explicit — the model + language packs are hosted, not bundled)
$v = Join-Path $ext "vendor"; $vd = Join-Path $stage "vendor"
Copy-Item (Join-Path $v "pdf-lib.esm.min.js"),(Join-Path $v "fontkit.bundle.mjs"),(Join-Path $v "zxing.bundle.mjs") $vd
Copy-Item (Join-Path $v "pdfjs\pdf.min.mjs"),(Join-Path $v "pdfjs\pdf.worker.min.mjs") (Join-Path $vd "pdfjs")
Copy-Item (Join-Path $v "transformers\transformers.bundle.mjs"),(Join-Path $v "transformers\ort-wasm-simd-threaded.jsep.mjs"),(Join-Path $v "transformers\ort-wasm-simd-threaded.jsep.wasm") (Join-Path $vd "transformers")
Copy-Item (Join-Path $v "tesseract\worker.min.js"),(Join-Path $v "tesseract\tesseract.esm.min.js"),(Join-Path $v "tesseract\tesseract-core-simd-lstm.wasm"),(Join-Path $v "tesseract\tesseract-core-simd-lstm.wasm.js") (Join-Path $vd "tesseract")

# sanity: fail loudly if a required file is missing
foreach ($must in "manifest.json","src\background.js","src\viewer.js","vendor\tesseract\tesseract.esm.min.js","vendor\fontkit.bundle.mjs") {
  if (-not (Test-Path (Join-Path $stage $must))) { throw "missing from build: $must" }
}

if (-not (Test-Path $dl)) { New-Item -ItemType Directory -Force -Path $dl | Out-Null }
$zip = Join-Path $dl "polyglotformfill-extension.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal
Write-Host ("     Built {0}  ({1:N1} MB)" -f $zip, ((Get-Item $zip).Length / 1MB)) -ForegroundColor Green

Write-Host "2/3  Publishing the site (tar -> Object Storage -> restart pods)..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "k8s\publish-site.ps1")

Write-Host "3/3  Done. Public download: https://polyglotformfill.mooo.com/download/polyglotformfill-extension.zip" -ForegroundColor Green
Write-Host ""
Write-Host "NOTE: this publishes the DOWNLOADABLE zip to the website. It does NOT load the" -ForegroundColor Yellow
Write-Host "      extension into your Chrome (Chrome has no CLI for that)." -ForegroundColor Yellow
Write-Host "For LOCAL testing you don't need the zip at all:" -ForegroundColor Cyan
Write-Host ("  1. chrome://extensions -> Load unpacked -> {0}" -f $ext) -ForegroundColor Cyan
Write-Host "  2. After each change, just click Reload on the card (same ID -> vault survives)." -ForegroundColor Cyan
