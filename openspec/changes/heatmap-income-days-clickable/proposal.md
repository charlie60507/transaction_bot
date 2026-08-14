## Why

The heatmap day editor already lists every transaction on a day, but a cell is clickable only when that day's expense total is `> 0`. A payday, a transfer-only day, or a day whose only charges were fully split away via 我的消費 looks identical to an empty day — and the caption falsely says every cell is clickable. Once those rows are posted, the heatmap is the only calendar entrance.

## What Changes

- Keep intensity expense-only.
- `hit` = not a future day **and** the day has any transaction (any 收支別). Empty days and future days stay inert.
- Days with rows but `$0` expense: same grey fill, plus a 4px muted dot (no extra border). Expense days do not get the dot.
- "有消費 N 天" stays an expense-day count.
- Caption: "點有交易的日子看當天明細".
- `dayEditor` is unchanged.

## Capabilities

### New Capabilities
- `heatmap-any-txn-hit`: heatmap cells with any transaction (not just spend > 0) are clickable; income/transfer-only days get a muted dot; captions stop claiming every cell is clickable.

### Modified Capabilities
<!-- None — no archived heatmap spec lives under openspec/specs/. -->

## Impact

- **sidebar/ToolPanel.html**: `heatPanel` hit rule, a muted-dot marker, and the two "點任一格" captions.
- No server change. No new `google.script.run` target.
