## Context

Two duplications, one theme: the server can answer every question twice, and the repo can push
the bot to two places.

**The code.** `sidebar/程式碼.js` (682 lines, 34 top-level functions) still contains the pre-v5
dashboard's server-aggregation layer — `getOverview` / `getTransactions` and their helpers — even
though the v5 page is a fat frontend that calls `getAllTxns` once and does every aggregation in
the browser. The old layer is not called from anywhere. It has, however, kept being maintained:
the 我的消費 change threaded `mineIdx` through five of its functions.

**The repo.** `cards_transaction_bot.js` exists at the repo root and under `sidebar/`. The root
copy was frozen at the bound-project cutover (2026-08-01) and kept as a rollback snapshot; the
cutover commit says so in as many words. Since then two 富邦-transfer fixes landed in `sidebar/`
only. The root copy also comes with its own `.clasp.json` (standalone script id `18WyCJz…`) and a
`.claspignore` ending in `sidebar/**`.

**Evidence gathered before writing this** (measured in this worktree, not taken from the issue):

| claim | how it was checked | result |
|---|---|---|
| the page calls exactly four server functions | `check_sidebar.js`'s own paren-aware scanner, `CHECK_VERBOSE=1` | `getAllTxns`, `updateTxn`, `addTxn`, `deleteTxn` — and nothing else |
| 13 functions are unreachable | closure over the call graph from `doGet`, `onOpen`, `showPanelLauncher`, and those four | 21 of 34 reachable; the remaining 13 match the list exactly |
| each is referenced only inside the dead set | `git grep <name>` per function, whole repo | every hit is a definition or a call from another of the 13 |
| `showPanelLauncher` is alive | `git grep showPanelLauncher` | line 35, as the **string** `'showPanelLauncher'` in `.addItem('開啟面板', …)` |
| `getWebAppUrl` is alive | `git grep getWebAppUrl` | called from `showPanelLauncher` |
| how much code this is | line spans 324–353, 506–597, 598–682 | **207 lines of 682 (30%)**, not the ~220 / 32% the issue estimates |
| the root bot is stale | `git log -1`, `wc`, `grep -c parseFubonTransfer_` | root: 1,000 lines, 2026-06-19, **0** occurrences; sidebar: 1,149 lines, 2026-08-04, 3 |
| what a rollback would undo | `git log -- sidebar/cards_transaction_bot.js` | two 富邦-transfer fixes, `f7f86b3` and `c469e46`, both after the cutover |
| CI only touches `sidebar/` | `.github/workflows/deploy-dashboard.yml` | `paths: sidebar/**`, `working-directory: sidebar` |

## Goals / Non-Goals

**Goals:**

- One reachable definition of every server behaviour, so an edit lands where it runs.
- One Apps Script project in the repo, so `clasp` has exactly one target.
- One copy of the bot, with an honest rollback story.
- Zero user-visible behaviour change: the dashboard and the sheet menu behave exactly as today.

**Non-Goals:**

- Reviving server-side aggregation, or moving any aggregation off the client. The fat frontend is
  the current architecture; this change accepts it rather than re-litigating it.
- Touching `sidebar/ToolPanel.html`, `sidebar/cards_transaction_bot.js`, `check_sidebar.js`, or
  the deploy workflow.
- Any cloud-side action. Deleting the retired standalone Apps Script project is the owner's call.
- Reconciling the stale archived specs (see Open Questions).

## Decisions

**D1 — Delete by an explicit, hand-verified list; never by a tool.** The obvious mechanisation —
point a "remove unused exports" / dead-code tool at the file — is **rejected**, and this is the
single most important decision here. Apps Script resolves several entry points by *name string*,
not by call: `onOpen` registers the menu item as `.addItem('開啟面板', 'showPanelLauncher')`, and
time triggers name their handler the same way. Every call-graph tool reports `showPanelLauncher`
(and through it `getWebAppUrl`) as unreachable. Deleting them removes the sheet's 交易工具 →
開啟面板 menu action, and nothing in the source would explain the loss. So: the deleted set is the
13 names written out in the proposal, and the rule for any future sweep of this file is to grep
each candidate as a **bare string** as well as a call before removing it.

**D2 — The roots of the reachability proof are `doGet`, `onOpen`, and the four
`google.script.run` targets.** `doGet` is the web-app entry, `onOpen` is the simple trigger, and
the four writes/reads are what the page can invoke. Nothing else can enter this file from outside.
The four were not taken on trust from the issue: they were read out of `check_sidebar.js`'s own
scanner, which is the same code that gates CI, so the proof and the gate agree by construction.

**D3 — Accept the "an Apps Script global could be called from outside the repo" risk.** These are
project-global functions, so in principle something outside version control (a custom formula, a
manual run, a trigger) could call `getOverview` or `getMonthSelectorRange`. Weighed and accepted:
all thirteen return objects or arrays of objects, which makes them useless as sheet formulas; the
only client of this project's server layer is `ToolPanel.html`; and the standalone bot project —
the one other thing that ever ran — is a separate project that cannot see these globals at all.
The mitigation is that the whole change is one `git revert` away, not that the risk is zero.

**D4 — Delete the dead assertions rather than keep the functions alive for the test.** The
alternative — keep `periodSummary_` / `monthlyTrend_` because they are the only server functions
with behavioural tests — is **rejected**: it inverts the relationship. Tests exist to protect
behaviour the product has; here the test was protecting the last user of code the product does not
have. The behaviour those assertions actually cared about (statistics sum 我的消費, not the card
amount) is asserted on `getAllTxns` in the same file, which is the path the dashboard takes. After
the edit the suite is smaller and strictly more honest.

**D5 — Two commits, code first, in this order.** Commit 1 is the only one that touches `sidebar/`,
so it is the only one that can trigger a deploy or fail the gate; keeping it alone makes a bisect
unambiguous and makes `git revert` of the risky half a single, clean operation. Commit 2 touches
only repo-root files and `CLAUDE.md`, matches no path in the workflow's `paths:` filter, and
therefore deploys nothing. Doing them in one commit would tie a no-op repo-hygiene change to a
live deploy for no benefit.

**D6 — Rollback for the bot is git history; the in-tree snapshot is deleted, the cloud project is
not.** Keeping the root copy is **rejected** on its own terms: it was kept to be a rollback target
and it can no longer serve as one — it predates `parseFubonTransfer_` entirely, so restoring it
would silently reintroduce two fixed 富邦-transfer defects. Git already holds every version of the
bot, addressable and diffable, and `git revert` of a bad commit followed by the normal push-to-
deploy path is both safer and the path already used for everything else in this repo. Deleting the
local files is also what removes the footgun: with the root `.clasp.json` gone there is no longer
a `clasp push` that reaches the standalone project. The retired cloud project itself is untouched
— that deletion is the owner's, and no code change can verify its trigger state.

**D7 — Say what stays, not just what goes.** `sidebar/程式碼.js` keeps `rowCategory_`,
`getTagColIndex_`, `getMineColIndex_`, `headerRow_`, `ensureMineColIndex_`, `rowMine_`,
`cellDateTime_`, `lastDataRow_`, `insertPositionForDate_`, `txnKey_`, `findRowByKey_`,
`getSpreadsheet_` and `nowYMD_` — all reachable from the four client entry points. Two of them
(`rowCategory_`, `getTagColIndex_`) are also called by functions being deleted, which is exactly
the kind of shared helper a careless deletion takes with it. They must survive.

## Risks / Trade-offs

- [A deletion tool or a future sweep removes `showPanelLauncher` / `getWebAppUrl`, silently
  breaking the sheet menu] → D1: explicit list, and a grep-for-the-bare-string rule recorded in
  the spec so the constraint outlives this change.
- [A shared helper is deleted along with its dead callers, breaking a live path] → D7 names the
  survivors; `node check_sidebar.js` must exit 0 and the offline server test must pass before the
  commit, and the dashboard must be exercised after the deploy.
- [Something outside the repo calls one of the 13 globals] → D3; reversible with `git revert`.
- [The offline gate does not check reachability, so it cannot catch a wrong deletion] → true, and
  deliberate: the gate proves that every `google.script.run` target still resolves, which is the
  half that matters. The menu path has no offline check at all, which is why the sheet menu is an
  explicit manual acceptance step.
- [Deleting the root copy removes the only rollback the owner believed they had] → the copy was
  already not a rollback (D6); `CLAUDE.md` gains the note that says where rollback actually lives,
  so the belief is replaced rather than merely removed.
- [Someone later re-adds a server-side aggregation helper "just for this one stat"] → the
  `server-data-api` spec states the one-read/three-writes contract, so the next such addition is a
  visible spec change rather than a quiet 200-line regrowth.

## Migration Plan

Both commits are pure deletions plus one doc note; there is no data migration and no cloud step.

1. **Commit 1** — edit `sidebar/程式碼.js` only. Gate: `node check_sidebar.js` exits 0, the
   offline server test passes, `git grep` finds no remaining reference to any of the 13 names.
2. Pushing commit 1 to `main` triggers the existing workflow (gate → `clasp push -f` → pinned
   `clasp deploy`). No manual deploy.
3. **Verify on the live dashboard**: it loads and renders, a transaction can be edited (split,
   category, 收支, TAG, 記帳), and the sheet's 交易工具 → 開啟面板 menu item still opens the panel.
   The menu item is the check that only a human can make.
4. **Commit 2** — delete the three repo-root files and add the `CLAUDE.md` note. Matches no path
   in the workflow filter, so it deploys nothing. Verify `clasp status` still works from
   `sidebar/`.

**Rollback:** `git revert` of either commit, independently. Commit 1's revert redeploys through
the normal path; commit 2's revert restores files that nothing reads.

## Open Questions

- **The archived spec baseline is already stale, and this change makes that visible.**
  `openspec/specs/custom-menu`, `drilldown-sidebar` and `tag-summary` describe a sheet-sidebar
  dashboard (`查看明細`, `TAG 統計`, a `Dashboard` pivot sheet) whose UI entry points no longer
  exist in `sidebar/程式碼.js` — the menu has only 開啟面板. `drilldown-sidebar` even specifies the
  transaction card date as `02/15 14:30`, i.e. `mapTxn_`'s `MM/dd HH:mm`, which is the exact
  divergent second definition this change deletes. So the spec baseline is itself a third source
  of truth. Reconciling it (REMOVED deltas, or an archive pass) is real work with its own
  judgement calls and is deliberately **not** folded into this change. Raised for the owner.
- **The repo root also carries `appsscript.json`**, the standalone project's manifest. It is part
  of the same footprint as the two clasp files but is not in this change's delete list. Harmless
  once `.clasp.json` is gone (nothing reads it), but it is a leftover. Include or leave — owner's
  call.
- **`README.md` documents the root clasp workflow** ("`.clasp.json`: points to your Script ID;
  already present in this repo", then `clasp push` / `clasp run appendLast7DaysToSheet` from the
  root). After commit 2 those instructions point at a project the repo can no longer reach. A
  minimal correction is to say `sidebar/`; a full rewrite (the README does not mention the
  dashboard at all) is a separate job. Flagged, not scoped.
- **Manual, owner-only:** confirm in the Apps Script UI that the standalone project's trigger
  really is off *today*. The cutover commit records that it was removed on 2026-08-01; that is a
  record of what was done then, not of the state now, and nothing in the repo can verify it.
