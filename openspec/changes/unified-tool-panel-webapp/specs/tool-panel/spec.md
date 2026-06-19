## ADDED Requirements

### Requirement: Web App serves the dashboard

The system SHALL expose a Web App whose `doGet` returns a single dashboard page (`ToolPanel`) containing both the category and TAG views. Because a Web App request has no active spreadsheet, server-side reads SHALL open the target spreadsheet by id.

#### Scenario: Panel served over its Web App URL

- **WHEN** the Web App URL is opened
- **THEN** the dashboard page is returned and renders

#### Scenario: Reads work without an active spreadsheet

- **WHEN** a server query function runs in the Web App context
- **THEN** it reads transactions via `openById` and returns data without error

### Requirement: Two tabs — 類別 and TAG

The panel SHALL present two top-level tabs, 類別 and TAG. Each tab shows per-item spend totals (one row per category / per TAG) with count and a relative proportion bar. The default tab on load is 類別.

#### Scenario: Switch tabs

- **WHEN** the user switches between 類別 and TAG
- **THEN** the dashboard reloads with that dimension's totals, charts, and list

### Requirement: Category totals are self-contained

The 類別 totals SHALL be computed directly from the Transactions sheet — the manual category column (K), falling back to the auto category column (G) when K is blank — with no dependency on the Dashboard pivot or any selected cell.

#### Scenario: No Dashboard cell needed

- **WHEN** the user views the 類別 tab
- **THEN** category totals appear without selecting any Dashboard cell

### Requirement: Scope — 全部 / 當月 / 指定年月

The panel SHALL offer three mutually-exclusive scopes: 全部 (all-time), 當月 (current calendar month, TZ Asia/Taipei), and a 年+月 selector for any specific month. Selecting a specific year/month deselects 全部/當月; choosing 全部/當月 clears the specific selection. The default is 全部. Date filtering uses transaction date (column C).

#### Scenario: Specific month

- **WHEN** the user picks a year and month from the selectors
- **THEN** totals, charts, KPIs and list reflect only that month, and the 全部/當月 buttons are not active

#### Scenario: Current month

- **WHEN** the user selects 當月
- **THEN** results reflect the current year and month

### Requirement: Period KPI summary

The dashboard SHALL show period KPIs for the active scope, computed over ALL in-scope transactions (independent of category/TAG): total spend, transaction count, daily average, and the largest single transaction (amount + merchant).

#### Scenario: KPIs reflect scope

- **WHEN** the scope changes
- **THEN** the total / count / daily-average / largest KPIs recompute for that scope

### Requirement: Distribution and trend charts

The dashboard SHALL render, for the active tab and scope, a distribution donut chart of the per-item totals (top items plus an 其他 aggregate) and a bar chart of overall spend for the last 6 months, with the selected month highlighted. Charts are inline SVG (no external dependency).

#### Scenario: Charts render

- **WHEN** the overview is shown
- **THEN** a donut of the current dimension's distribution and a 6-month trend bar chart are displayed

### Requirement: Search and sort

The overview list SHALL be filterable by item name and sortable by total, count, or name. The transaction detail view SHALL be filterable by merchant keyword. Filtering and sorting operate on already-loaded data without re-querying the server.

#### Scenario: Filter and sort the overview

- **WHEN** the user types a name query or changes the sort option
- **THEN** the item list updates in place accordingly

#### Scenario: Search transactions

- **WHEN** the user types a merchant keyword in a detail view
- **THEN** only matching transactions are shown

### Requirement: Drill from an item into its transactions

Clicking a category or TAG row SHALL show that item's individual transactions for the active scope as cards plus summary stats, with a control to return to the overview in the same scope and tab.

#### Scenario: View an item's transactions

- **WHEN** the user clicks a category or TAG row
- **THEN** the panel shows that item's transactions (active scope) as cards plus summary stats

#### Scenario: Return to overview

- **WHEN** the user activates the back control
- **THEN** the panel returns to the overview in the same scope and tab

### Requirement: Menu launcher

The `交易工具` menu's single `開啟面板` item SHALL open a dialog containing a clickable link to the Web App URL (resolved at runtime), opening the dashboard in a new tab. It MUST NOT rely on an auto popup that a browser could block.

#### Scenario: Launch from the menu

- **WHEN** the user clicks `交易工具 → 開啟面板`
- **THEN** a dialog appears with a link that opens the dashboard in a new browser tab
