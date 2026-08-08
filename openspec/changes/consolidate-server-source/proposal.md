## Why

The server side of this project answers every question twice, and one of the two answers is
never executed.

`sidebar/程式碼.js` holds 34 top-level functions. Starting from the real entry points — `doGet`,
`onOpen`, and the four functions `ToolPanel.html` actually calls — 21 are reachable and **13 are
not**, directly or transitively. That is 207 of 682 lines (30%) that no user action can run. They
are the pre-v5 server-aggregation dashboard; the current page is a fat frontend that takes one
flat array from `getAllTxns` and aggregates client-side.

Dead code that merely sits there is cheap. This code is not sitting still:

- The 我的消費 change threaded its `mineIdx` parameter through **five** of the thirteen
  (`mapTxn_`, `periodSummary_`, `monthlyTrend_`, `getOverview`, `getTransactions`). That work runs
  nowhere.
- The offline server test asserts on `periodSummary_` and `monthlyTrend_` — coverage of code
  nobody executes, which makes the suite read as stronger than it is.
- It is a **second definition of a transaction**. `mapTxn_` formats the date as `MM/dd HH:mm`
  while `getAllTxns` sends numeric `y`/`m`/`d`. A future change that adds a time to the 待記帳
  queue would find `MM/dd HH:mm` first, edit it, and watch nothing happen.

The same duplication exists one level up, in the repo layout. `cards_transaction_bot.js` exists
twice: the root copy (1,000 lines, last changed 2026-06-19) and `sidebar/cards_transaction_bot.js`
(1,149 lines, last changed 2026-08-04). The root copy was deliberately kept as a rollback snapshot
at the bound-project cutover — and has since decayed past the point of being one. It has no
`parseFubonTransfer_` at all, so rolling back to it today would silently undo both 富邦-transfer
fixes. It also carries a live footgun: the repo root has its own `.clasp.json` pointing at the
**standalone** script id plus a `.claspignore` whose last line is `sidebar/**`, so a single
`clasp push` run from the repo root pushes the June bot to the retired standalone project.

A rollback you cannot safely roll back to is worse than none, because it is believed.

## What Changes

- **Delete the 13 unreachable functions** from `sidebar/程式碼.js`: `getOverview`,
  `getTransactions`, `getMonthSelectorRange`, `mapTxn_`, `periodSummary_`, `monthlyTrend_`,
  `inScope_`, `dataRows_`, `computeStats_`, `resolveScope_`, `dimKeyFn_`, `dimKeepFn_`,
  `currentYearMonth_`.
- **`showPanelLauncher` and `getWebAppUrl` stay.** A call-graph scan reports them unreachable and
  is wrong: `onOpen` names `showPanelLauncher` as a **string** in the sheet menu
  (`.addItem('開啟面板', 'showPanelLauncher')`), and `getWebAppUrl` is called from it. Deleting
  either breaks the sheet menu with nothing in the code to explain why.
- Drop the `periodSummary_` / `monthlyTrend_` assertions from the offline server test. The
  behaviour they guarded — statistics summing 我的消費 rather than the card amount — stays covered
  by the `getAllTxns` assertions, which test the path the dashboard actually takes.
- **Delete the repo root's `cards_transaction_bot.js`, `.clasp.json` and `.claspignore`**, leaving
  exactly one Apps Script project in the repo (`sidebar/`) and exactly one copy of the bot.
- Record in `CLAUDE.md` that this repo holds exactly one Apps Script project and that rollback for
  the bot is git history, not a second file in the tree.
- **No user-visible behaviour changes.** No function the page or the menu can reach is touched.

## Capabilities

### New Capabilities

- `server-data-api`: the contract the bound project's server layer keeps — one read plus three
  writes, one definition of a transaction, aggregation entirely client-side, and the menu entry
  point that is reached by name string rather than by call.
- `single-apps-script-project`: the repo hosts exactly one Apps Script project and exactly one copy
  of the bot, so there is no second place to push to and no in-tree snapshot pretending to be a
  rollback target.

### Modified Capabilities

<!-- None. The archived specs (category-config, custom-menu, drilldown-sidebar, tag-summary)
     describe the sheet-sidebar dashboard whose UI entry points were already removed by earlier
     changes; this change removes the last server-side remnants but changes no behaviour those
     specs still describe accurately. Reconciling that stale baseline is raised as an open
     question in design.md, not done here. -->

## Impact

- **`sidebar/程式碼.js`**: 207 lines removed (682 → ~475). Every remaining function is reachable
  from `doGet`, `onOpen` or one of the four `google.script.run` targets.
- **Repo root**: `cards_transaction_bot.js`, `.clasp.json`, `.claspignore` deleted. `clasp` can
  then only be run from `sidebar/`.
- **`CLAUDE.md`**: one short note under the Deploy section.
- **Offline server test** (scratchpad, not repo content): one assertion block removed.
- **Not touched**: `sidebar/ToolPanel.html`, `sidebar/cards_transaction_bot.js`,
  `check_sidebar.js`, `.github/workflows/deploy-dashboard.yml`, and every cloud-side object. The
  deploy path (push to `main` touching `sidebar/**` → gate → `clasp push -f` + pinned
  `clasp deploy`) is unchanged.
- **Cloud**: nothing. Deleting local files removes the way to push stale code to the standalone
  project; whether that project is itself deleted is the owner's call and out of scope.
