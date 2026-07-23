# Executable acceptance spec for release integrity + the unsigned-build trust UX.
# Spec: docs/specs/release-integrity.md   Decision: ADR-0020.
# Backed by scripts/release-manifest.test.mjs (run by scripts/test-all.mjs).
# The rendered install page is a LIVE gate (browser).

Feature: Release integrity without a paid code-signing certificate
  As someone downloading PolyglotFormFill
  I want to know exactly what my computer will show me and to be able to verify what I downloaded
  So that an expected warning does not read as a threat, and I can prove the file is intact

  # Traces to: REQ-05.1

  Scenario: Every published artifact carries a published SHA-256
    Given a directory of built release artifacts and a version string
    When the release manifest is generated
    Then each artifact is listed with its byte length and lowercase 64-character SHA-256
    And the entries are sorted by name
    And the manifest records that the artifacts are not CA-signed

  Scenario: The manifest is byte-stable for identical inputs
    Given the same artifacts and version
    When the manifest is generated twice
    Then both manifests are byte-identical

  Scenario: An empty build directory fails loudly
    Given a directory containing no release artifacts
    When the release manifest is generated
    Then generation fails with a non-zero exit and a clear message
    And no manifest advertising zero artifacts is written

  Scenario: A user verifies an intact download
    Given a published manifest and the artifacts exactly as published
    When verification runs
    Then every artifact is reported OK and the exit code is zero

  Scenario: A tampered or truncated download is caught
    Given a published manifest and an artifact whose bytes differ
    When verification runs
    Then that artifact is reported as MISMATCH and the exit code is non-zero

  Scenario: A missing artifact is caught
    Given a published manifest and an artifact that is absent
    When verification runs
    Then that artifact is reported as MISSING and the exit code is non-zero

  Scenario: All problems are reported in one pass
    Given a manifest with one mismatched and one missing artifact
    When verification runs
    Then both problems are reported in the same run

  Scenario: The install page sets expectations before the user commits
    Given the install page
    When a user reads the Windows desktop section
    Then the unsigned status and the exact Windows message appear above the download button
    And the click path "More info -> Run anyway" is given
    And the artifact's SHA-256 and a verification command are shown

  Scenario: winget offers the exact bytes we published
    Given the winget manifests in deploy/winget
    When they are compared against the published release manifest
    Then each InstallerSha256 equals the published SHA-256 for that file
    And every published Windows installer is offered through winget
    And the package version and identifier agree across all three manifests

  Scenario: A channel that is not live yet says so
    Given the winget listing has not been approved
    When a user reads the winget section of the install page
    Then it is labelled as not yet live and points them to the direct download

  Scenario: Install channels are ordered by least friction
    Given the install page
    When the install options are listed
    Then the browser extension appears first
    And winget appears before the direct download

  Scenario: The copy stays honest and calm
    Given the install page
    Then it does not claim the download is certified, verified by Windows, or safe
    And it does not use alarm vocabulary or apologise for the warning

  @live
  Scenario: Rendered page in a real browser (live gate)
    Given the published install page open in a browser
    When a user follows the Windows desktop instructions end to end
    Then the warning they encounter matches what the page predicted
