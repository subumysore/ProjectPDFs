# RFC-0007 — Profiles + create/overwrite a profile from an ID scan

- Status: accepted (owner-confirmed 2026-07-20)
- Requirements: REQ-10 (data-source extraction + profiles), REQ-16 (extension)
- Supersedes/extends: ADR-0010 (single-source-of-truth vault)

## Problem
A user should be able to create a profile two ways: (1) type each field (First/Last
name, Address, …), or (2) **take a picture of their driver's licence / passport / ID** and
have the profile created from it. When an ID is scanned, if that person's profile already
exists, **overwrite** it (including the document image); otherwise **create a new** profile.
The extension currently has only a SINGLE vault (no profiles).

## Decision
1. **Extension gains multiple profiles.** The encrypted vault becomes a container:
   `{ profiles: { <id>: { name, data: {key:val} } }, active: <id> }`. The active profile's
   `data` is what today's `getVault`/`set`/`del` operate on (unchanged semantics). An
   existing single flat vault is migrated into a `default` profile on first unlock.
2. **Profiles live in BOTH places:** the extension's own store AND — when the desktop
   companion is present — the desktop app's profiles (single-source-of-truth). Companion
   sync is best-effort (skipped silently if the companion isn't registered).
3. **Identity match = full name + date of birth** (normalised). On an ID scan, find a
   profile whose name+DOB match; if found → activate + OVERWRITE its data (incl. image);
   else → CREATE a new profile named "First Last". Falls back to name-only if no DOB.
4. **Capture flow** sends all extracted fields at once (`saveIdProfile`) which performs the
   match-or-create + bulk write, instead of per-field `set`.

## Design
- `background.js`: container model + `normalizeContainer` (migration), messages
  `profiles` / `activeProfile` / `createProfile` / `switchProfile` / `saveIdProfile`.
- `profileMatch.js` (pure, unit-tested): `identityOf(data)` → {name, dob}; `findMatch(profiles, id)`.
- `popup.js`: a profile selector (switch / new) above "Your details".
- `capture.js`: "Save checked to profile" → `saveIdProfile`; shows created-vs-updated + name.
- Companion: when `companionMode`, also match-or-create the desktop profile via existing
  `companionProfiles` / `companionCreateProfile` / `companionUpsert` messages (best-effort).

## Consequences
- Positive: two clear onboarding paths (type or scan); re-scanning updates the right person;
  profiles portable to the desktop.
- Negative: structural change to the vault container (migration must be safe); name+DOB match
  can theoretically collide / be thrown by OCR name noise (barcode name is reliable; the
  review screen lets the user correct before saving).
- Out of scope now: profile delete/rename UI (add later); cross-device profile identity beyond
  companion.
