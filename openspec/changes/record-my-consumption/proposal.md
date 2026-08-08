## Why

Some card charges are not entirely the owner's own consumption: money is fronted for other people. A NT$7,000 restaurant charge may be only NT$2,000 of personal spending, with NT$5,000 coming back later.

A `Transactions` row carries one amount (E) and every aggregation sums it verbatim, so every fronted dollar is counted as the owner's spending — the 分析 category breakdown, the 趨勢 monthly line and the heatmap day totals are all inflated. At ~5 such rows in ~100 a month, at the NT$7,000 scale, this is tens of thousands of NT$ of noise per month, not rounding error.

The goal is **statistics only**: the dashboard should say 2,000, not 7,000. Who owes whom, whether they have paid, and how the money moves back are explicitly out of scope.

## What Changes

- Add one `Transactions` column, **`我的消費`**, holding the part of a charge that was actually the owner's own consumption. Blank means the whole charge is theirs.
- **Every statistic sums 我的消費 instead of the card amount.** Normalisation happens once, server-side, in `getAllTxns()` / the legacy aggregation helpers — the page's dozen aggregation sites keep summing `t.amount` and become correct without individual edits.
- **收支別 and 種類 are untouched.** A split row is still `支出` and still `餐飲`; only the number being summed changes.
- **The amount itself is the split control** in the editable row (`editRow`): tapping it opens an inline editor asking 「這筆有多少是我自己的？」. A row that is not split renders exactly as it does today — no new field, no new button.
- The card amount stays visible as `刷 7,000` next to the netted figure, wherever a single transaction is shown; three aggregate surfaces annotate what was excluded (heatmap day header, category card, 總支出 KPI).
- The field is **not capped** at the card amount: the reverse case is real (someone else fronts part of the owner's share), and then consumption legitimately exceeds the charge.

## Capabilities

### New Capabilities
- `my-consumption-split`: declare how much of a charge was the owner's own consumption, have every statistic use that number, and edit it from the transaction row without adding a field to rows that do not need one.

### Modified Capabilities
<!-- No existing capability spec changes: 收支別, 種類 and the 已記帳 queue behave exactly as before. -->

## Impact

- **sidebar/程式碼.js**: `CFG.HDR_MINE`; `getMineColIndex_()` and `rowMine_()`; `getAllTxns()` returns `amount` (netted), `charged`, `mine`; `updateTxn` accepts `mine`; `mapTxn_`, `periodSummary_`, `monthlyTrend_`, `getOverview`, `getTransactions` sum the netted value.
- **sidebar/ToolPanel.html**: `editRow` amount becomes the split trigger plus an inline editor; `txnRow` and the day header show the split; 總支出 KPI and category cards annotate what was excluded; `applySplit()` writes back optimistically.
- **Sheet**: one new header cell, `我的消費`. Located by header NAME (like `TAG`), never a fixed index — a fixed index would collide with the TAG column that already lives past K.
- No new sheets, no bot changes, no external service. Deploy to the live deployment (`AKfycbyv…`).
