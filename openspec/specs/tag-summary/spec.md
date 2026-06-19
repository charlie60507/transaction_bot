## Purpose

A menu-driven sidebar (`交易工具 → TAG 統計`) that aggregates transaction spend by TAG — all-time or current month — and lets the user drill from a TAG into its individual transactions. Lives in the bound script and reuses the existing drilldown's stats and presentation.

## Requirements

### Requirement: TAG 統計 menu entry

The `交易工具` menu SHALL contain a `TAG 統計` item that opens the TAG-summary sidebar, in addition to the existing `查看明細` item. The existing `查看明細` behavior MUST be unchanged.

#### Scenario: Menu item present

- **WHEN** the spreadsheet is opened
- **THEN** the `交易工具` menu shows both `查看明細` and `TAG 統計`
- **WHEN** the user clicks `交易工具 → TAG 統計`
- **THEN** the TAG-summary sidebar opens

### Requirement: Per-TAG spend totals

The sidebar SHALL list every distinct TAG with its summed amount and transaction count, sorted by total descending. Totals are computed from the Transactions `TAG` column (located by header name) and the amount column (E). Rows with a blank TAG MUST be excluded.

#### Scenario: Totals listed highest-first

- **WHEN** the sidebar loads
- **THEN** each non-blank TAG appears once with its total spend and count
- **AND** rows are ordered from highest total to lowest

#### Scenario: TAG column not found

- **WHEN** the Transactions sheet has no `TAG` header
- **THEN** the sidebar shows an error state instead of totals

#### Scenario: No tagged transactions

- **WHEN** no transaction has a TAG value (in the active scope)
- **THEN** the sidebar shows an empty state

### Requirement: All-time / current-month scope toggle

The sidebar SHALL offer a toggle between 全部 (all-time) and 當月 (current calendar month, TZ Asia/Taipei). Switching the toggle recomputes the per-TAG totals for the selected scope. The default on open is 全部.

#### Scenario: Switch to current month

- **WHEN** the user selects 當月
- **THEN** the totals and counts reflect only transactions whose date (column C) falls in the current year and month

#### Scenario: Default scope

- **WHEN** the sidebar first loads
- **THEN** it shows all-time totals

### Requirement: Drill from a TAG into its transactions

Clicking a TAG in the overview SHALL show that TAG's individual transactions for the active scope, reusing the transaction-card presentation and summary stats, with a control to return to the overview.

#### Scenario: View a TAG's transactions

- **WHEN** the user clicks a TAG row
- **THEN** the sidebar shows that TAG's transactions (in the active scope) as cards, plus summary stats

#### Scenario: Return to overview

- **WHEN** the user activates the back control from a TAG's detail view
- **THEN** the sidebar returns to the per-TAG overview in the same scope
