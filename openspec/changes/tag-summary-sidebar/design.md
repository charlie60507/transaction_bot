## Context

The bound script `sidebar/程式碼.js` owns the `交易工具` menu (`onOpen`, :29) and the category drilldown: `showDrilldownSidebar` → `getDrilldownContext_` (reads a Dashboard pivot cell) → `filterTransactions_` (:101, filters Transactions by month+category) → `computeStats_` (:137) → rendered by `DrilldownSidebar.html`. After the META merge, TAG lives in a Transactions column named `TAG` (manual dropdown from `META!E2:E`); amount is col E, date is col C.

This change adds a parallel TAG view. Unlike the category drilldown (which keys off a user-maintained Dashboard pivot and a selected cell), the TAG summary is self-contained: it scans Transactions directly, so it needs no Dashboard pivot and no cell selection.

## Goals / Non-Goals

**Goals:**
- A `TAG 統計` menu item opening a sidebar with per-TAG totals (sorted desc), a 全部/當月 toggle, and click-through to a TAG's transactions.
- Reuse existing infra (`CFG`, `filterTransactions_` mapping, `computeStats_`, `DrilldownSidebar.html` styling).

**Non-Goals:**
- No change to `查看明細`, the Dashboard pivot, or the standalone script.
- No Dashboard TAG pivot.

## Decisions

- **Self-contained scan, not a Dashboard pivot.** The summary reads Transactions and aggregates in code, so the user maintains nothing extra. *Alternative considered:* a month×TAG Dashboard pivot + cell-based drilldown (exact mirror of categories) — rejected as more setup/maintenance for the user.
- **Client fetches data via `google.script.run`, not server-templated injection.** `showTagSummarySidebar()` opens an empty shell; the HTML calls `getTagSummary('all')` on load and `getTagTransactions(tag, scope)` on click. This enables the toggle and drill-in without reopening the sidebar. *Consequence:* the callable functions `getTagSummary` / `getTagTransactions` MUST NOT end in `_` (trailing-underscore functions are private and unreachable from `google.script.run`); internal helpers like `getTagColIndex_` keep the underscore.
- **Locate the TAG column by header name (`indexOf("TAG")`), return an error state if absent.** Mirrors the robustness approach used in the migration; avoids hardcoding a column that could drift.
- **當月 = current calendar month (today, TZ Asia/Taipei).** Since the summary isn't cell-driven, there's no selected month to read; "this month" is the natural scope. *Alternative considered:* a month picker — deferred as unnecessary for now.
- **Reuse `DrilldownSidebar.html` CSS and card markup in a new `TagSummarySidebar.html`.** Two separate HtmlService templates duplicate a small CSS block rather than coupling the two sidebars; keeps the existing drilldown untouched.

## Risks / Trade-offs

- **Full-table scan on every load/toggle/drill** → acceptable at personal-ledger scale (hundreds–thousands of rows); each call does one `getValues()` over the used range like `filterTransactions_` already does.
- **Bound-project push has the nested-`rootDir` quirk** (`sidebar/.clasp.json` `rootDir:"sidebar"`) → push via a temp `.clasp.json` with `rootDir:""` (same workaround used earlier this session); note it for the user.
- **Depends on TAG values existing** → if the TAG column is empty, the sidebar shows an empty state rather than erroring.
