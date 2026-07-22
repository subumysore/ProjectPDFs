# Executable acceptance spec for the desktop "Past forms" on-device history of filled forms.
# Scenarios trace to REQ-07.1 (save/versioned) and REQ-08.1 (history/versioning).
# Backed by crates/core-store (brought_form_blobs_and_instance_listing) unit test.
# The full click-through is a LIVE gate (Tauri window).

Feature: Past forms — encrypted, versioned history of every filled form (on-device)
  As a user who fills forms with the desktop app
  I want each filled form kept, versioned, and re-openable on my device
  So that I can re-download or sign a past version without it ever leaving my machine

  # Traces to: REQ-07.1, REQ-08.1, REQ-09.1

  Scenario: Filling any brought form saves it to history automatically
    Given a profile with a vault
    When the user fills a form brought from the device, a URL, or a web search
    Then the filled PDF is saved as an encrypted, versioned copy on-device
    And it appears in the Past forms tab with its name, version, save count, and fields filled

  Scenario: Re-filling the same form appends a new version
    Given a form already saved once in Past forms
    When the user fills the same-named form again
    Then a new version is appended to the same instance
    And older versions are retained (immutable chain)

  Scenario: The saved PDF bytes are sealed at rest
    Given a filled form saved to history
    When the stored blob is inspected on disk
    Then the PDF bytes are encrypted (plaintext absent)

  Scenario: Re-download a past version
    Given a saved form version
    When the user clicks "Re-download PDF"
    Then the exact filled PDF for that version is written to the device
    And no network request is made to reconstruct it

  Scenario: Sign a saved version with the device key
    Given a saved form version that is not yet signed
    When the user clicks "Sign (device key)"
    Then a non-delegable Ed25519 provenance signature is recorded for that version
    And the entry shows as signed with its document hash

  Scenario: History is scoped to the profile and ordered newest-first
    Given two profiles each with saved forms
    When the user views Past forms for one profile
    Then only that profile's saved forms are listed
    And they are ordered most-recently-saved first

  @live
  Scenario: End-to-end in the desktop app (live gate)
    Given the desktop app running and unlocked
    When the user opens a form, fills it, and switches to Past forms
    Then the just-filled form is listed, re-downloadable, and signable
