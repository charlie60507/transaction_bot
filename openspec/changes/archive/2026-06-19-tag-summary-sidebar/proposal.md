## Why

The `交易工具` menu can drill into a month+category's transactions, but there is no equivalent view for TAGs. Users tag transactions (manual dropdown sourced from `META!E2:E`) but currently have no in-sheet way to see how much they've spent per TAG. They want a menu-driven sidebar — mirroring the existing drilldown — that totals spend by TAG and lets them click a TAG to see its individual transactions.

## What Changes

- Add a `TAG 統計` item to the existing `交易工具` menu.
- New `showTagSummarySidebar()` opens a sidebar that, on load, lists every TAG with its total spend and transaction count, sorted highest-first.
- A 全部 / 當月 toggle switches the stats between all-time and the current calendar month (TZ Asia/Taipei).
- Clicking a TAG drills into that TAG's individual transactions (reusing the existing transaction-card UI), with a back button to the overview.
- All server-side reads are scoped to the bound script and reuse the existing `CFG`, `filterTransactions_` mapping, and `computeStats_`.

## Capabilities

### New Capabilities
- `tag-summary`: A menu-driven sidebar that aggregates transaction spend by TAG (all-time or current month) and drills from a TAG into its individual transactions.

### Modified Capabilities
<!-- None. The custom-menu capability gains a new item, but the existing 查看明細 behavior is unchanged; the new behavior is captured wholly under tag-summary. -->

## Impact

- **Code (bound `sidebar/程式碼.js`)**: add the menu item in `onOpen`; new `showTagSummarySidebar()`, `getTagSummary(scope)`, `getTagTransactions(tag, scope)`, and helper `getTagColIndex_(sh)`.
- **UI**: new `sidebar/TagSummarySidebar.html` (reuses `DrilldownSidebar.html` styling).
- **Deploy**: push the bound Apps Script project (`1P4l2…`); sync `sidebar/` to the repo.
- **Out of scope / untouched**: the existing 查看明細 flow, the Dashboard pivot, and the standalone script `cards_transaction_bot.js`. No Dashboard TAG pivot is created.
