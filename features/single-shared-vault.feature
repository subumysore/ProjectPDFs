# Executable acceptance spec for the AUTOMATIC single vault shared by the extension and desktop app.
# Scenarios trace to REQ-01.1 (on-device vault) and REQ-11.1 (companion bridge).
# Pure decision/migration logic is backed by apps/extension/src/companion.test.mjs.
# The native-messaging round-trip is a LIVE gate (needs Chrome + registered host) — see
# features that require @live below.

Feature: One vault, shared automatically between the extension and the desktop app
  As a user of both the browser extension and the desktop app
  I want them to use the same on-device vault with zero configuration
  So that I enter my details once and both use them, with no divergence and no setup

  # Traces to: REQ-01.1, REQ-11.1

  Scenario: No toggle — the shared vault is automatic
    Given the desktop app is installed and its companion bridge is reachable
    When the extension popup opens
    Then it reads and writes the desktop app's vault as the single source of truth
    And there is no "companion mode" toggle to enable

  Scenario: Desktop not present — transparent local fallback
    Given the desktop app is not installed or not running
    When the extension popup opens
    Then the extension uses its own local vault
    And nothing about this requires user configuration

  Scenario: Desktop-first — the extension adopts the existing vault
    Given the desktop app created a vault with a profile and fields
    And the extension has no local data
    When the extension connects to the companion for the first time
    Then no data is pushed up
    And the extension shows the desktop profile and its fields

  Scenario: Extension-first — local data seeds the shared vault
    Given the extension's local vault contains fields and the vault is unlocked
    And the desktop vault has no value for those fields yet
    When the extension connects to the companion for the first time
    Then each local field is copied into the desktop vault (migrationPlan)
    And afterwards both apps read those fields from the one vault

  Scenario: Safe union — existing desktop values are never overwritten
    Given the extension local vault has email="new@b.com"
    And the desktop vault already has email="existing@b.com"
    When the first-connect migration runs
    Then the desktop value "existing@b.com" is kept
    And only fields the desktop lacks are seeded

  Scenario: Migration is deferred until the local vault can be read
    Given the extension has local data but the local vault is locked
    When the extension connects to the companion
    Then no migration is attempted yet
    And it will run later once the local vault is unlocked

  Scenario: An edit from either side updates the same record — no separate versions
    Given the shared (desktop) vault holds email="a@b.com"
    When the user edits email in the extension to "c@b.com"
    Then the desktop app reads email="c@b.com" from the same record
    And no second copy or version of the field is created

  Scenario: The active profile is readable in either app
    Given the shared vault is in use
    When the extension popup renders
    Then it shows the active profile name it is reading and writing
    And that is the same profile the desktop app shows

  @live
  Scenario: End-to-end over the native-messaging bridge (live gate)
    Given Chrome with the unpacked extension and the registered native host
    And the desktop app running with an unlocked vault
    When the user adds a field in one app and views it in the other
    Then the value appears in both, backed by the single vault.db on disk
