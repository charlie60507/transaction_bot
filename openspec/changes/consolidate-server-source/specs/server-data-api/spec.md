## ADDED Requirements

### Requirement: The server is a thin data layer, not a second dashboard

The bound project's server file (`sidebar/程式碼.js`) SHALL expose exactly one read
(`getAllTxns`) and three writes (`updateTxn`, `addTxn`, `deleteTxn`) to the page, plus the web-app
and menu entry points. All aggregation — period totals, category and TAG breakdowns, the monthly
trend, heatmap day totals — SHALL be computed client-side from the flat array `getAllTxns`
returns. No server function MAY exist whose only purpose is to aggregate transactions for display.

#### Scenario: The page loads its data

- **WHEN** the dashboard opens
- **THEN** it calls `getAllTxns` once and receives a flat array of transactions with no aggregates
- **AND** every statistic on the page is derived from that array in the browser

#### Scenario: Every client call resolves

- **WHEN** the offline gate (`node check_sidebar.js`) scans `sidebar/ToolPanel.html`
- **THEN** the only `google.script.run` targets it finds are `getAllTxns`, `updateTxn`, `addTxn`
  and `deleteTxn`
- **AND** each resolves to a `function` in the project's `.js` files, so the gate exits 0

#### Scenario: A new statistic is needed

- **WHEN** a future change adds a statistic the dashboard does not yet show
- **THEN** it is computed in the page from the existing `getAllTxns` payload
- **AND** no server-side aggregation helper is reintroduced without changing this requirement

### Requirement: One server-side definition of a transaction

Exactly one server function SHALL map a `Transactions` row into the shape the page consumes, and
that function is `getAllTxns`. A second mapper with a different field shape — in particular a
different date representation — MUST NOT exist, because an edit made to the wrong one compiles,
deploys, and does nothing.

#### Scenario: The transaction shape changes in one place

- **WHEN** a change adds or alters a field the page reads for a transaction (for example a time of
  day on the 待記帳 queue)
- **THEN** there is exactly one server function to edit
- **AND** the edit is observable in the dashboard

#### Scenario: Dates have one representation

- **WHEN** the server sends a transaction to the page
- **THEN** its date arrives as the numeric fields `y`, `m`, `d`
- **AND** no server function formats a transaction date as a display string

### Requirement: Entry points named by string stay reachable

A server function whose only reference is a **name string** SHALL be treated as reachable, and
removing unused server code MUST be done from an explicit, hand-verified list — after grepping
each candidate name as a bare string as well as a call — never by pointing an automated
unused-export tool at the file. Apps Script resolves several entry points this way: the sheet menu
registers its action as `.addItem('開啟面板', 'showPanelLauncher')`, and time triggers name their
handler the same way. Every call-graph tool reports those functions as dead, and deleting them
breaks the sheet menu with nothing in the source to explain the loss.

#### Scenario: The sheet menu still opens the panel

- **WHEN** the owner opens the spreadsheet and clicks 交易工具 → 開啟面板
- **THEN** the launcher dialog appears with a working link to the deployed web app

#### Scenario: A string reference counts as a reference

- **WHEN** server code is swept for unused functions
- **THEN** a function whose only reference is a string argument to an Apps Script API is kept
- **AND** the sweep's deletion list is explicit rather than tool-generated
