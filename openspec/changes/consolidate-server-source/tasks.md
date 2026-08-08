## 1. Re-prove reachability before deleting anything

- [x] 1.1 List the client entry points from the gate itself, not from this document:
      `CHECK_VERBOSE=1 node check_sidebar.js` and read the `google.script.run.<fn>() → resolved`
      lines. Expect exactly `getAllTxns`, `updateTxn`, `addTxn`, `deleteTxn`. If the list differs,
      STOP — the delete set below is wrong.
- [x] 1.2 Take the roots to be `doGet`, `onOpen`, `showPanelLauncher`, and the four from 1.1, and
      close the call graph over `sidebar/程式碼.js`. Confirm exactly 13 functions are unreachable:
      `getOverview`, `getTransactions`, `getMonthSelectorRange`, `mapTxn_`, `periodSummary_`,
      `monthlyTrend_`, `inScope_`, `dataRows_`, `computeStats_`, `resolveScope_`, `dimKeyFn_`,
      `dimKeepFn_`, `currentYearMonth_`.
- [x] 1.3 For each of the 13, run `git grep <name>` over the whole repo and confirm every hit is
      either its own definition or a call from another of the 13. Any hit from `ToolPanel.html`,
      `cards_transaction_bot.js` or a workflow means the function is alive — remove it from the set.
- [x] 1.4 Confirm the two false positives stay: `git grep showPanelLauncher` must show the bare
      string `'showPanelLauncher'` in `onOpen`'s `.addItem('開啟面板', …)`, and `getWebAppUrl` must
      show a call from `showPanelLauncher`. Neither is deleted.
- [x] 1.5 Write down the helpers that are shared between the dead set and the live set and must
      survive: `rowCategory_` and `getTagColIndex_` (both also called by `getAllTxns` /
      `updateTxn` / `addTxn`).

## 2. Commit 1 — delete the unreachable server code

- [x] 2.1 In `sidebar/程式碼.js`, delete the three contiguous spans that hold the 13 functions and
      their doc comments: `dataRows_` / `inScope_` / `mapTxn_`; `currentYearMonth_` through
      `monthlyTrend_`; and the `Public API` section banner through `getMonthSelectorRange` (end of
      file). Delete nothing outside those spans.
- [x] 2.2 Confirm the survivors are intact: `rowMine_`, `rowCategory_`, `getTagColIndex_`,
      `getMineColIndex_`, `headerRow_`, `ensureMineColIndex_`, `cellDateTime_`, `lastDataRow_`,
      `insertPositionForDate_`, `txnKey_`, `findRowByKey_`, `getSpreadsheet_`, `nowYMD_`,
      `getWebAppUrl`, `showPanelLauncher` — plus the six entry points.
- [x] 2.3 Check the file no longer has a dangling section header or a comment describing a deleted
      function, and that the remaining comment density matches the rest of the file.
- [x] 2.4 Drop the `aggregations use my consumption` assertion block (the only `periodSummary_` /
      `monthlyTrend_` assertions) from the offline server test, leaving a one-line note saying why.
      *(Done while authoring this change; the test is a scratchpad file, not repo content.)*
- [x] 2.5 Run the offline server test with `node` and confirm it exits 0 with no failures — the
      `getAllTxns` / `rowMine_` / `updateTxn` assertions must all still pass.
- [x] 2.6 Run `node check_sidebar.js` and **check the exit code is 0**. Do not pipe it through
      `head`/`tail`; that hides the failure list and the status.
- [x] 2.7 `git grep -n` each of the 13 names again: no hits anywhere in the repo.
      *Zero hits in code (`git grep -- ':!openspec'` → 0 for all 13). Hits remain in the
      OpenSpec change docs of `record-my-consumption`, `unified-tool-panel-webapp` and the
      `2026-06-19-tag-summary-sidebar` archive — those record what those changes did at the
      time and are deliberately left alone; rewriting them would falsify history.*
- [x] 2.8 Commit — `sidebar/程式碼.js` only, no other repo file in the diff.

## 3. Verify commit 1 on the live dashboard (after it deploys)

- [ ] 3.1 Push and let `.github/workflows/deploy-dashboard.yml` run (gate → `clasp push -f` →
      pinned `clasp deploy`). Do not deploy by hand.
      *The branch is pushed and the PR is open, but the workflow only fires on `main`, so
      nothing has deployed yet. This unblocks when the PR is merged.*
- [ ] 3.2 Open the dashboard: it loads and renders 分析, 趨勢, the heatmap, and the 待記帳 queue.
- [ ] 3.3 Edit one transaction end to end: split (我的消費), 種類, 收支, TAG, 記帳 — each write
      lands in the sheet and the page reflects it.
- [ ] 3.4 **[owner]** In the spreadsheet, click 交易工具 → 開啟面板 and confirm the dialog opens
      with a working link. This is the check that would have caught deleting `showPanelLauncher`,
      and no offline gate covers it.

## 4. Commit 2 — one Apps Script project, one bot

- [x] 4.1 Confirm once more that the root copy is the stale one before deleting it:
      `grep -c parseFubonTransfer_ cards_transaction_bot.js sidebar/cards_transaction_bot.js`
      (expect 0 at the root, non-zero under `sidebar/`).
- [x] 4.2 `git rm` the repo-root `cards_transaction_bot.js`, `.clasp.json` and `.claspignore`.
      *Removed with plain `rm`, not `git rm`, so nothing is staged — staging commit 2's
      deletions while commit 1 sat unstaged would have handed the committing stage a
      pre-mixed index.*
- [x] 4.3 Touch nothing under `sidebar/` and nothing in `.github/` in this commit.
- [x] 4.4 Add a short note to `CLAUDE.md` (under Deploy): this repo holds exactly one Apps Script
      project, in `sidebar/`, so `clasp` is only ever run from there; and rollback for the bot is
      git history — no frozen second copy is kept in the tree, because the one that was kept
      decayed past the point of being safe to restore.
- [x] 4.5 Confirm `clasp status` (or `clasp push --dry-run`) still resolves from `sidebar/`, and
      that there is no remaining `.clasp.json` outside `sidebar/`.
- [x] 4.6 Confirm the commit's paths match none of the workflow's `paths:` entries, so it deploys
      nothing.
- [x] 4.7 Commit. Commit 2 = `cards_transaction_bot.js`, `.clasp.json`, `.claspignore`
      (deleted) + `CLAUDE.md` + `README.md`.

## 5. Close out

- [x] 5.1 Re-read the acceptance list on the issue and tick each item against what was actually
      observed, not against what was changed.
      *Observed offline: `node check_sidebar.js` exits 0; the offline server test exits 0 with
      29 passed / 0 failed and no assertion on a deleted function; `git grep` finds no code
      reference to any of the 13. NOT observed and still open: the dashboard loading/editing
      and the 交易工具 → 開啟面板 menu item, both of which need the deploy to have happened
      (tasks 3.2–3.4).*
- [ ] 5.2 **[owner]** Confirm in the Apps Script UI that the standalone project's time trigger is
      off today. The repo can only show that it was removed at cutover, not that it still is.
- [ ] 5.3 Raise the three findings recorded in `design.md` § Open Questions — the stale archived
      specs, the leftover root `appsscript.json`, and `README.md`'s root-clasp instructions — as
      their own follow-ups rather than folding them in here.
      *`README.md` was NOT deferred in the end — review pulled it into commit 2. It told the
      reader to run `clasp login` / `clasp push` / `clasp run appendLast7DaysToSheet` from the
      repo root and described the root `.clasp.json` as "already present", both of which this
      very commit falsifies; leaving the repo's front door contradicting the note added to
      CLAUDE.md by the same commit is the opposite of one source of truth. The clasp commands
      now run from `sidebar/`. Still deferred and unfixed: the orphaned root `appsscript.json`
      (present, now read by nothing) and the three archived specs describing the removed sheet
      sidebar.*
- [ ] 5.4 Archive this OpenSpec change once the dashboard and the sheet menu have been observed
      working after the deploy.
