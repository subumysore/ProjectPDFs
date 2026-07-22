# Executable acceptance spec for the desktop "review & edit the filled form" step.
# Scenarios trace to REQ-02.1 (make fillable / fill) and the correctness/no-fabrication rule.
# Backed by pdf.ts listReviewFields / applyReviewEdits (pdf-lib); interactive UI is an @live gate.

Feature: Review and correct a filled form before finalizing (desktop, on-device)
  As a user whose form was auto-filled from a vault
  I want to see every filled value and fix anything wrong before I finalize
  So that I never submit a mis-detected value (e.g. the wrong marital-status option)

  # Traces to: REQ-02.1

  Scenario: Every form field is shown for review after a fill
    Given a PDF with form fields is filled from the vault
    When the fill completes
    Then an editable review lists every field with its current value
    And text fields, radio groups, checkboxes, and dropdowns are all shown

  Scenario: Correcting a mis-detected radio option
    Given the review shows Marital status = "Widowed" but the user is "Married"
    When the user selects "Married" in that field's dropdown and applies changes
    Then the exported PDF has "Married" selected
    And the saved version is updated

  Scenario: Editing a text value
    Given the review shows a wrong passport number
    When the user edits it and applies changes
    Then the exported PDF carries the corrected passport number

  Scenario: Values are never committed silently
    Given a filled form
    When the user has not changed anything
    Then "Apply changes" is disabled
    And the originally exported values stand only because the user reviewed them

  Scenario: Empty fields are shown, not fabricated
    Given the vault had no value for a field
    When the review is shown
    Then that field appears empty (editable), never with an invented value

  @live
  Scenario: End-to-end in the desktop app (live gate)
    Given the desktop app running with a just-filled form
    When the user corrects a value in the review and clicks "Apply changes & re-export"
    Then filled.pdf is re-exported with the correction and the Past-forms version updates
