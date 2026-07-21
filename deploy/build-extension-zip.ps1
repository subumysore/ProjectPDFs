# Build ONLY the Chrome Web Store package (.zip) from apps\extension - no website publish.
# Use this to upload an updated package to the CWS Developer Dashboard.
#
# Usage:  .\deploy\build-extension-zip.ps1
# Output: dist\polyglotformfill-extension-v<version>.zip
#
# Includes the EXACT runtime file set the extension imports/loads (skips node_modules,
# tests, *.map, build scripts). Verified against `grep ../vendor` in src.

$ErrorActionPreference = "Stop"
$root  = Resolve-Path (Join-Path $PSScriptRoot "..")
$ext   = Join-Path $root "apps\extension"
$dist  = Join-Path $root "dist"
$stage = Join-Path $env:TEMP "ppf-ext-store-stage"

$version = (Get-Content (Join-Path $ext "manifest.json") | ConvertFrom-Json).version
Write-Host "Building store package for v$version..." -ForegroundColor Cyan

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
# STRIP the local dev `key` from the STORE manifest. The `key` pins our unpacked dev ID
# (ikocic...), but the published item has its own Google-assigned key; uploading a package
# whose key differs from the item's is REJECTED ("key field value ... doesn't match the
# current item"). The store manages the key/ID, so the uploaded manifest must omit it.
# (The local apps\extension\manifest.json keeps its key for dev — only the zip drops it.)
$mPath = Join-Path $stage "manifest.json"
$m = Get-Content $mPath -Raw | ConvertFrom-Json
$m.PSObject.Properties.Remove("key")
$m | ConvertTo-Json -Depth 20 | Set-Content $mPath -Encoding utf8
Write-Host "     Stripped dev 'key' from the store manifest." -ForegroundColor DarkGray
# all app source (production .js only - exclude tests)
Get-ChildItem (Join-Path $ext "src\*.js") | Where-Object { $_.Name -notlike "*.test.*" } | Copy-Item -Destination (Join-Path $stage "src")

# vendored runtime deps (models + language packs are hosted, not bundled)
$v = Join-Path $ext "vendor"; $vd = Join-Path $stage "vendor"
Copy-Item (Join-Path $v "pdf-lib.esm.min.js"),(Join-Path $v "fontkit.bundle.mjs"),(Join-Path $v "zxing.bundle.mjs") $vd
Copy-Item (Join-Path $v "pdfjs\pdf.min.mjs"),(Join-Path $v "pdfjs\pdf.worker.min.mjs") (Join-Path $vd "pdfjs")
Copy-Item (Join-Path $v "transformers\transformers.bundle.mjs"),(Join-Path $v "transformers\ort-wasm-simd-threaded.jsep.mjs"),(Join-Path $v "transformers\ort-wasm-simd-threaded.jsep.wasm") (Join-Path $vd "transformers")
Copy-Item (Join-Path $v "tesseract\worker.min.js"),(Join-Path $v "tesseract\tesseract.esm.min.js"),(Join-Path $v "tesseract\tesseract-core-simd-lstm.wasm"),(Join-Path $v "tesseract\tesseract-core-simd-lstm.wasm.js") (Join-Path $vd "tesseract")

# sanity: every import-referenced vendor file + key sources must be present
foreach ($must in "manifest.json","popup.html","viewer.html","capture.html","options.html",
  "src\background.js","src\popup.js","src\viewer.js","src\capture.js",
  "vendor\pdf-lib.esm.min.js","vendor\fontkit.bundle.mjs","vendor\zxing.bundle.mjs",
  "vendor\pdfjs\pdf.min.mjs","vendor\transformers\transformers.bundle.mjs",
  "vendor\tesseract\tesseract.esm.min.js") {
  if (-not (Test-Path (Join-Path $stage $must))) { throw "missing from build: $must" }
}
# guard: no test files leaked into the package
if (Get-ChildItem $stage -Recurse -Filter *.test.* ) { throw "test files leaked into the package" }

if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Force -Path $dist | Out-Null }
$zip = Join-Path $dist "polyglotformfill-extension-v$version.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal

Write-Host ("Done: {0}  ({1:N1} MB)" -f $zip, ((Get-Item $zip).Length / 1MB)) -ForegroundColor Green
Write-Host "Upload it at chrome.google.com/webstore/devconsole -> your item -> Package -> Upload new package." -ForegroundColor Cyan
