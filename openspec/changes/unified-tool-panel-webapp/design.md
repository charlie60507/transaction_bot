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

- **Reads via `openById`, not `getActiveSpreadsheet()`.** A `getSpreadsheet_()` helper (`openById(CFG.SPREADSHEET_ID)`) backs every read; the existing TAG functions are refactored onto it too. This was originally required because the panel was a Web App (`doGet` has no active spreadsheet); it is retained for the modal version since `openById` works in every context and keeps the query functions portable.
- **Modal dialog, not Web App (revised).** The panel is shown via `showModalDialog` inside the spreadsheet. *Originally* served as a Web App, but the deployer's multi-account browser made the `/exec` URL route to the wrong account index (`/u/N`) and fail; a modal runs in-sheet under the account that already has the spreadsheet open, sidestepping all URL/account-routing issues. The Web App proved functional in a single-account (incognito) session — the pivot is about reliable everyday access, not correctness.
- **Generalize the TAG "summary→detail" pattern to a `dimension`.** Category reuses the exact shape; category value = `rowCatManual || rowCatAuto` (K then G), matching the old `filterTransactions_`. Two pairs of functions (`getCategorySummary`/`getCategoryTransactions`, `getTagSummary`/`getTagTransactions`) keep server logic explicit and simple.
- **Menu launches via a dialog with a clickable link to `ScriptApp.getService().getUrl()`.** A Web App lives at its own URL; the spreadsheet can't host it inline. Resolving the URL at runtime avoids hardcoding; a clickable link (not auto `window.open`) avoids popup blockers — directly informed by the earlier Arc popup/cookie issue. *Alternative considered:* modal dialog hosting the panel inline — rejected because the user explicitly chose a standalone Web App.
- **Remove the superseded entry points** (`showDrilldownSidebar`, `getDrilldownContext_`, `showTagSummarySidebar`, `filterTransactions_`) and the two sidebar HTML files, so there's one code path. `computeStats_`, `currentYearMonth_`, `getTagColIndex_` are kept and reused.

## Risks / Trade-offs

- **Web App deployment + first-run auth is a manual step** → the `/exec` URL only exists after a Web App deployment (execute as me, access only myself), and the first open prompts for authorization. Documented in tasks; `getWebAppUrl()` reads the live URL so no redeploy-to-hardcode loop. Unlike the sidebar iframe, a full-page Web App is not third-party-framed, so Arc should open it without the cookie/popup issues seen before.
- **`CFG.SPREADSHEET_ID` hardcodes the bound spreadsheet's id** → acceptable (the script is bound to exactly that sheet); could be a Script Property later if needed.
- **Full-table scan per load/tab/scope/drill** → fine at personal-ledger scale; each call is one `getValues()` over the used range, as the existing functions already do.
