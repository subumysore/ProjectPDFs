# ADR-0010: Desktop app as the single source of truth for the vault

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Subramanya Mysore
- **Related:** RFC-0004 (browser extension client), ADR-0003 (encrypted export/import/sharing)

## Context
Users can run both the browser extension and the desktop app. By default each keeps its
own vault (the extension in the browser; the desktop app in its encrypted SQLite
`vault.db`), so data entered in one is invisible to the other and must be retyped. Users
asked for a single source of truth so they enter their details once.

The native-messaging companion (`projectpdfs-host`) already opens the app's `vault.db`
**directly**, using the same seal key from the OS keyring the desktop app uses — so it can
read and (now) write the authoritative vault even when the desktop UI isn't running. This
keeps everything on-device and never sends user content anywhere (privacy invariant holds).

## Options considered
1. **Two independent vaults + manual export/import (status quo + ADR-0003)** — simple, fully
   offline; but the user must remember to sync and data drifts between devices/clients.
2. **Bidirectional real-time sync between extension and desktop vaults** — convenient, but
   requires conflict resolution, a sync channel, and duplicate encrypted copies; more moving
   parts and a larger attack surface for little gain when both live on one machine.
3. **Desktop vault is authoritative; extension is a thin client over the companion** — the
   extension reads *and writes* through `projectpdfs-host`; it keeps no separate vault when
   this mode is on. One store, no drift, keys never persist in the extension.

## Decision
Adopt **Option 3**, as an **opt-in mode** ("Desktop vault mode") toggled in the extension
options. When on, the popup's details editor and autofill route through new companion
messages `getVault` / `upsertData` / `deleteData` / `listProfiles` / `createProfile`; the
extension's own passphrase/passkey vault is bypassed entirely. When off, the extension
behaves exactly as before (its own local vault). Cross-device data movement remains the job
of the encrypted export/import in ADR-0003.

## Consequences
- **Positive:** one authoritative vault on a machine; no retyping; no drift; keys stay in the
  trusted native binary (strongest answer to the served-code trust concern); privacy invariant
  intact (no network, no third party).
- **Negative / cost:** requires the desktop app installed and the companion registered; if the
  app/keyring is unavailable the extension can't read/write in this mode (surfaced clearly in
  the UI). The host now has write access to `vault.db` (was read-only) — mitigated by the same
  keyring-gated key and local-only stdio transport.
- **Follow-ups / new risks:** profile selection UX when multiple desktop profiles exist (chosen
  profile stored in extension settings); consider write-conflict handling if the desktop UI and
  the companion mutate `vault.db` concurrently (SQLite serializes writes; acceptable for now).
  Cross-device use is served by ADR-0003 export/import, not by this ADR.
