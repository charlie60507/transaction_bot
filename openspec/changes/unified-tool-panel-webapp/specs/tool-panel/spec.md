## ADDED Requirements

### Requirement: Modal dialog hosts the unified panel

The system SHALL render the unified panel (`ToolPanel`) as a modal dialog shown inside the spreadsheet, containing both the category and TAG views. Because the modal runs in the spreadsheet context, server-side reads SHALL use the active spreadsheet (the narrow container scope) rather than a broad all-spreadsheets scope.

#### Scenario: Panel opens as a modal dialog

- **WHEN** the panel is launched
- **THEN** `ToolPanel` is shown as a modal dialog over the spreadsheet and renders

#### Scenario: Reads use the active spreadsheet

- **WHEN** a server query function runs
- **THEN** it reads transactions from the active (bound) spreadsheet and returns data without requiring a broader authorization scope

### Requirement: Two tabs — 類別 and TAG

The panel SHALL present two top-level tabs, 類別 and TAG. Each tab shows per-item spend totals (one row per category / per TAG) with count, sorted by total descending, and a relative proportion bar. The default tab on load is 類別.

#### Scenario: Switch tabs

- **WHEN** the user switches between 類別 and TAG
- **THEN** the list reloads with that dimension's per-item totals, sorted highest-first

### Requirement: Category totals are self-contained

The 類別 totals SHALL be computed directly from the Transactions sheet — the manual category column (K), falling back to the auto category column (G) when K is blank — with no dependency on the Dashboard pivot or any selected cell.

#### Scenario: No Dashboard cell needed

- **WHEN** the user opens the panel and views the 類別 tab
- **THEN** category totals appear without the user selecting any Dashboard cell

### Requirement: All-time / current-month scope toggle

Each tab SHALL offer a 全部 / 當月 toggle. 當月 restricts totals to the current calendar month (TZ Asia/Taipei) by transaction date (column C). The default is 全部.

#### Scenario: Restrict to current month

- **WHEN** the user selects 當月
- **THEN** totals and counts reflect only transactions dated in the current year and month

### Requirement: Drill from an item into its transactions

Clicking a category or TAG row SHALL show that item's individual transactions for the active scope as cards plus summary stats, with a control to return to the overview in the same scope and tab.

#### Scenario: View an item's transactions

- **WHEN** the user clicks a category or TAG row
- **THEN** the panel shows that item's transactions (active scope) as cards plus summary stats

#### Scenario: Return to overview

- **WHEN** the user activates the back control
- **THEN** the panel returns to the per-item overview in the same scope and tab

### Requirement: Menu launcher

The `交易工具` menu's single `開啟面板` item SHALL open the panel directly as a modal dialog inside the spreadsheet, with no external URL or new tab.

#### Scenario: Launch from the menu

- **WHEN** the user clicks `交易工具 → 開啟面板`
- **THEN** the unified panel opens as a modal dialog over the spreadsheet
