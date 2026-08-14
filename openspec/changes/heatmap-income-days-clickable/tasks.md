## 1. heatPanel hit rule

- [x] 1.1 Add `heatDaysForMonth` that classifies each day as inert / spend-hit / zero-spend-hit from TXNS + today
- [x] 1.2 `hit` = not future and day has any txn; intensity and "有消費 N 天" stay expense-only
- [x] 1.3 Income/transfer-only hits render a 4px muted dot (no extra border); expense days do not
- [x] 1.4 Replace both "點任一格…" captions with "點有交易的日子看當天明細"

## 2. Fixture + gate

- [x] 2.1 Add `test/dashboard_heatmap_hit.js` with mock TXNS covering income-only, transfer-only, empty, future, spend, and $0 我的消費 days
- [x] 2.2 `node check_sidebar.js` exits 0
