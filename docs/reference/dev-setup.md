# Dev environment setup

Accepted stack: **native (Tauri v2 + Rust core + React/TS UI)** + Node services. This lists what is
**already installed on this machine** (auto-installed 2026-07-16) and the **remaining steps** you must
run (heavy/admin/mac-only items). Verify commands are given for each.

## ✅ Installed & verified on this machine
| Tool | Version | How | Verify |
|---|---|---|---|
| Rust (stable, MSVC) | 1.97.0 | `rustup` (per-user) | `rustc --version` |
| Android Rust targets | aarch64/armv7/x86_64/i686-linux-android | `rustup target add …` | `rustup target list --installed` |
| MSVC C++ Build Tools | VS 2022 BuildTools (VCTools workload) | `winget install Microsoft.VisualStudio.2022.BuildTools` | `cargo build` links OK |
| Node.js | 24.x | pre-existing | `node -v` |
| pnpm | 9.12 | corepack | `pnpm -v` |
| WebView2 Runtime | 150.x | pre-installed (Win11) | see registry `EdgeUpdate\Clients` |
| JDK (for Android) | Microsoft OpenJDK 17 | `winget install Microsoft.OpenJDK.17` | `java -version` (new shell) |
| Rust workspace | builds + tests green | `crates/*` + root `Cargo.toml` | `cargo build && cargo test` |

**PATH:** `%USERPROFILE%\.cargo\bin` was added to the **User** PATH. Open a **new** shell for it to
take effect (this session used an in-line `export PATH="$HOME/.cargo/bin:$PATH"`).

## ▶ Remaining steps you (or a follow-up run) must do

### 1. Tauri CLI (when scaffolding the app)
```
cd apps/app
pnpm add -D @tauri-apps/cli@^2
pnpm tauri --version
```
(Desktop Tauri is fully ready now: Rust + MSVC + Node + WebView2 all present.)

### 2. Android SDK + NDK (heavy — the one big remaining install, needed for the mobile spike)
JDK 17 is already installed. Then install the SDK command-line tools + NDK (no full Android Studio
required for Tauri mobile builds):
```
winget install Google.AndroidStudio          # simplest, includes SDK manager (large ~1GB+)
# --- OR the lighter command-line-only path: ---
#   download "commandlinetools-win" from developer.android.com/studio#command-line-tools-only
#   unzip to  %LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest
```
Then (in a shell with the SDK's `cmdline-tools\latest\bin` on PATH):
```
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;26.3.11579264"
sdkmanager --licenses      # accept all
```
Set environment variables (User scope), then reopen the shell:
```
ANDROID_HOME = %LOCALAPPDATA%\Android\Sdk
NDK_HOME     = %LOCALAPPDATA%\Android\Sdk\ndk\26.3.11579264
# add to PATH: %ANDROID_HOME%\platform-tools
```
Initialise + run the Android project (after the Tauri app exists):
```
cd apps/app
pnpm tauri android init
pnpm tauri android dev        # needs an emulator or a connected device
```

### 3. iOS (cannot be done on Windows)
iOS builds **require macOS + Xcode**. On a Mac: install Xcode + command-line tools, `rustup target add
aarch64-apple-ios aarch64-apple-ios-sim`, then `pnpm tauri ios init` / `ios dev`. Not possible on this
Windows machine — use a Mac or a macOS CI runner for the iOS half of the Phase-0 spike.

## Provision on-device engine assets (self-hosted; zero third-party egress)
The AI engines run as WASM in the app webview and load their assets from the app
origin (`apps/app/public/…`), so `connect-src` stays `'self'`. Assets are large and
gitignored — reproduce them after `pnpm install`:
```
node scripts/fetch-ocr-assets.mjs          # Tesseract worker + LSTM core + eng model
node scripts/fetch-translation-assets.mjs  # opus-mt en<->hi models + onnxruntime WASM
```
- **OCR** assets may already be present on this machine (downloaded during the build).
- **Translation** models are ~100 MB and are fetched by the script (first run needs
  internet); after that, translation runs fully on-device/offline.

## Build the current workspace (works now)
```
# Rust core (all 11 crate stubs)
cargo build
cargo test

# Node (root)
pnpm install
```

## Notes
- `.gitignore` already excludes `target/` (Rust) and `node_modules/` — build artifacts stay out of git.
- The old `apps/api` + `packages/db` (Express/Drizzle/Postgres) scaffold was **removed** (superseded).
- Phase-0 spike (gating): validate pdfium + onnxruntime + WebAuthn + secure keystore + external
  biometric SDK bindings under Tauri v2 on **Android** (here) and **iOS** (on a Mac).
