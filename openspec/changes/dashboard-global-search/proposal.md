## Why

The existing search box is not a way to find a transaction: it lives only on 分析, matches merchant substring against this period's expenses, and results are read-only `txnRow`. Last month, 收入, an amount, or a category are all missed — and a hit cannot be edited.

## What Changes

- One search input in the sticky header controls row. Remove the 分析-only "搜尋商店…" box.
- Query all `TXNS` (ignore period and tab). OR: merchant substring, category substring, or exact `amount`/`charged` when the query is a plain number (strip `$` and commas). Searching `350` must not hit `1350`.
- Do not match TAG, bank, or date.
- Non-empty query is a mode: tab body becomes an `editRow` list, newest first, cap 40 + "還有 N 筆".
- Escape or clear restores the tab. Switching tabs does not clear `state.q`.
- Placeholder `搜尋…`. Narrow field so `＋ 新增` stays on the header.

## Capabilities

### New Capabilities
- `dashboard-global-search`: a header search mode over all in-memory TXNS by merchant, category, or exact amount/charged, rendering editable `editRow` results.

### Modified Capabilities
<!-- None. -->

## Impact

- **sidebar/ToolPanel.html** only. No server change. No second search box. No AND / date-range / TAG matching.
