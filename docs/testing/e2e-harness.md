# End-to-end (E2E) harness & production sign-off checklist

The automated suite (`node scripts/test-all.mjs` — 125 engine/extension + 8 desktop unit/integration,
typecheck, vite build; plus `cargo test`) does NOT cover live runtime. This document is the
**executable checklist** for the things that can only be verified on a real machine — the `@live`
scenarios in `features/*.feature`. Production sign-off requires every ⬜ below to be ✅.

## 0. Prerequisites (once)
- ⬜ Build the desktop binary: `cargo tauri build` (or run dev: `pnpm --filter @projectpdfs/app tauri dev`).
- ⬜ Register the native host for the extension: `apps/extension/host/register-native-host.ps1`
  (writes the manifest + the Chrome/Edge `NativeMessagingHosts\com.projectpdfs.host` registry key).
- ⬜ Load the unpacked extension (`apps/extension`) in Chrome/Edge (`chrome://extensions` → Load unpacked).
- ⬜ Provision translation assets if testing translation: `node scripts/fetch-translation-assets.mjs`.

## 1. Desktop app (Tauri window) — `@live`
Driving technique that works for WebView2 (validated this project):
- **Type into fields:** `SendInput` with `KEYEVENTF_UNICODE` (SendKeys is ignored by WebView2).
- **Click:** call `SetProcessDPIAware()` in the driver, then `SetCursorPos`+`mouse_event`; the FIRST
  click must activate the window (click the title bar) or WebView2 ignores it.
- **Capture:** `PrintWindow(hwnd, dc, 2)` regardless of z-order.
- **Native file dialog:** type the full path with `SendInput` unicode, then Enter.

Checks:
- ⬜ Unlock with the passphrase; License tab shows device id + Free/beta.
- ⬜ Profile & Vault: create a profile, add fields, import an ID (OCR), export+import the encrypted vault.
- ⬜ Forms: open a form from the device / a URL / a web search; it fills from the vault and exports `filled.pdf`.
- ⬜ **Past forms:** the filled form appears; **Re-download PDF** returns the exact bytes; **Sign** records an Ed25519 signature (doc hash shown). *(Fill→save→sign verified live 2026-07-22 with the Japan visa form.)*
- ⬜ **Sign / annotate:** pen (colour+size), text, place a vault image, **drag + resize** it, Undo, multi-page, Done → `signed.pdf` contains the annotations at the right positions.
- ⬜ **Docs & Video:** the guide video downloads once from the asset host, verifies its pinned hash, caches, and plays offline; written docs render.

## 2. Extension in a real browser — `@live`
- ⬜ Unlock (passphrase / passkey); add/edit/delete vault fields; fill a web form and a PDF.
- ⬜ ID capture: camera + PDF417 back-of-licence barcode → exact fields.
- ⬜ Sign tool (`sign.html`): pen/colour/size, undo, stamp, flatten.

## 3. Single shared vault (extension ⇄ desktop) — `@live`
Backed by unit tests (`companion.test.mjs`); this verifies the native-messaging round-trip.
- ⬜ **Desktop-first:** desktop has a profile+data → open the extension popup → it shows the SAME
  profile and fields (no toggle), banner reads "One vault · shared with the desktop app · profile: …".
- ⬜ **Extension-first:** put data in the extension's local vault (desktop absent) → start the desktop
  app + register host → open the popup → the local fields are seeded into the desktop vault (safe union;
  no existing desktop value is overwritten).
- ⬜ **Live edit both ways:** add a field in the extension → it appears in the desktop app (same
  `vault.db`), and vice-versa. No second copy / no divergence.
- ⬜ **Locked-vault decision** (see below) behaves as agreed.

## 4. Infra (ADR-0019) — `@live`
- ⬜ Deploy the OKE edge gate (`docs/deploy/app-asset-gate.md`): `/app-assets/*` returns the guide
  video only with a valid `X-PPF-App` token + Origin; public requests get 403.
- ⬜ Upload `docs/marketing/site/app-assets/guide.mp4` via `deploy/publish-site.ps1`.
- ⬜ Rotate `APP_ASSET_TOKEN` off the placeholder; confirm the app's pinned `GUIDE_SHA256` matches the
  uploaded file; rebuild binaries so the token + hash ship.

## 5. Release
- ⬜ Bump versions (Tauri app is still 0.1.0; extension per store cadence); rebuild `.exe/.msi` + store zip.
- ⬜ CI green on the branch (`.github/workflows/ci.yml`): lint · typecheck · unit+integration · acceptance ·
  traceability · migration-safety · secret scan · dependency/license.
- ⬜ Tag an annotated release + changelog entry + reproducible build.

## Open decisions (must resolve before GA)
- **Locked-vault access:** today the `native-host` decrypts `vault.db` with the OS-keystore key, so the
  extension can read the shared vault even when the desktop app is *locked* (the passphrase is an
  app-access gate, separate from the at-rest key). Decide: (a) keep (convenience) or (b) gate companion
  reads on the desktop being unlocked (respects the passphrase). If (b): the app must hand the host a
  short-lived unlock token, or write an unlock sentinel the host checks.
