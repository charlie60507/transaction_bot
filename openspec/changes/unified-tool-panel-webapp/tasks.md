## 1. Server plumbing (sidebar/程式碼.js)

- [x] 1.1 Add `CFG.SPREADSHEET_ID = '1PZfUiqaMeUHHSBi8zqEPnEgBfFXqTxKwhnQUltCb8VU'` and `getSpreadsheet_()` → `SpreadsheetApp.openById(CFG.SPREADSHEET_ID)`.
- [x] 1.2 Refactor `getTagSummary` / `getTagTransactions` to read via `getSpreadsheet_()` instead of `getActiveSpreadsheet()`.

## 2. Category query functions (sidebar/程式碼.js)

- [x] 2.1 Add `getCategorySummary(scope)`: totals by category (value = K manual, fallback G auto), scope `'all'`/`'month'` by col C date; return `{ scope, items:[{name,total,count}] desc, grandTotal }`; skip blank-category rows.
- [x] 2.2 Add `getCategoryTransactions(name, scope)`: rows whose `rowCatManual || rowCatAuto === name` (+ scope), newest-first, mapped to the transaction-card object shape; `stats` via `computeStats_`.

## 3. Web App entry + menu (sidebar/程式碼.js + appsscript.json)

- [x] 3.1 `appsscript.json`: add `"webapp": { "access": "MYSELF", "executeAs": "USER_DEPLOYING" }`.
- [x] 3.2 Add `doGet(e)`: return `HtmlService.createTemplateFromFile('ToolPanel').evaluate().setTitle('交易工具').addMetaTag('viewport','width=device-width, initial-scale=1')`.
- [x] 3.3 Add `getWebAppUrl()` → `ScriptApp.getService().getUrl()`.
- [x] 3.4 Replace `onOpen` menu with a single `.addItem('開啟面板', 'showPanelLauncher')`; add `showPanelLauncher()` opening a modal dialog with a clickable `target=_blank` link to `getWebAppUrl()`.
- [x] 3.5 Remove `showDrilldownSidebar`, `getDrilldownContext_`, `showTagSummarySidebar`, `filterTransactions_`; keep `computeStats_`, `currentYearMonth_`, `getTagColIndex_`.

## 4. Unified page (sidebar/ToolPanel.html)

- [x] 4.1 Create `ToolPanel.html` reusing the existing CSS (header / stat-box / card / badge / footer / toggle / row+bar), widened with a centered `max-width` for full-page.
- [x] 4.2 Top tabs 類別 / TAG (default 類別); per tab the overview↔detail two-layer flow + 全部/當月 toggle + `← 返回`.
- [x] 4.3 Data via `google.script.run`: on load `getCategorySummary('all')`; tab/scope switch re-fetches the right `get{Category,Tag}Summary`; row click calls `get{Category,Tag}Transactions`. Empty + error states.

## 5. Cleanup + deploy + verify

- [x] 5.1 Delete `sidebar/DrilldownSidebar.html` and `sidebar/TagSummarySidebar.html`.
- [x] 5.2 `node --check` then `clasp push` the bound project (temp `.clasp.json` `rootDir:""`).
- [ ] 5.3 Deploy as Web App (execute as me, access only myself), authorize, get the `/exec` URL. **(USER)**
- [ ] 5.4 Reopen sheet → `交易工具 → 開啟面板` → link opens panel; verify 類別/TAG tabs, 全部/當月 toggle, drill-in + stats, 返回, empty/error states. **(USER)**
- [x] 5.5 Sync `sidebar/` to git; commit + push.
