#!/usr/bin/env bash
# Notarize + staple a built macOS artifact (.dmg or .app). RUN ON A MAC (macOS + Xcode CLT).
#
# NOTE: Tauri v2 will notarize AUTOMATICALLY during `pnpm tauri build` if the Apple credentials
# below are present in the environment — so in the normal flow you don't run this at all. This
# script is the explicit/CI fallback (e.g. notarizing a .dmg produced separately, or re-stapling).
#
# Prereqs (all yours to obtain — see docs/runbooks/paid-platform.md §macOS):
#   - Apple Developer Program membership (US$99/yr)
#   - A "Developer ID Application" signing cert installed in the login keychain
#   - The app must already be codesigned with hardened runtime + entitlements.plist
#
# Auth — provide ONE of:
#   (a) App Store Connect API key:  APPLE_API_KEY_ID, APPLE_API_ISSUER, APPLE_API_KEY_PATH(.p8)
#   (b) Apple ID + app-specific pw:  APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
#   (c) A saved notarytool keychain profile:  APPLE_KEYCHAIN_PROFILE
#
# Usage:  scripts/notarize-macos.sh path/to/PolyglotFormFill.dmg
set -euo pipefail

ART="${1:?usage: notarize-macos.sh <path-to.dmg|.app>}"
[ -e "$ART" ] || { echo "not found: $ART" >&2; exit 1; }
command -v xcrun >/dev/null || { echo "xcrun not found — run this on macOS with Xcode CLT." >&2; exit 1; }

# Build the notarytool auth arguments from whichever credentials are set.
AUTH=()
if [ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]; then
  AUTH=(--keychain-profile "$APPLE_KEYCHAIN_PROFILE")
elif [ -n "${APPLE_API_KEY_ID:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
  AUTH=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  AUTH=(--apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID")
else
  echo "No Apple notarization credentials set. Provide APPLE_KEYCHAIN_PROFILE, or the API-key trio, or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID." >&2
  exit 1
fi

echo "[notarize] submitting $ART …"
xcrun notarytool submit "$ART" "${AUTH[@]}" --wait

echo "[notarize] stapling ticket …"
xcrun stapler staple "$ART"

echo "[notarize] verifying …"
xcrun stapler validate "$ART"
spctl --assess --type ${ART##*.} --verbose "$ART" 2>&1 || true   # informational Gatekeeper check
echo "[notarize] done: $ART is notarized + stapled."
