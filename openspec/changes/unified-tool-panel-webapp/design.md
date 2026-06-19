## Context

The bound script `sidebar/程式碼.js` serves two sidebars: the cell-driven category drilldown (`showDrilldownSidebar` → `getDrilldownContext_` → `filterTransactions_` → `DrilldownSidebar.html`) and the self-contained TAG summary (`getTagSummary`/`getTagTransactions` → `TagSummarySidebar.html`). Both read via `SpreadsheetApp.getActiveSpreadsheet()`. This change unifies them into one full-page Web App.

## Goals / Non-Goals

**Goals:**
- One page (`ToolPanel.html`) with 類別 / TAG tabs, each: scope toggle → totals → drill-in → back.
- Category self-contained (column K manual, fallback G), like TAG.
- Single `開啟面板` menu item launching the Web App.
- Reuse `computeStats_`, the transaction row→object mapping, and the existing card/stat CSS.

**Non-Goals:**
- No change to the standalone ingestion/classification script.
- No Dashboard pivot dependency.

## Decisions

- **Web App context ⇒ `openById`, not `getActiveSpreadsheet()`.** A `doGet` request has no active spreadsheet, so a `getSpreadsheet_()` helper (`openById(CFG.SPREADSHEET_ID)`) backs every read; the existing TAG functions are refactored onto it too. *This is the single most important correctness point* — keeping `getActiveSpreadsheet()` would return null in the Web App and break every query.
- **Generalize the TAG "summary→detail" pattern to a `dimension`.** Category reuses the exact shape; category value = `rowCatManual || rowCatAuto` (K then G), matching the old `filterTransactions_`. Two pairs of functions (`getCategorySummary`/`getCategoryTransactions`, `getTagSummary`/`getTagTransactions`) keep server logic explicit and simple.
- **Menu launches via a dialog with a clickable link to `ScriptApp.getService().getUrl()`.** A Web App lives at its own URL; the spreadsheet can't host it inline. Resolving the URL at runtime avoids hardcoding; a clickable link (not auto `window.open`) avoids popup blockers — directly informed by the earlier Arc popup/cookie issue. *Alternative considered:* modal dialog hosting the panel inline — rejected because the user explicitly chose a standalone Web App.
- **Remove the superseded entry points** (`showDrilldownSidebar`, `getDrilldownContext_`, `showTagSummarySidebar`, `filterTransactions_`) and the two sidebar HTML files, so there's one code path. `computeStats_`, `currentYearMonth_`, `getTagColIndex_` are kept and reused.

## Risks / Trade-offs

- **Web App deployment + first-run auth is a manual step** → the `/exec` URL only exists after a Web App deployment (execute as me, access only myself), and the first open prompts for authorization. Documented in tasks; `getWebAppUrl()` reads the live URL so no redeploy-to-hardcode loop. Unlike the sidebar iframe, a full-page Web App is not third-party-framed, so Arc should open it without the cookie/popup issues seen before.
- **`CFG.SPREADSHEET_ID` hardcodes the bound spreadsheet's id** → acceptable (the script is bound to exactly that sheet); could be a Script Property later if needed.
- **Full-table scan per load/tab/scope/drill** → fine at personal-ledger scale; each call is one `getValues()` over the used range, as the existing functions already do.
