# Executable acceptance spec for on-device Word/Excel form fill.
# Scenarios trace to REQ-15.1 (RFC-0002 / ADR-0011). Backed today by
# apps/app/src/office.test.mjs; wire to a BDD runner when one is adopted.

Feature: Fill Word/Excel forms on-device
  As a user with a reusable data vault
  I want my Word (.docx) and Excel (.xlsx) forms filled from that vault
  So that I don't retype the same details, and my data never leaves the device

  # Traces to: REQ-15.1

  Scenario: Word content controls filled from the vault (Phase A)
    Given a .docx whose content controls are tagged "full_name" and "nationality"
    And a vault containing full_name="Asha Rao" and nationality="Indian"
    When the user opens the file in "Fill a Form"
    Then both content controls are filled with the vault values
    And a filled .docx is exported
    And nothing is uploaded off the device

  Scenario: Excel named range filled from the vault (Phase A)
    Given an .xlsx with a named range "full_name" pointing at Sheet1!$B$2
    And a vault containing full_name="Asha Rao"
    When the user opens the file in "Fill a Form"
    Then cell B2 is written as an inline string "Asha Rao"

  Scenario: Flat Word table — label cell fills the next cell (Phase B)
    Given a .docx table row with a "Full name" label cell and an empty next cell
    And a vault containing full_name="Asha Rao"
    When the user opens the file
    Then the next cell in that row is filled with "Asha Rao"

  Scenario: Flat Excel — label cell fills its right neighbour (Phase B)
    Given an .xlsx where cell A1 reads "Full name" and B1 is empty
    And a vault containing full_name="Asha Rao"
    When the user opens the file
    Then cell B1 is filled with "Asha Rao"

  Scenario: A vault key with no value is reported, not invented
    Given a .docx content control tagged "date_of_birth"
    And a vault that has no date_of_birth
    When the user opens the file
    Then the field is reported as unfilled
    And no placeholder or fabricated value is written

  Scenario: No detectable fields — clear message, no bad output
    Given a .docx with prose but no content controls, table labels, or "Label:" lines
    When the user opens the file
    Then the app reports that no fillable fields were found
    And it does not export a corrupted or empty file

  Scenario: Legacy binary formats are refused with guidance
    Given a legacy .doc or .xls (binary, non-OOXML) file
    When the user opens it
    Then the app asks the user to save it as .docx/.xlsx
    And does not attempt to parse it
