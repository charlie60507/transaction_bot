## Why

The web dashboard currently answers "which category / which project did money go to" but three high-value, purely-computed views are missing: which card was used, when in the month spending clusters, and how each category moved versus last month. All three are derivable from the existing `getAllTxns()` data with no budgets, no AI, and no external calls — they are pure additive value on data already loaded in the browser.

## What Changes

- Add a **per-card spending panel**: group the active scope's expenses by card (bank + last-4), showing each card's total, share %, transaction count, and average per transaction, sorted by total descending.
- Add a **spend calendar heatmap**: for a single calendar month, a 7-column day grid where each day's cell intensity encodes that day's total spend, plus peak day / days-with-spend / daily-average summary. Future days (beyond "today" in the current month) render inert.
- Add a **category ranking with month-over-month change**: rank the active month's expense categories by total, each with a ▲▼ delta versus the *same-period* previous month (compared day-for-day when the current month is partial, so a mid-month view is not unfairly compared against a full prior month).
- All three are **expense-only** and respect the existing income/expense/transfer separation — transfers (收支別 = 轉帳) and income are excluded, consistent with the rest of the dashboard.
- No backend contract change is expected: `getAllTxns()` already returns `bank`, `last4`, `y/m/d`, `amount`, `cat`, and `type` per transaction.

Explicitly **out of scope** (user declined): month-end run-rate projection, anomaly detection, and subscription-change tracking.

## Capabilities

### New Capabilities
- `dashboard-analysis-panels`: three additive, client-side dashboard views (per-card spending, spend calendar heatmap, category month-over-month ranking) computed from the existing transaction feed, expense-only, honoring the current scope model.

### Modified Capabilities
<!-- None — the existing category/project dashboard behavior is unchanged; these are additive panels. -->

## Impact

- **sidebar/ToolPanel.html** (frontend): a new third `分析` tab (`analysisTab()`) hosting the three panels, plus their render functions and markup; reuses existing dark cool-slate tokens, `fmt`/`esc`/`median` helpers, scope model (`resolveScope`/`inScope`/`prevScope`), and the expense/income/transfer predicates. The 分析 tab shares the 類別 scope controls. The heatmap supports click-to-preview a day's transactions.
- **sidebar/程式碼.js** (backend): expected unchanged. If any needed field turns out to be missing from `getAllTxns()`, that becomes a small, explicitly-flagged addition in design/tasks.
- No new sheets, no new deployments-model change (same clasp push + existing Web App deployment), no external services, no new dependencies.
