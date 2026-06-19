## 1. Server API (sidebar/程式碼.js)

- [x] 1.1 `CFG.SPREADSHEET_ID` + `getSpreadsheet_()` → `openById` (Web App context).
- [x] 1.2 `resolveScope_(scope)` handling `'all' | 'month' | 'YYYY-MM'`; `dimKeyFn_(dimension, sh)` (category = K∥G, tag = TAG col or error).
- [x] 1.3 `getOverview(dimension, scope)` → `{ items, grandTotal, period, trend }`: per-item totals + `periodSummary_` (all in-scope rows) + `monthlyTrend_` (last 6 months).
- [x] 1.4 `getTransactions(dimension, name, scope)` → `{ name, scope, stats, transactions }`.
- [x] 1.5 `getMonthSelectorRange()` → `{ minYear, maxYear, curYear, curMonth }`.

## 2. Web App entry + menu (sidebar/程式碼.js + appsscript.json)

- [x] 2.1 `appsscript.json`: `"webapp": { access: MYSELF, executeAs: USER_DEPLOYING }`.
- [x] 2.2 `doGet(e)` serves `ToolPanel`; `getWebAppUrl()` → `ScriptApp.getService().getUrl()`.
- [x] 2.3 `onOpen` single `開啟面板` → `showPanelLauncher()` (dialog with clickable Web App link, no auto popup).

## 3. Dashboard UI (sidebar/ToolPanel.html)

- [x] 3.1 Modern dashboard CSS (cards, blue accent, neutral bg, responsive `max-width`).
- [x] 3.2 Top bar: 類別/TAG tabs + 全部/當月 + 年▾月▾ selectors (mutually exclusive).
- [x] 3.3 KPI cards (總支出/筆數/日均/最大筆) from `period`.
- [x] 3.4 Charts: inline-SVG distribution donut (top 6 + 其他, legend, center total) + 6-month trend bars (selected month highlighted).
- [x] 3.5 Toolbar: name search + sort (金額/筆數/名稱); list re-renders in place from cached data.
- [x] 3.6 Item rows (color dot + bar matching donut); click → detail.
- [x] 3.7 Detail: stats header + merchant search + transaction cards + 返回.
- [x] 3.8 Init: `getMonthSelectorRange()` → `getOverview('category','all')`.

## 4. Deploy + verify

- [x] 4.1 `node --check` + `clasp push` the bound project (temp `.clasp.json` `rootDir:""`).
- [ ] 4.2 Re-deploy / update the Web App deployment (execute as me, access only myself) so `/exec` serves the new `doGet`; authorize. **(USER)**
- [ ] 4.3 Open `/exec` (incognito / charlie60507 profile): KPI numbers, donut + trend charts, 類別/TAG tabs, 全部/當月/年+月 scope (mutually exclusive), search + 3 sorts, drill-in + merchant search + 返回, empty/error states. **(USER)**
- [x] 4.4 Sync `sidebar/` to git; commit + push.
