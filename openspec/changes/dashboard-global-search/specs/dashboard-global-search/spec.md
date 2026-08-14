## ADDED Requirements

### Requirement: One header search over all TXNS

The dashboard SHALL show a single search input in the sticky header controls row on every tab (分析, 趨勢, 項目, 待記帳). The 分析-only "搜尋商店…" field SHALL be removed. The query SHALL search the entire in-memory `TXNS` array, ignoring the current period and tab. A transaction SHALL match if any of: merchant contains the query (case-insensitive), category contains the query (case-insensitive), or the query after stripping `$` and commas is a plain number `n` and `amount === n` or `charged === n`. TAG, bank, and date SHALL NOT be match fields. Searching `350` MUST NOT match an amount or charged of `1350`.

#### Scenario: Merchant fragment across months and types

- **WHEN** the query is a merchant substring
- **THEN** matching rows from any month and any 收支別 are hits, including 收入

#### Scenario: Category substring

- **WHEN** the query is a category name present on some rows
- **THEN** those rows are hits

#### Scenario: Exact amount, not a substring of a larger amount

- **WHEN** the query is `350` or `$350`
- **THEN** rows whose `amount` or `charged` is exactly 350 are hits
- **AND** a row whose amount is 1350 is not a hit

#### Scenario: TAG / bank / date are not searched

- **WHEN** the query equals a TAG, bank name, or date fragment that is not also in merchant or category
- **THEN** those rows are not hits

### Requirement: Non-empty query is a result mode

A trimmed non-empty query SHALL replace the current tab body with a list of matching `editRow`s, newest date first, capped at 40, with a visible overflow count ("還有 N 筆") when more than 40 match. KPIs, heatmap, and other tab chrome in the body SHALL NOT render at the same time. Clearing the input or pressing Escape SHALL restore the underlying tab. Switching tabs SHALL NOT clear `state.q`.

#### Scenario: Results use editRow and cap at 40

- **WHEN** more than 40 transactions match
- **THEN** 40 `editRow`s render and the overflow count is shown

#### Scenario: Escape restores the tab

- **WHEN** the user presses Escape in the search field (or clears it)
- **THEN** the previous tab body is shown again

#### Scenario: Tab switch keeps the query

- **WHEN** a query is present and the user switches tabs
- **THEN** `state.q` is unchanged and search mode remains
