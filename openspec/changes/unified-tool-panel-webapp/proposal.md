## Why

The two `交易工具` features live in separate sidebars with inconsistent UX: 查看明細 requires selecting a Dashboard pivot cell, while TAG 統計 is self-contained. Users want a single page that holds both — category and TAG — with the same self-contained "totals → drill in" flow, served as a full-page Web App rather than two narrow sidebars.

## What Changes

- Serve a single unified page (`ToolPanel.html`) as a modal dialog inside the spreadsheet, with two top tabs: 類別 and TAG.
- Each tab uses the proven TAG flow: 全部/當月 scope toggle → per-item totals (sorted desc) → click an item → its transactions + stats → 返回.
- **BREAKING (UX)**: the category view becomes self-contained — it no longer reads a selected Dashboard pivot cell.
- Collapse the menu to a single `開啟面板` item that opens the panel modal directly.
- Switch all server reads to `openById()` so the query functions work regardless of execution context.
- Remove the superseded sidebars and their entry points.

> Note: an earlier iteration of this change served the panel as a standalone Web App (`doGet`). That was reverted to a modal dialog because the deployer's multi-account browser session made the Web App `/exec` URL unreliable to open; the modal runs in-sheet under the account that already has the spreadsheet open. The change directory name retains the `-webapp` suffix for continuity.

## Capabilities

### New Capabilities
- `tool-panel`: A Web-App page that aggregates spend by category and by TAG (all-time / current month) and drills from any item into its transactions, plus the menu launcher that opens it.

### Modified Capabilities
- `custom-menu`: the `交易工具` menu collapses from `查看明細` + `TAG 統計` to a single `開啟面板` item.
- `drilldown-sidebar`: removed — the cell-selection category drilldown is superseded by the `tool-panel` 類別 tab.
- `tag-summary`: removed — the TAG sidebar is folded into the `tool-panel` TAG tab.

## Impact

- **Code (bound `sidebar/程式碼.js`)**: add `CFG.SPREADSHEET_ID` + `getSpreadsheet_()`; `showPanelLauncher` (modal); new `getCategorySummary`/`getCategoryTransactions`; refactor `getTagSummary`/`getTagTransactions` to `openById`; remove `showDrilldownSidebar`, `getDrilldownContext_`, `showTagSummarySidebar`, `filterTransactions_`; keep `computeStats_`, `currentYearMonth_`, `getTagColIndex_`.
- **UI**: new `sidebar/ToolPanel.html`; remove `sidebar/DrilldownSidebar.html` and `sidebar/TagSummarySidebar.html`.
- **Manifest**: no special manifest needed (modal dialog uses the standard container-bound auth; no Web App deployment).
- **Out of scope**: the standalone script (`cards_transaction_bot.js`) is untouched; the Dashboard pivot is no longer used by this panel.
