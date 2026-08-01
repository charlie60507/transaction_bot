## ADDED Requirements

### Requirement: Auto-record pipeline hosted in the bound project

The Gmail-driven auto-record and auto-categorize pipeline (`appendLast7DaysToSheet` and its parsers/classifiers) SHALL be hosted in the single bound Apps Script project alongside the dashboard, menu, and sidebar. It SHALL continue to read the same Transactions spreadsheet, append transactions, and auto-categorize new rows exactly as before the consolidation, with no loss of its dedup behavior (strict key, loose key, and MessageId).

#### Scenario: Pipeline runs from the bound project

- **WHEN** `appendLast7DaysToSheet` runs in the bound project (manually or via a time trigger)
- **THEN** it searches Gmail, parses 富邦 and 國泰 notifications, dedups against existing rows, and appends only new transactions
- **AND** new rows are auto-categorized (rule-based, with Gemini fallback when the API key is present)

#### Scenario: No duplicate records across the move

- **WHEN** the pipeline is run again over an overlapping time window (e.g. during cutover)
- **THEN** transactions already present are not re-appended (strict / loose / MessageId dedup)

### Requirement: Auto-recorded transfers carry 收支別 = 轉帳

When the pipeline records a 國泰 transfer (帳戶間轉帳), the transaction's 收支別 (column J) SHALL be written as 轉帳, not defaulted to 支出. Non-transfer card consumption SHALL continue to default 收支別 (J) to 支出 when empty. This keeps auto-recorded transfers consistent with the dashboard, which identifies transfers solely by 收支別 (J) = 轉帳.

#### Scenario: Transfer row marked as 轉帳

- **WHEN** a 國泰 transfer notification is recorded
- **THEN** its 收支別 (J) is 轉帳
- **AND** the dashboard counts it as a transfer, excluded from 支出

#### Scenario: Card consumption still defaults to 支出

- **WHEN** an ordinary card-consumption row is recorded with an empty 收支別
- **THEN** its 收支別 (J) is set to 支出
