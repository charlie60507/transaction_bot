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

`deleteTxn` SHALL copy the entire `Transactions` row onto a `Deleted` sheet (creating that sheet, with `Transactions` headers, if it does not exist), then remove the row from `Transactions`. It SHALL locate the row by the existing composite key. It SHALL accept any row, not only ids that start with `manual-`. A key that matches nothing in `Transactions` and nothing in `Deleted` SHALL fail closed without deleting a neighbour. A key that is already on `Deleted` and gone from `Transactions` SHALL succeed without modifying `Transactions` — that is a retry after success, not a miss.

`Transactions` SHALL keep the meaning that every row in it counts: `getAllTxns` SHALL NOT filter on a deleted flag, and no new column is added for this purpose.

#### Scenario: Auto-recorded row leaves Transactions

- **WHEN** the owner confirms delete on an auto-recorded row
- **THEN** that row is absent from `Transactions`
- **AND** the same values appear as a row on `Deleted`, column-aligned with `Transactions`

#### Scenario: First delete creates the sheet

- **WHEN** `Deleted` does not exist and the owner confirms a delete
- **THEN** `Deleted` is created with the `Transactions` header row
- **AND** the deleted row is appended to it

#### Scenario: Unknown id fails closed

- **WHEN** `deleteTxn` is called with a key that matches no `Transactions` row and no `Deleted` row
- **THEN** no row is deleted
- **AND** no other row is modified
- **AND** the page shows an error

#### Scenario: Already-deleted key is success

- **WHEN** `deleteTxn` is called with a key that matches no `Transactions` row, but whose base key (MessageId|time|amount|last4) already exists on `Deleted`
- **THEN** no `Transactions` row is modified
- **AND** the call succeeds
- **AND** the page does not show an error

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

A successful `deleteTxn` SHALL replace the page's transaction list with a current snapshot of `Transactions` (the same shape `getAllTxns` returns), so remaining rows — including other members of a duplicate group — keep ids that still match the sheet. That snapshot SHALL come back on the same call that performed the delete. The page SHALL NOT issue a second `getAllTxns` whose failure can toast an error after the row has already left `Transactions`.

If the row has left `Transactions`, the page SHALL treat the delete as success (no error toast), even when `deleteTxn` is invoked again with the same key.

#### Scenario: Two duplicate rows can both be deleted

- **WHEN** two `Transactions` rows share a base key and the owner deletes one, then the other, without a manual page reload
- **THEN** both deletes succeed

#### Scenario: Sheet write and page agree

- **WHEN** the owner confirms delete and the row leaves `Transactions`
- **THEN** the page toasts success, not an error
- **AND** the page's list no longer contains that row, without a manual reload
