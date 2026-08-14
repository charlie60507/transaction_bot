## Context

`state.q` already exists. `periodTab` uses it as a merchant filter on `expList` (in-scope 支出) and renders read-only `txnRow`. Tab switches wipe `q`. The full `TXNS` array is already in memory.

## Goals / Non-Goals

**Goals:**
- One header search, every tab, all TXNS, merchant/category substring or exact amount/charged.
- Non-empty query replaces the tab body with `editRow` results (cap 40).
- Clear / Escape restores the tab; tab switches keep `q`.

**Non-Goals:**
- Server-side search, AND keywords, date-range, TAG/bank matching, a dropdown overlay.

## Decisions

**D1 — Search is a mode, not a filter overlay.** KPIs/heatmap/cards yield so the hit can be edited immediately.

**D2 — Exact numeric match after stripping `$` and commas.** Substring numeric match would make `350` hit `1350`.

**D3 — Newest date then time descending.** "Where is that row" wants the most recent first.

**D4 — Keep `state.q` across tabs.** The query outranks the tab until cleared.

**D5 — Extract `searchHits(txns, q)` as the testable slice.**

## Risks / Trade-offs

- [40-cap hides older hits] → "還有 N 筆" makes the truncation visible; no pagination in this change.
- [Numeric query also substring-matches a merchant containing those digits] → allowed by the OR rule; amount `1350` still must not match query `350`.

## Migration Plan

1. Frontend-only + Node fixture. Merge to `main`.
2. Rollback: `git revert`.

## Open Questions

None.
