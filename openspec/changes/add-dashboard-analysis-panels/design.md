## Context

The web dashboard (`sidebar/ToolPanel.html`, served by `doGet` in `sidebar/程式碼.js`) is a thin-backend / fat-frontend app: `getAllTxns()` returns a flat array of transactions and the frontend does all aggregation client-side. Each transaction already carries `y/m/d`, `amount`, `cat`, `merchant`, `tag`, `type` (支出/收入/轉帳), `bank`, and `last4`. The 類別 tab currently renders: KPIs → 本月預估 strip → 分類 donut + 收入來源 → 每月收支趨勢 → 轉帳 panel → 更多分析(定期訂閱 · Top 商店) → 支出明細.

This change adds three additive, purely-computed panels. No backend, deploy-model, or dependency change. The existing scope model (`resolveScope`/`inScope`/`prevScope`/`inUpto`) and helpers (`fmt`/`esc`/`median`/`sum`/`daysInMonth`) are reused as-is.

## Goals / Non-Goals

**Goals:**
- 信用卡別分析: for the active scope, expense totals grouped by card (bank + last-4), each with share %, count, and average.
- 消費日曆熱力圖: for a single calendar month, a 7-column day grid with per-day spend intensity, plus peak-day / spend-days / daily-average summary.
- 類別排行 + 月增減: rank the active scope's expense categories, each with a ▲▼ delta versus the same-period previous period.
- All three expense-only, honoring the existing income/expense/transfer separation, and re-rendering with the existing scope controls.

**Non-Goals:**
- Month-end run-rate projection, anomaly detection, subscription-change tracking (user declined all three).
- Any change to the existing 本月預估 projstrip — left exactly as-is; its removal, if wanted, is a separate decision.
- No backend/`getAllTxns()` change.

## Decisions

**D1 — Placement: a dedicated 分析 tab (revised).** All three panels live in a new third tab `分析` (alongside 類別 and 項目(TAG)), rendered by `analysisTab()`. The 分析 tab reuses the same 期間 controls as 類別 (shared `state.scope`): 全部 / 當月 / 當年 / 指定年月. Layout inside the tab: 信用卡別分析 + 類別排行 as a `grid2` row, then 消費日曆熱力圖 full-width below. Rationale: the user first chose mixed placement, then revised to a separate tab to keep 類別 lean and give the analysis views their own space.
- *Alternative rejected:* embedding inside 類別 (the earlier mixed choice) — made the 類別 tab long; the user moved them out.
- *Note:* the 分析 tab shares the 類別 scope model rather than owning a separate scope, so switching 類別↔分析 preserves the selected period.

**D2 — Heatmap only for single-month scope.** The heatmap renders only when `resolveScope(state.scope).level === 'month'`. For 全部 / 全年 scope it is omitted entirely (no placeholder). Rationale: a heat calendar is meaningless across a whole year or all-time; user's guidance was "僅單月範圍時顯示". In the current partial month, days after `NOW.day` render inert (dimmed, no value).

**D3 — Card grouping key = `bank ∥ last4`.** Group by the pair. A blank/missing `last4` falls back to a `未知` bucket per bank rather than being dropped, so totals reconcile with 總支出. Colors assigned by sorted index from the existing `PALETTE`. Rationale: real data is keyed by bank + last-4, not a card product name; never silently drop spend.

**D4 — Month-over-month delta reuses `prevScope`.** The ranking's per-category delta compares the active scope's category total against the same category in `prevScope(r)` (which already encodes same-period `upto` for a partial current month, and year→previous-year). When `prevScope` is null (level `all`) or the category had no prior-period spend, show `—` / `新` instead of a percentage. Rationale: reuse the proven comparison the KPI deltas already use; avoids a partial-month vs full-month distortion.
- *Alternative rejected:* a fixed "this month vs last month" comparison independent of scope — would misbehave for year/all scopes and duplicate `prevScope` logic.

**D5 — Heat intensity via JS color blend, not CSS `color-mix`.** A small helper blends `--spend` (#c46a58) toward `--bg-raised` by a `t` ratio and returns `rgb(...)`, instead of relying on CSS `color-mix()`. Rationale: robustness across the HtmlService iframe / older engines; the prototype used `color-mix` but a JS blend removes the runtime dependency for a load-bearing visual.

**D6 — Expense-only, transfers excluded.** All three panels filter `t.type === '支出'` and thus exclude 轉帳 and 收入, consistent with the 分類 donut and per the earlier correction that transfers (收支別 J = 轉帳) are not spend.

**D7 — Heatmap day preview (click to expand).** Each heatmap cell with spend is clickable (`data-hday="y-m-d"`); clicking selects the day (`openHeatDay` state, mirroring `openRow`) and renders that day's individual expense transactions below the grid (reusing `txnRow`), headed by the day's total and count. Clicking the same day toggles it closed; the selection resets on tab switch, scope change, and month pick. Rationale: the calendar answers "when did I spend" but the user wanted to drill into "what were those" without leaving the heatmap.
- *Alternative rejected:* a hover `title` tooltip listing items — fails on touch and truncates long lists; a click-drilled inline list matches the existing row-card drill pattern.

## Risks / Trade-offs

- [Dirty / blank last-4 fragments a card into multiple rows] → group blank last-4 into one `未知` bucket per bank; acceptable because the data is machine-populated and mostly consistent.
- [類別排行 visually overlaps the existing 分類 donut and 支出明細 rowCards] → differentiate by carrying the MoM ▲▼ delta, which neither existing view shows; keep the ranking compact (ranked bars, no drill).
- [Heatmap month with zero spend] → render the grid with all-neutral cells and an empty-ish summary rather than hiding, so the user sees the month is empty (only when a single month is selected).
- [Same-period MoM when prior month has sparse early-month data] → show `新` when the category is absent in the prior period; never divide by zero.
- [color blend produces low-contrast cells at low t] → floor the blend at a visible minimum tint (t starts above 0 for any non-zero day).

## Migration Plan

1. Edit `sidebar/ToolPanel.html` only (CSS additions + new render functions + call sites in `categoryTab()`).
2. `clasp push -f`, then `clasp deploy -i <existing deployment id>` to update the same Web App URL.
3. Verify against real data: switch 當月 / 當年 / 全部 and a picked month; confirm card totals reconcile with 總支出, heatmap appears only for single-month, ranking deltas read sensibly.
4. Rollback: `git revert` the commit and re-run push + deploy; no data migration involved.

## Open Questions

- None blocking. (Whether to later remove the existing 本月預估 projstrip is tracked separately, outside this change.)
