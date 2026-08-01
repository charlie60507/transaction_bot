## 1. Shared plumbing (sidebar/ToolPanel.html)

- [x] 1.1 Add CSS for the three panels (card rows + share bar, calendar grid + cells + heat legend, ranking rows + delta) using existing tokens; no new colors beyond `--spend`/`--income`/`PALETTE`
- [x] 1.2 Add a JS color-blend helper that mixes `--spend` toward `--bg-raised` by ratio `t` and returns `rgb(...)` (per design D5), plus any small shared formatter needed

## 2. Per-card spending panel

- [x] 2.1 Implement `cardPanel(expList)`: group by `bank ∥ last4`, blank last-4 → per-bank `未知` bucket; compute total, share %, count, average; sort by total desc; assign colors by index from `PALETTE`
- [x] 2.2 Render card rows (name + bank + •last4 badge, total, share %, share bar, count · average) and an empty state when there are no expenses

## 3. Category ranking with month-over-month change

- [x] 3.1 Implement `rankPanel(r)`: rank scope expense categories by total desc; compute previous-period per-category totals via `prevScope(r)` + `inScope` + `inUpto`
- [x] 3.2 Render delta indicator: ▲/▼ percentage vs same-period previous; `新` when absent in prior period; `—` when `prevScope` is null (all-time); exclude 轉帳/收入

## 4. Spend calendar heatmap

- [x] 4.1 Implement `heatPanel(r)` guarded to render only when `r.level === 'month'`; build per-day expense sums for `r.year`/`r.month`
- [x] 4.2 Render 7-column grid (weekday header, leading blanks for first-of-month weekday); cell intensity via the blend helper relative to the month peak; current-month days after `NOW.day` render inert
- [x] 4.3 Render summary (peak day + amount, days-with-spend, daily average) computed over elapsed days only

## 5. Dedicated 分析 tab

- [x] 5.1 Add `analysisTab()` rendering card + ranking as a `grid2` row, then the heatmap full-width below (with a hint panel for non-month scopes)
- [x] 5.2 Add a third tab button `分析`; make `render()` dispatch category/analysis/project and share the 期間 controls between 類別 and 分析
- [x] 5.3 Remove the panels from `categoryTab()` (keep 類別 lean)
- [x] 5.4 Confirm all panels re-render on tab and scope changes with correct active states

## 6. Heatmap day preview

- [x] 6.1 Add `openHeatDay` state; make spend cells clickable (`data-hday`), highlight the selected cell
- [x] 6.2 Render selected day's expense transactions (via `txnRow`) with the day's total + count below the grid
- [x] 6.3 Wire cell clicks (toggle) in `attach()`; reset `openHeatDay` on tab switch, scope change, and month pick

## 7. Verify against real data & deploy

- [x] 7.1 Offline verification against the real file: analysis tab default, heat preview expand/collapse, non-month hint, category tab clean, card totals reconcile, transfers excluded
- [x] 7.2 `clasp push -f` then `clasp deploy -i <existing deployment id>` to update the same Web App URL
- [ ] 7.3 In the live dashboard, switch 當月/當年/全部 and a picked month, click heatmap days; confirm behavior per spec; report result (observation), not just "done"
