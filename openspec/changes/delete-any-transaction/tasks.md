## 1. Server: deleteTxn moves the row (sidebar/程式碼.js)

- [x] 1.1 Add `CFG.DELETED_SHEET: 'Deleted'`. Helper `getOrCreateDeleted_(ss, src)`: return the sheet if it exists; otherwise insert it and copy `Transactions` row 1 as the header. If it exists but has fewer columns than `src`, copy the extra header cells. Verify: first call creates the tab; second call returns the same sheet.
- [x] 1.2 Rewrite `deleteTxn`: drop the `manual-` prefix guard; locate with `findRowByKey_`; copy the full row (`getLastColumn`) onto `Deleted` then `deleteRow` from `Transactions`. Return `{ ok, txns }` from the same call (no nested `getAllTxns`). A key already on `Deleted` succeeds; a key in neither sheet still throws. Verify: a non-`manual-` id is accepted; an unknown id throws and does not delete a neighbour; a retry after success does not throw.

## 2. Bot: Deleted counts as already seen (sidebar/cards_transaction_bot.js)

- [x] 2.1 After loading `existing` from `Transactions`, append rows from `Deleted` aligned to `HEADER.length` (pad short, slice long). Missing or empty `Deleted` appends nothing and does not throw. Build the three dedup sets from the combined array only — no second MessageId path. Verify: a Deleted row's MessageId is in `existingMessageIds`; renaming the sheet away still lets `appendLast7DaysToSheet` start.

## 3. Dashboard: confirm, delete anywhere on editRow, re-fetch (sidebar/ToolPanel.html)

- [x] 3.1 Add a delete confirmation overlay (reuse `.overlay` / `.modal`), showing merchant, amount, and date. Cancel and backdrop dismiss change nothing. Verify: tapping 🗑 without confirming does not call `deleteTxn`.
- [x] 3.2 `editRow` always shows the delete button (auto and manual). Remove `manualDelBtn` from `txnRow`. Keep `isManual` for `distinctBanks`. Verify: grep `data-del` / `txdel` hits `editRow` and the overlay wiring, not `txnRow`.
- [x] 3.3 On confirm: call `deleteTxn({ id })`; on success adopt `res.txns` and render; on failure toast and leave the list. Do not nest `getAllTxns`. Extract the existing boot map into a helper so boot and post-delete share it. Verify: two duplicate-group deletes in a row do not need a manual reload; a successful sheet write never toasts 找不到.

## 4. Docs and gate

- [x] 4.1 `CLAUDE.md`: note that `Deleted` is load-bearing — deleting the sheet resurrects auto-rows inside the 7-day window. English, with the other sheet caveats.
- [x] 4.2 `node check_sidebar.js` exits 0. The only `google.script.run` targets remain `getAllTxns`, `updateTxn`, `addTxn`, `deleteTxn`.
- [x] 4.3 `git diff` touches `sidebar/程式碼.js`, `sidebar/cards_transaction_bot.js`, `sidebar/ToolPanel.html`, `CLAUDE.md`, and this change's artifacts.

## 5. Live check (owner, after deploy)

- [ ] 5.1 Delete an auto-recorded row from the heatmap day list and from 待記帳 (both states); confirm it leaves `Transactions` and appears on `Deleted`.
- [ ] 5.2 Delete a row dated within the last 7 days, then wait for (or run) the bot; the row does not come back.
- [ ] 5.3 Delete one of two duplicate rows, then the other, without reloading the page.
- [ ] 5.4 Cancel a delete; nothing changes. Search / category / TAG panels show no delete button.
