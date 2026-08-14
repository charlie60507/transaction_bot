## ADDED Requirements

### Requirement: Heatmap cells with any transaction are clickable

When the spend heatmap is shown for a single month, a day cell SHALL be a hit (clickable, `data-hday` set) if and only if the day is not in the future and at least one transaction of any 收支別 falls on that day. Days with no rows, and future days in the current month, SHALL stay inert. Color intensity SHALL remain expense-only (sum of `type === 支出` amounts vs the month's peak).

#### Scenario: Income-only day is a hit

- **WHEN** a non-future day has only 收入 (or only 轉帳) and no 支出
- **THEN** the cell is clickable and opens `dayEditor` for that day

#### Scenario: Empty day stays inert

- **WHEN** a non-future day has no transactions
- **THEN** the cell is not clickable and has no hit marker

#### Scenario: Future day stays inert

- **WHEN** the active month is the current month and a day is after today
- **THEN** that cell stays inert even if mock data were present

#### Scenario: Expense day keeps intensity and no extra dot

- **WHEN** a non-future day has 支出
- **THEN** the cell uses expense intensity as today, has no muted dot, and is clickable

#### Scenario: Zero-net 我的消費 expense day is still clickable

- **WHEN** a non-future day's only 支出 rows net to `$0` via 我的消費
- **THEN** the cell is clickable (the rows exist)

### Requirement: Income/transfer-only days show a muted dot

A hit day that has no 支出 row SHALL render a 4px muted dot inside the cell and SHALL NOT add a new border meaning. Expense days SHALL NOT get the dot.

#### Scenario: Payday shows a dot, spend day does not

- **WHEN** day A has only 收入 and day B has 支出
- **THEN** A shows the muted dot and B does not

### Requirement: 有消費 count and captions stay honest

"有消費 N 天" SHALL count only days whose expense total is greater than zero. Heatmap hint text SHALL say that days with transactions are clickable, and MUST NOT claim every cell is clickable.

#### Scenario: Payday does not inflate 有消費

- **WHEN** the month contains expense days and income-only days
- **THEN** "有消費 N 天" equals the number of days with 支出 total `> 0`

#### Scenario: Caption no longer says every cell is clickable

- **WHEN** the heatmap is rendered
- **THEN** the hint text does not contain "點任一格"
