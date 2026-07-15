# Executable acceptance specs (BDD). These GIVEN/WHEN/THEN scenarios ARE the spec AND the test.
# Wire them to a runner for your stack (Cucumber/Behave/Godog/SpecFlow/pytest-bdd/…).
# One .feature per behavior; each scenario should trace to a REQ-NN.M acceptance criterion.

Feature: Example — replace with a real behavior
  As a <persona>
  I want <capability>
  So that <benefit>

  # Traces to: REQ-00.1

  Scenario: Happy path
    Given a valid <context>
    When the user performs <action>
    Then the system responds with <observable outcome>

  Scenario: Edge case — <name>
    Given <boundary condition>
    When <action>
    Then <graceful handling, not an error>

  Scenario: Error path — <name>
    Given <invalid input or failure>
    When <action>
    Then the system returns <specific error> and does not <bad side effect>
