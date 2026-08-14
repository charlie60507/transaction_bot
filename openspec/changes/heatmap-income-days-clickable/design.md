## Context

`heatPanel` paints a single-month calendar. Intensity is the day's 支出 total vs the month peak. Clicking a `.hit` cell sets `openHeatDay` and `dayEditor` lists every row that day. Today `hit = !future && spendTotal > 0`, so income/transfer-only days and $0-net 我的消費 days are inert. Hover-only affordances fail on the phone; cell borders already mean today / selected.

## Goals / Non-Goals

**Goals:**
- Any non-future day that has at least one transaction is clickable.
- Income/transfer-only days are distinguishable from empty days via a 4px muted dot.
- Intensity and "有消費 N 天" stay expense-only.
- Captions no longer claim every cell is clickable.

**Non-Goals:**
- Recoloring income/transfer days (no green, no third colour).
- Changing `dayEditor`.
- Making future days clickable.
- Counting paydays in "有消費 N 天".

## Decisions

**D1 — Second map `hasTxn[d]`, not a change to intensity.** The chart's question remains "where did spending cluster". Clickability is a separate predicate: any row, any 收支別.

**D2 — 4px muted dot, not a third border.** `.today` and `.sel` already own the border. A small interior dot is readable on touch without colliding with those meanings. Expense days skip the dot because intensity already marks them.

**D3 — $0 我的消費 expense days are spend-hits, not dots.** The rows exist (`type === 支出`); they just do not add to intensity. Clickable, no dot.

**D4 — Extract `heatDaysForMonth` as the testable slice.** Given mock TXNS + a frozen "today", classify each day as `inert` / `spend-hit` / `zero-spend-hit`.

## Risks / Trade-offs

- [$0 expense days look almost empty] → they are still `cursor:pointer` via `.hit`; acceptable per the ticket.
- [Dot vs day-number crowding on small cells] → 4px, bottom-center, day number stays top-right.

## Migration Plan

1. Frontend-only edit + Node fixture. Merge to `main`.
2. Rollback: `git revert`.

## Open Questions

None.
