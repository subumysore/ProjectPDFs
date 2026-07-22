# Executable acceptance spec for the desktop Sign / annotate tool (parity with the extension).
# Scenarios trace to REQ-08.1 (annotation layers) and REQ-09.1 (signing).
# The overlay flatten is backed by the shared signflatten engine (used by both apps); the
# interactive canvas is a LIVE gate (Tauri window) — SignPad.tsx.

Feature: Sign and annotate a form on the desktop, entirely on-device
  As a user finishing a form
  I want to draw, type, and place my saved signature/photo, then flatten it into the PDF
  So that I can sign or annotate any form without it leaving my device

  # Traces to: REQ-08.1, REQ-09.1

  Scenario: Draw freehand with a chosen pen colour and size
    Given an open PDF in the Sign tool
    When the user selects the Pen, picks a colour and a size, and draws
    Then the strokes appear in that colour and thickness on the page

  Scenario: Type text onto the form
    Given the Sign tool with the Text tool selected
    When the user clicks a spot and enters text
    Then the text is drawn at that spot in the chosen colour

  Scenario: Place a saved vault image as a movable, resizable stamp
    Given the vault contains an image field (e.g. signature or photo)
    When the user selects that stamp and clicks on the form
    Then the image is placed at that spot
    And it can be dragged to reposition it
    And it can be resized from its corner handle (aspect preserved)
    And it can be deleted

  Scenario: Undo and Clear
    Given the user has drawn strokes and placed an image
    When the user presses Undo (or Ctrl/Cmd+Z)
    Then the most recent action is reverted (up to 40 steps)
    And "Clear page" removes this page's ink and images

  Scenario: Multi-page annotations are kept per page
    Given a multi-page PDF
    When the user annotates page 1 and page 2
    Then each page keeps its own ink and image placements

  Scenario: Flatten into the PDF on export
    Given annotations on one or more pages
    When the user chooses "Done — flatten & save"
    Then each page's annotations are composited and flattened 1:1 into the PDF
    And a signed.pdf is exported on-device
    And nothing is uploaded

  @live
  Scenario: End-to-end in the desktop app (live gate)
    Given the desktop app running with an open, filled form
    When the user opens Sign / annotate, places a signature, and exports
    Then the exported PDF contains the placed signature at the chosen position and size
