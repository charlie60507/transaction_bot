## Context

`deleteTxn` currently refuses any id that does not start with `manual-`. The dashboard mirrors that with `isManual` / `manualDelBtn`, so auto-recorded rows have no delete control. The sheet is the bot's only "already handled this mail" memory: `appendLast7DaysToSheet` builds three dedup sets (`existingKeySet`, `existingLooseKeySet`, `existingMessageIds`) from `Transactions` rows A–I. Delete a row inside the 7-day Gmail window and the next scheduled run records the mail again. Observed on a row deleted two days after its transaction.

The page already has an `.overlay` + `.modal` pattern (the add dialog). Row identity is the composite `txnKey_` (MessageId|time|amount|last4|occurrence), not bare MessageId — CT-16. Duplicate rows, the main reason this feature exists, share a base key and are numbered by occurrence; deleting one member of a group renumbers the rest.

`Transactions` is wider than the bot's `HEADER` (TAG, 我的消費 live past I). The bot reads `lastCol = HEADER.length`.

## Goals / Non-Goals

**Goals:**

- Any row shown on an edit surface can be deleted, after a confirmation.
- A deleted auto-row does not come back on the next bot run, including inside the 7-day window.
- `Transactions` stays "every row counts": analysis, heatmap, per-card totals, and any future budget feature keep reading it with no deleted-flag filter.
- After a successful delete, every remaining id the page holds is still valid.

**Non-Goals:**

- A UI to restore from `Deleted`. Recovery is moving the row back in the spreadsheet.
- Making search / category drilldown / 項目·TAG into edit surfaces.
- Making a posted 收入/轉帳 row reachable when it sits on a day with no 支出 (heatmap days are spending-only; recorded as known).
- Changing `getAllTxns` shape or adding a fifth `google.script.run` target.
- Soft-delete inside `Transactions` (a flag column).

## Decisions

### D1 — A `Deleted` sheet, not a flag column

`Transactions` keeps exactly the meaning it has today. A flag would be free in the dashboard and expensive everywhere else: every pivot, budget query, and human glance at the sheet would have to know to exclude it. The project already keeps `META` (and used to keep `category`); a second sheet is not a new concept.

*Alternative considered:* a `deleted` checkbox on `Transactions`, filtered in `getAllTxns`. Rejected: it taxes every reader of the sheet forever for a handful of deletes a year.

Recovery is moving the row back. No restore endpoint.

### D2 — One append covers all three dedup sets

The bot derives every dedup set from the same `existing` array. Concatenating `Deleted` rows onto `existing` before building the sets covers the strict key, the loose key, and the MessageId check at once. No second code path that can drift.

Two constraints, or dedup silently misfires:

- Copy the **entire** `Transactions` row into `Deleted`, not a subset — keys are computed from whole rows.
- When the bot reads `Deleted`, **align to `HEADER.length`** (pad short rows, slice long ones). The bot's `existing` is A–I; `Transactions` is wider.

A missing `Deleted` sheet is empty, never a throw. The recording path must not start failing because a sheet was renamed. `deleteTxn` creates the sheet (headers copied from `Transactions` row 1) on first use. The bot never creates it.

### D3 — Delete lives on `editRow` only

`editRow` is the component behind the heatmap day list and both 待記帳 states. The delete button there becomes unconditional. `txnRow` (search, category drilldown, 項目/TAG) loses the existing manual-only button, so "delete lives where you edit" has no exception. A manual row shown in search is the same row the heatmap day list shows — nothing becomes unreachable.

`isManual` stays: `distinctBanks()` still ranks by it.

### D4 — Confirm with the existing overlay; refresh on the same call

Deletion is rare. One extra tap is nothing against deleting the wrong row on a phone. Reuse `.overlay` / `.modal`; cancelling or tapping the backdrop changes nothing.

Do **not** only splice the row out of `TXNS`. `getAllTxns` numbers duplicate groups by occurrence; deleting one member stale-ids the rest, and the next delete matches nothing (`找不到`). Duplicate rows are the main thing this feature exists to delete, so a successful `deleteTxn` MUST replace `TXNS` with a current snapshot.

That snapshot is returned from `deleteTxn` itself (`{ ok, txns }`), not from a nested `getAllTxns` on the page. The nested call was the live bug: the write had already moved the row, then the second lookup failed and toasted 找不到 while the sheet was correct. Fail closed only when the write itself fails: overlay stays, list unchanged.

### D5 — `findRowByKey_` is the locate; unknown ids fail closed; already-deleted ids succeed

`deleteTxn` locates with the existing composite key. A key that matches nothing in `Transactions` and nothing in `Deleted` fails closed — does not hit a neighbour. That is the invariant to protect: an edit landing on the wrong transaction has already happened (CT-16), and a delete is not recoverable from the UI.

A key already on `Deleted` (same base: MessageId|time|amount|last4) and gone from `Transactions` is a retry after success, not a miss: return success and the current snapshot, do not toast 找不到.

The `manual-` prefix guard is removed. Error copy drops "手動".

## Risks / Trade-offs

- **Deleting the `Deleted` sheet brings the ghosts back.** It is load-bearing, not an archive. Note in `CLAUDE.md`. Mitigation: the bot treats a missing sheet as empty rather than crashing, so the failure mode is resurrection, not a broken run — visible, and the same as today's spreadsheet-delete behaviour.
- **Wrong-row deletion is the failure that matters.** `findRowByKey_` fails closed on a stale id. The confirmation overlay names merchant / amount / date so the owner sees which row before it goes. There is no undo in the UI.
- **`Deleted` header can lag if `Transactions` later gains a column.** First-create copies the header; a later extra column still appends (Apps Script extends the sheet) but the header cell may be blank. Dedup only needs A–I, which already exist. Accepted.
- **One class of row stays unreachable:** a posted 收入 or 轉帳, older than the 待記帳 lookback, on a day with no 支出. Recorded so it is not discovered as a surprise; not worth solving now.

## Migration Plan

No data migration. First delete creates `Deleted`. Existing `Transactions` rows are untouched until the owner deletes one.

Deploy is the normal path: merge to `main` triggers `clasp push -f` and pinned `clasp deploy`. Rollback is `git revert` of the commit plus a push. Rows already in `Deleted` stay there; after rollback the dashboard cannot delete auto-rows again, but it also will not move them back. Restoring a deleted row remains a spreadsheet move either way.

## Open Questions

None that block implementation. The unreachable 收入/轉帳 case is accepted, not deferred as a decision.
