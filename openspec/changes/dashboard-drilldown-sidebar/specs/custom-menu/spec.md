## ADDED Requirements

### Requirement: Custom menu registered on spreadsheet open
The system SHALL add a custom menu "交易工具" to the spreadsheet menu bar when the spreadsheet is opened. The menu SHALL contain an item "查看明細" that triggers the drill-down sidebar.

#### Scenario: Menu appears on open
- **WHEN** the spreadsheet is opened
- **THEN** a "交易工具" menu SHALL appear in the menu bar with a "查看明細" item

#### Scenario: Menu item triggers sidebar
- **WHEN** the user clicks "交易工具 → 查看明細"
- **THEN** the system SHALL read the active cell on the Dashboard sheet and open the drill-down sidebar

### Requirement: onOpen trigger registration
The menu SHALL be registered via an `onOpen()` simple trigger function so it loads automatically without manual setup.

#### Scenario: No manual trigger setup needed
- **WHEN** the script is deployed via clasp push
- **THEN** the onOpen trigger SHALL register the menu automatically on next spreadsheet open without requiring manual trigger configuration in the Apps Script UI
