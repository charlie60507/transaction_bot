## ADDED Requirements

### Requirement: Any row on an edit surface can be deleted

Every transaction shown by `editRow` — the heatmap day list, and the 待記帳 queue in both its 未記帳 and 已記帳 states — SHALL expose a delete control, including auto-recorded rows. Search results, category drilldown, and the 項目/TAG panel SHALL NOT expose a delete control.

#### Scenario: Auto-recorded row in the heatmap day list

- **WHEN** the owner opens a heatmap day that contains an auto-recorded transaction
- **THEN** that row shows a delete control

#### Scenario: Both 待記帳 states

- **WHEN** the owner views the 待記帳 queue in 未記帳 or in 已記帳
- **THEN** every row in that list shows a delete control

#### Scenario: Statistics surfaces stay read-only

- **WHEN** a transaction appears in search results, a category drilldown, or the 項目/TAG panel
- **THEN** it has no delete control

### Requirement: Deleting asks first

A delete SHALL not run until the owner confirms it in an overlay. Cancelling or dismissing the overlay SHALL change nothing on the sheet and nothing on the page.

#### Scenario: Confirm deletes

- **WHEN** the owner taps delete and then confirms
- **THEN** the server delete runs

#### Scenario: Cancel changes nothing

- **WHEN** the owner taps delete and then cancels or dismisses the overlay
- **THEN** the transaction remains in `Transactions` and remains on the page

### Requirement: Deleting moves the row to Deleted, not a flag

`deleteTxn` SHALL copy the entire `Transactions` row onto a `Deleted` sheet (creating that sheet, with `Transactions` headers, if it does not exist), then remove the row from `Transactions`. It SHALL locate the row by the existing composite key. It SHALL accept any row, not only ids that start with `manual-`. A key that matches nothing SHALL fail closed without deleting a neighbour.

`Transactions` SHALL keep the meaning that every row in it counts: `getAllTxns` SHALL NOT filter on a deleted flag, and no new column is added for this purpose.

#### Scenario: Auto-recorded row leaves Transactions

- **WHEN** the owner confirms delete on an auto-recorded row
- **THEN** that row is absent from `Transactions`
- **AND** the same values appear as a row on `Deleted`, column-aligned with `Transactions`

#### Scenario: First delete creates the sheet

- **WHEN** `Deleted` does not exist and the owner confirms a delete
- **THEN** `Deleted` is created with the `Transactions` header row
- **AND** the deleted row is appended to it

#### Scenario: Stale id fails closed

- **WHEN** `deleteTxn` is called with a key that matches no `Transactions` row
- **THEN** no row is deleted
- **AND** no other row is modified

#### Scenario: Manual rows still delete

- **WHEN** the owner confirms delete on a manually added row
- **THEN** that row leaves `Transactions` and appears on `Deleted` the same way as an auto-recorded row

### Requirement: The bot does not resurrect a deleted row

When building its dedup index, the bot SHALL treat rows on `Deleted` as already seen, using the same three checks it uses for `Transactions` (strict key, loose key, MessageId). A missing `Deleted` sheet SHALL be treated as empty, never as an error.

#### Scenario: Deleted auto-row stays gone after the next run

- **WHEN** an auto-recorded row dated within the last 7 days has been moved to `Deleted`
- **AND** the bot's scheduled scan runs
- **THEN** that mail is not appended to `Transactions` again

#### Scenario: Missing Deleted sheet does not break the run

- **WHEN** the `Deleted` sheet is absent
- **THEN** the bot's recording run still completes
- **AND** it dedups against `Transactions` only

### Requirement: After a successful delete the page refreshes ids

A successful `deleteTxn` SHALL be followed by a fresh `getAllTxns` that replaces the page's transaction list, so remaining rows — including other members of a duplicate group — keep ids that still match the sheet.

#### Scenario: Two duplicate rows can both be deleted

- **WHEN** two `Transactions` rows share a base key and the owner deletes one, then the other, without a manual page reload
- **THEN** both deletes succeed
