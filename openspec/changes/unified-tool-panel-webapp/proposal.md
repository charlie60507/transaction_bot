## Why

The two `交易工具` features live in separate sidebars with inconsistent UX: 查看明細 requires selecting a Dashboard pivot cell, while TAG 統計 is self-contained. Users want a single page that holds both — category and TAG — with the same self-contained "totals → drill in" flow, served as a full-page Web App rather than two narrow sidebars.

## What Changes

- Serve a single unified page via a Web App `doGet` (`ToolPanel.html`) with two top tabs: 類別 and TAG.
- Each tab uses the proven TAG flow: 全部/當月 scope toggle → per-item totals (sorted desc) → click an item → its transactions + stats → 返回.
- **BREAKING (UX)**: the category view becomes self-contained — it no longer reads a selected Dashboard pivot cell.
- Collapse the menu to a single `開啟面板` item that opens a launcher dialog linking to the Web App URL.
- Switch all server reads from `getActiveSpreadsheet()` to `openById()` (a Web App `doGet` has no active spreadsheet).
- Remove the superseded sidebars and their entry points.

## Capabilities

### New Capabilities
- `tool-panel`: A Web-App page that aggregates spend by category and by TAG (all-time / current month) and drills from any item into its transactions, plus the menu launcher that opens it.

### Modified Capabilities
- `custom-menu`: the `交易工具` menu collapses from `查看明細` + `TAG 統計` to a single `開啟面板` item.
- `drilldown-sidebar`: removed — the cell-selection category drilldown is superseded by the `tool-panel` 類別 tab.
- `tag-summary`: removed — the TAG sidebar is folded into the `tool-panel` TAG tab.

## Impact

- **Code (bound `sidebar/程式碼.js`)**: add `CFG.SPREADSHEET_ID` + `getSpreadsheet_()`; `doGet`, `getWebAppUrl`, `showPanelLauncher`; new `getCategorySummary`/`getCategoryTransactions`; refactor `getTagSummary`/`getTagTransactions` to `openById`; remove `showDrilldownSidebar`, `getDrilldownContext_`, `showTagSummarySidebar`, `filterTransactions_`; keep `computeStats_`, `currentYearMonth_`, `getTagColIndex_`.
- **UI**: new `sidebar/ToolPanel.html`; remove `sidebar/DrilldownSidebar.html` and `sidebar/TagSummarySidebar.html`.
- **Manifest/deploy**: `appsscript.json` gains a `webapp` block; deploy as a Web App (execute as me, access only myself) and authorize once.
- **Out of scope**: the standalone script (`cards_transaction_bot.js`) is untouched; the Dashboard pivot is no longer used by this panel.
