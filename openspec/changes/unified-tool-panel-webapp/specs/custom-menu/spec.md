## MODIFIED Requirements

### Requirement: Custom menu registered on spreadsheet open
The system SHALL add a custom menu "交易工具" to the spreadsheet menu bar when the spreadsheet is opened. The menu SHALL contain a single item "開啟面板" that opens a launcher dialog linking to the unified Web App panel.

#### Scenario: Menu appears on open
- **WHEN** the spreadsheet is opened
- **THEN** a "交易工具" menu SHALL appear in the menu bar with an "開啟面板" item

#### Scenario: Menu item opens the panel launcher
- **WHEN** the user clicks "交易工具 → 開啟面板"
- **THEN** the system SHALL show a dialog containing a clickable link that opens the Web App panel in a new browser tab
