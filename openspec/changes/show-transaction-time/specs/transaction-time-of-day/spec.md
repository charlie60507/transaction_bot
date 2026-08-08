## ADDED Requirements

### Requirement: The dashboard receives each transaction's time of day

`getAllTxns()` SHALL send, for every transaction, a `hm` field holding the time of day of the 授權日期時間 cell (column C) formatted as `HH:mm` in `CFG.TZ`, or the empty string when the cell carries no time. A cell whose value is exactly midnight in `CFG.TZ` MUST be reported as carrying no time, because a date-only cell and a midnight datetime are indistinguishable by value. The decision MUST NOT depend on the cell's number format.

#### Scenario: A transaction authorised at a known time

- **WHEN** a row's 授權日期時間 cell holds 2026/07/14 21:25:37
- **THEN** its `hm` is `'21:25'`
- **AND** the seconds are not reported

#### Scenario: A legacy date-only transaction

- **WHEN** a row's 授權日期時間 cell holds a date with no time
- **THEN** its `hm` is `''`

#### Scenario: Midnight is reported as no time

- **WHEN** a row's 授權日期時間 cell holds a datetime whose hours, minutes and seconds are all zero in `CFG.TZ`
- **THEN** its `hm` is `''`, exactly as for a date-only cell

#### Scenario: The number format is irrelevant

- **WHEN** the 授權日期時間 column is formatted `yyyy/mm/dd hh:mm:ss` but a row's value carries no time
- **THEN** its `hm` is still `''`

#### Scenario: The time is formatted in the sheet timezone

- **WHEN** the script's own timezone differs from `CFG.TZ`
- **THEN** `hm` and the midnight test both follow `CFG.TZ`, so a row is never shown one time while being classified by another

### Requirement: The editable transaction row shows the time

The editable row component — which serves BOTH the 待記帳 queue and the heatmap day list — SHALL display a transaction's time of day next to its bank badge, styled as secondary information. A transaction with no time MUST render exactly as it does today, with nothing in that position. The read-only transaction row used by the category drilldown and by search results MUST be unchanged and MUST continue to show the date only.

#### Scenario: A timed row in the 待記帳 queue

- **WHEN** a transaction with a time is listed in the 待記帳 queue
- **THEN** its row shows the time after the bank badge, dim and small

#### Scenario: The heatmap day list shows the same

- **WHEN** the same transaction is listed in the heatmap day list
- **THEN** it shows the time there too, because both surfaces render one shared row component

#### Scenario: A row with no time

- **WHEN** a transaction whose `hm` is `''` is listed on either surface
- **THEN** no time and no placeholder is rendered, and the row is visually identical to before this capability

#### Scenario: Read-only surfaces are untouched

- **WHEN** a transaction is listed in the category drilldown or in search results
- **THEN** it shows its date as before and no time of day

### Requirement: A day is ordered by time, then by amount descending

Wherever the transactions of a single day are listed — the 待記帳 queue and the heatmap day list, which SHALL apply one shared comparator rather than a copy each — the rows SHALL be ordered by `hm` ascending and then by amount descending. The amount tiebreak is mandatory: without it, every transaction that carries no time would compare equal and a day of such rows would fall back to the order they happen to arrive in.

#### Scenario: A day with times reads chronologically

- **WHEN** a day holds a 425 lunch at 12:10, a 130 coffee at 15:02 and a 7,337 dinner at 19:40
- **THEN** the rows are listed lunch, coffee, dinner, on both surfaces

#### Scenario: A legacy day is ordered exactly as it is today

- **WHEN** a day holds only transactions with no time
- **THEN** the rows are ordered by amount descending, i.e. identically to before this capability

#### Scenario: A day mixing timed and untimed rows

- **WHEN** a day holds both kinds
- **THEN** the untimed rows come first, ordered by amount descending among themselves, followed by the timed rows in chronological order

#### Scenario: Two transactions in the same minute

- **WHEN** two transactions share the same `hm`
- **THEN** the larger amount is listed first

#### Scenario: Both surfaces agree

- **WHEN** the same day is viewed in the 待記帳 queue and in the heatmap day list
- **THEN** its rows appear in the same order in both

### Requirement: A manual entry may record a time, or honestly record none

The manual add dialog SHALL offer an optional time field alongside the required date. When a time is given, the transaction SHALL be stored as that date and time. When it is left empty, the transaction SHALL be stored as a date-only value whose cell is formatted without a time component, so that it is indistinguishable from a legacy row. A manual entry MUST NOT be given a fabricated time.

#### Scenario: Adding a transaction with a time

- **WHEN** the user adds a cash transaction dated 2026/08/08 with the time 19:40
- **THEN** the row is stored with that date and time
- **AND** it shows `19:40` and sorts chronologically within 8 August

#### Scenario: Adding a transaction without a time

- **WHEN** the user adds a cash transaction and leaves the time field empty
- **THEN** the row is stored as a date-only value, its cell is formatted `yyyy/mm/dd`
- **AND** the row shows no time and sorts before that day's timed rows

#### Scenario: No transaction is stamped with an invented time

- **WHEN** a manual transaction is added with no time
- **THEN** it is NOT stored as midday, as the current clock time, or as any other manufactured value

#### Scenario: The row does not jump after saving

- **WHEN** a manual transaction has been added and the page renders it optimistically
- **THEN** it occupies the same position it takes once the server's stored row is loaded

### Requirement: A page loaded before this capability keeps working

The page SHALL treat a missing `hm` as `''`, so a client served before the matching server version behaves exactly as it did before this capability.

#### Scenario: Stale client, new comparator

- **WHEN** transaction data arrives with no `hm` field
- **THEN** no time is rendered anywhere, and every day sorts by amount descending, as before
