## ADDED Requirements

### Requirement: Web App serves the unified panel

The system SHALL expose a Web App whose `doGet` returns a single HTML page (`ToolPanel`) containing both the category and TAG views. Because a Web App request has no active spreadsheet, all server-side reads SHALL open the target spreadsheet by id.

#### Scenario: Panel served over its Web App URL

- **WHEN** the Web App URL is opened
- **THEN** the unified panel page is returned and renders

#### Scenario: Reads work without an active spreadsheet

- **WHEN** a server function runs in the Web App context (no active spreadsheet)
- **THEN** it reads transactions via `openById` and returns data without error

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

The `交易工具` menu's `開啟面板` item SHALL open a dialog containing a clickable link to the Web App URL (resolved at runtime), opening the panel in a new tab. It MUST NOT rely on an auto popup that a browser could block.

#### Scenario: Launch from the menu

- **WHEN** the user clicks `交易工具 → 開啟面板`
- **THEN** a dialog appears with a link that opens the panel in a new browser tab
