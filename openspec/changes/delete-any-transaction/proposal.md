## Why

Auto-recorded rows cannot be deleted from the dashboard (`deleteTxn` refuses anything whose MessageId does not start with `manual-`). Deleting one by hand in the spreadsheet does not work either: the sheet is the bot's only memory of "I have already handled this mail", so a row deleted inside the 7-day scan window comes back on the next run. This is observed, not theoretical.

## What Changes

- **Any row in an editable list can be deleted** — heatmap day list, and the 待記帳 queue in both 未記帳 and 已記帳. The delete button is no longer gated on `manual-`.
- **Deleting asks first**, reusing the existing `.overlay` pattern. Cancelling changes nothing.
- **Deleting moves the row to a `Deleted` sheet**, then removes it from `Transactions`. `Transactions` keeps its current meaning: every row in it counts. Recovery is moving the row back.
- **The bot treats `Deleted` as memory.** All three dedup sets (strict key, loose key, MessageId) are built from `Transactions` plus `Deleted`, so a deleted auto-row does not resurrect.
- **After a successful delete the page re-fetches** the transaction list. Duplicate rows share a base key and are distinguished by occurrence; deleting one renumbers the rest, so splicing locally leaves stale ids.
- **The manual-only delete button is removed from `txnRow`** (search, category drilldown, 項目/TAG). Delete lives where you edit.

Not **BREAKING** for stored values: `Transactions` rows that stay, stay. A missing `Deleted` sheet is treated as empty, never as an error.

## Capabilities

### New Capabilities

- `transaction-delete`: delete any transaction from an edit surface, persist it on a `Deleted` sheet so the bot will not re-record it, and refresh the page's ids afterwards.

### Modified Capabilities

None. `openspec/specs/` holds `category-config`, `custom-menu`, `drilldown-sidebar` and `tag-summary`, none of which describe delete.

## Impact

- `sidebar/程式碼.js`: `deleteTxn` drops the `manual-` guard; copies the full row to `Deleted` (creating the sheet with `Transactions` headers if needed); then deletes from `Transactions`.
- `sidebar/cards_transaction_bot.js`: when building `existing` for dedup, append `Deleted` rows aligned to `HEADER.length`. A missing `Deleted` sheet is empty, not a throw.
- `sidebar/ToolPanel.html`: unconditional delete on `editRow`; confirmation overlay; re-fetch `getAllTxns` on success; remove `manualDelBtn` from `txnRow`.
- `CLAUDE.md`: note that `Deleted` is load-bearing — deleting the sheet brings the ghosts back.
- No change to `getAllTxns` shape, no new `google.script.run` target, no new column on `Transactions`. Deploy path unchanged.
