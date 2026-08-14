## 1. Search mode

- [ ] 1.1 Add `searchHits(txns, q)` (merchant/cat substring, exact amount/charged, no TAG/bank/date)
- [ ] 1.2 Move one `搜尋…` input into the header controls row on every tab; remove the 分析-only box
- [ ] 1.3 Non-empty `state.q` replaces the tab body with `editRow` results, newest first, cap 40 + 「還有 N 筆」
- [ ] 1.4 Escape/clear restores the tab; tab switch does not clear `state.q`

## 2. Fixture + gate

- [ ] 2.1 Add `test/dashboard_search.js` asserting merchant, category, exact amount, 350 vs 1350, other months, 收入, TAG-not-matched, cap/overflow
- [ ] 2.2 `node check_sidebar.js` exits 0
