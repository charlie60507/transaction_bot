## ADDED Requirements

### Requirement: Editable per-day transaction list

When the user opens a day from the spend heatmap, that day's transactions SHALL be shown as a list where each row exposes, inline and without any expand step, a 類別 dropdown, a 收支別 dropdown (支出/收入/轉帳), and a TAG dropdown, plus an 已記帳 action. The list SHALL include all of that day's transactions regardless of 收支別 (so income and transfers are editable too).

#### Scenario: Inline controls visible at a glance

- **WHEN** the user opens a day with transactions
- **THEN** each row shows its 類別 / 收支別 / TAG as directly-usable dropdowns and an 已記帳 button, with no click-to-edit step

#### Scenario: Category options come from existing categories

- **WHEN** the 類別 dropdown is shown
- **THEN** its options are the distinct categories already present in the data, plus the row's current value if not among them

### Requirement: Edits write back to the Sheet by MessageId

Changing a row's 類別, 收支別, or TAG SHALL write the new value back to the corresponding Sheet cell for that transaction — 類別 to K (手動種類, leaving the auto value in G untouched), 收支別 to J, TAG to the TAG column — locating the row by its MessageId (column I), never by row position. The write SHALL happen per change so edits persist without requiring the user to mark 已記帳.

#### Scenario: Category change persists to K

- **WHEN** the user picks a new 類別 for a transaction
- **THEN** column K for that MessageId's row is set to the chosen category
- **AND** column G (auto) is unchanged

#### Scenario: Row located by MessageId, not position

- **WHEN** the bot has re-sorted the sheet since the data was loaded
- **THEN** an edit still updates the correct row (matched by MessageId)

#### Scenario: Target row missing

- **WHEN** no row matches the MessageId (e.g. deleted)
- **THEN** the write fails, the UI reverts the change, and an error is shown

### Requirement: 已記帳 removes the row from the day queue

Marking a transaction 已記帳 SHALL write 已記帳 (column A) = true for that row and remove it from the day list, which by default shows only un-recorded (已記帳 = false) transactions. A toggle SHALL reveal already-recorded rows (shown dimmed) with an action to un-record (set 已記帳 = false), bringing the row back into the queue.

#### Scenario: Recording hides the row

- **WHEN** the user marks a transaction 已記帳
- **THEN** column A for that row becomes checked
- **AND** the row is removed from the default day list

#### Scenario: Reveal and undo

- **WHEN** the user toggles "show recorded"
- **THEN** already-recorded rows appear dimmed with an un-record action
- **WHEN** the user un-records one
- **THEN** column A becomes unchecked and the row returns to the queue

#### Scenario: 已記帳 does not affect analytics

- **WHEN** transactions are marked 已記帳
- **THEN** the dashboard's totals, donut, ranking, and heatmap still count them

### Requirement: Optimistic update with revert on failure

Edits SHALL update the on-screen state immediately and issue the write asynchronously. On write failure the UI SHALL revert to the pre-edit value and surface an error; on success no further action is needed.

#### Scenario: Snappy edit

- **WHEN** the user changes a field
- **THEN** the row reflects the change at once, before the write completes

#### Scenario: Failure reverts

- **WHEN** the write to the Sheet fails
- **THEN** the row reverts to its previous value and an error message is shown
