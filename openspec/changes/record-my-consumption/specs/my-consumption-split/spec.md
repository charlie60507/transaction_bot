## ADDED Requirements

### Requirement: 我的消費 column defines what every statistic counts

The `Transactions` sheet SHALL carry a `我的消費` column, located by header NAME, holding the portion of a charge that was the owner's own consumption. A blank cell MUST mean the entire charge was theirs. Every spend statistic — period totals, category totals, the monthly trend, heatmap day totals and cell intensity, per-card totals and TAG totals — SHALL sum this value rather than the card amount (E). 收支別 and 種類 MUST be unaffected by the split.

#### Scenario: A partially fronted charge counts at the owner's share

- **WHEN** a NT$7,000 charge categorised 餐飲 has `我的消費` set to 2,000
- **THEN** it contributes 2,000 to the period total, to the 餐飲 total, to its month's trend point, and to its day's heatmap total
- **AND** its 收支別 is still `支出` and its 種類 is still `餐飲`

#### Scenario: A blank cell counts the whole charge

- **WHEN** a transaction's `我的消費` cell is blank
- **THEN** the full card amount is counted, exactly as before this column existed

#### Scenario: Zero is not blank

- **WHEN** a transaction's `我的消費` is the number `0`
- **THEN** it contributes 0 to every statistic
- **AND** it is NOT treated as an unsplit row

#### Scenario: The column is absent from the sheet

- **WHEN** the `Transactions` sheet has no `我的消費` header
- **THEN** every transaction reads as entirely the owner's own, i.e. the dashboard behaves as it did before this capability

### Requirement: Consumption may exceed the charge

`我的消費` SHALL NOT be capped at the card amount, because the owner's share is sometimes fronted by someone else, making their consumption larger than their own charge. Values above the charge MUST be accepted and counted; only negative and non-numeric values are rejected.

#### Scenario: Someone else fronted part of the owner's share

- **WHEN** the owner enters 5,000 against a 3,000 charge
- **THEN** the value is written and 5,000 is counted
- **AND** an inline note explains that it exceeds the card amount

#### Scenario: Invalid input is refused

- **WHEN** a negative or non-numeric value is submitted
- **THEN** the write is rejected with an error and the cell is unchanged

### Requirement: The split is edited from the amount, adding nothing to unsplit rows

In the editable transaction row (the 待記帳 queue and the heatmap day list, which share one component) the amount SHALL be the control that opens an inline split editor. A transaction with no split MUST render exactly as it did before this capability — no additional field, button or marker. The editor SHALL ask for the owner's own consumption and MUST commit only on explicit confirmation, never on blur.

#### Scenario: Opening and committing a split

- **WHEN** the owner taps the amount on a 7,000 charge and enters 2000
- **THEN** the row shows 2,000 with the card amount as `刷 7,000`
- **AND** the value is written back to the `我的消費` cell

#### Scenario: Clearing a split

- **WHEN** the editor is submitted with an empty value
- **THEN** the cell is cleared and the row returns to its unsplit appearance

#### Scenario: Declaring the whole charge

- **WHEN** the owner enters exactly the card amount
- **THEN** a blank cell is stored, because "all of it was mine" is what blank already means

#### Scenario: A row that needs no split is untouched

- **WHEN** a transaction has never been split
- **THEN** its row is visually identical to before this capability, and no split editor is shown

#### Scenario: Cancelling does not write

- **WHEN** the editor is dismissed with Esc or 取消
- **THEN** nothing is written and the previous value stands

### Requirement: Split transactions show the card amount, and aggregates show what was excluded

Wherever a single transaction's amount is displayed — the 待記帳 queue, the heatmap day list, the category drilldown and search results — a split transaction SHALL show the counted figure together with the card amount. The heatmap day header, the category card and the 總支出 KPI SHALL additionally report the excluded total, and MUST omit that annotation when nothing was excluded.

#### Scenario: The card amount stays visible for reconciliation

- **WHEN** a split transaction is listed in any of the four detail surfaces
- **THEN** it shows the counted amount alongside the amount the card was actually charged

#### Scenario: Aggregate surfaces report the exclusion

- **WHEN** a period contains fronted money
- **THEN** the 總支出 KPI, the affected category card and the affected heatmap day header report how much was excluded

#### Scenario: No annotation when nothing was excluded

- **WHEN** a transaction's consumption equals or exceeds its charge
- **THEN** no "代墊 … 未計入" annotation is shown for it
