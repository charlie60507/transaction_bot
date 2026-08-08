## 1. Backend (sidebar/程式碼.js)

- [x] 1.1 Add `CFG.HDR_MINE = '我的消費'` (a header NAME, not an index — see D5)
- [x] 1.2 Add `getMineColIndex_(sh)` mirroring `getTagColIndex_`; returns -1 when the header is absent
- [x] 1.3 Add `rowMine_(row, mineIdx)`: blank/null/undefined ⇒ the charge; negative or non-numeric ⇒ the charge; otherwise the declared value, uncapped
- [x] 1.4 `getAllTxns()`: `amount` becomes the netted consumption; add `charged` (card amount) and `mine` (raw declaration, null when not split)
- [x] 1.5 `updateTxn`: accept `mine` — blank clears the cell, negatives and non-numbers throw, over-the-charge values are written; throw a clear error when the column is absent
- [x] 1.6 `mapTxn_`, `periodSummary_`, `monthlyTrend_`, `getOverview`, `getTransactions`: sum the netted value
- [x] 1.7 `addTxn`: unchanged behaviour; the returned optimistic object carries `charged` and `mine: null`

## 2. Frontend — display (sidebar/ToolPanel.html)

- [x] 2.1 `boot`: default `charged`/`mine` so a page served before the matching server version behaves as it did
- [x] 2.2 Helpers `isSplitTxn` / `chargedOf` / `advOf` / `advIn` / `splitMark`; `advOf` clamps at 0 (D9)
- [x] 2.3 `txnRow`: append `刷 X` on split rows (one component — category drilldown AND search results)
- [x] 2.4 `dayEditor` header: annotate `刷卡 $X` when the day contains fronted money
- [x] 2.5 總支出 KPI sub-line: `刷卡 $X · 代墊 $Y 不計入`
- [x] 2.6 Category card meta: `代墊 $Y 未計入`
- [x] 2.7 CSS for `.amtbtn` / `.split` / `.orig` / `.adv`, reusing existing tokens (`--warn` for the marker, since `--spend` is taken)

## 3. Frontend — the split editor

- [x] 3.1 `editRow`: the amount becomes a `.amtbtn` (renders as plain text; dashed underline on hover only)
- [x] 3.2 `splitBox(t)`: inline editor asking 「這筆有多少是我自己的？」, with the card amount as a hint
- [x] 3.3 `applySplit(id, raw)`: blank clears; a value equal to the charge stores blank; updates `mine` AND `amount` locally, then `updateTxn(id,{mine})` with revert on failure
- [x] 3.4 Wire the amount / 確定 / 取消, Enter to commit, Esc to cancel — never commit on blur (D8)
- [x] 3.5 Live non-blocking note when the value exceeds the charge (D6)
- [x] 3.6 Look up the open editor via `.split .sin` rather than an id-built selector — the row id is a composite key containing `|`

## 4. Verify & deploy

- [x] 4.1 `node check_sidebar.js` — parse, `google.script.run` targets, `CFG.*` references
- [x] 4.2 Offline behaviour harness (stubbed SpreadsheetApp): blank-vs-real-zero, uncapped values, missing column inert on read and loud on write, 收支別 whitelist still refuses 代墊, aggregation totals net correctly — 22/22
- [ ] 4.3 Add the `我的消費` header cell to the Transactions sheet
- [ ] 4.4 Live check: split a real charge → confirm the sheet cell, then the 分析 total, heatmap cell, category card and search row all show the netted figure; clear it → row returns to its previous appearance
