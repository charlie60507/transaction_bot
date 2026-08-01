## Context

The dashboard is read-only: `getAllTxns()` returns a flat array, the frontend only displays. Columns (0-based): A=已記帳(0), B=bank(1), C=date(2), D=last4(3), E=amount(4), F=merchant(5), G=類別auto(6), H=link(7), I=MessageId(8), J=收支別(9), K=種類manual(10); a TAG column located by header. Displayed `cat` = `rowCategory_` = K || G. The bot re-sorts rows on each run, so row numbers are unstable — MessageId (I) is the only stable per-row key.

User decisions: editable fields = 類別 + 收支別 + TAG + 已記帳; category input = dropdown from existing categories; surface = **per-day** (B), i.e. the heatmap day preview becomes the editor.

## Goals / Non-Goals

**Goals:**
- Edit 類別 / 收支別 / TAG / 已記帳 inline in the per-day list, no expand step.
- 已記帳 removes the row from the day queue; a toggle reveals recorded rows to undo.
- Writes land on the correct Sheet row via MessageId; the Sheet stays SSOT.

**Non-Goals:**
- Replacing Sheets with a database.
- Editing amount / merchant / date (bank-sourced facts).
- Making 已記帳 filter analytics — it is a review flag only.

## Decisions

**D1 — Key writes by MessageId.** `updateTxn(messageId, patch)` scans column I for the matching MessageId and writes the patched cells. Rejects if not found (returns an error the UI surfaces). Never write by row index (bot re-sorts).

**D2 — Category writes to K (手動種類), never G.** Preserves the bot's auto value in G; `rowCategory_` already prefers K. Consistent with the existing manual-override model.

**D3 — Single flexible endpoint.** `updateTxn(messageId, patch)` where patch is any subset of `{cat,type,tag,posted}` → writes K / J / TAG / A respectively. Field changes call it with the one changed field; the 已記帳 button calls it with `{posted:true}`. Writing per-change means edits persist even if the user never marks 已記帳.

**D4 — The day list shows ALL of that day's transactions, not just 支出.** Because 收支別 is editable, income/transfer rows on that day must be reachable. (Edge case: a day with no 支出 has no clickable heatmap cell; those rows are only reachable on days that also have spend — acceptable for now, noted as a limitation.)

**D5 — Un-recorded queue.** Default list = that day's transactions with 已記帳 = false. A per-panel toggle shows recorded rows too (dimmed, with 取消記帳). `openHeatDay` selection already exists; add `showDone` state.

**D6 — 已記帳 does not touch analytics.** All aggregations keep counting every transaction. 已記帳 only controls visibility in the edit queue.

**D7 — Optimistic UI with revert.** On change/record: update local `TXNS` and re-render immediately, then `google.script.run.updateTxn(...)`; on failure handler, revert the local change, re-render, and toast an error. Keeps the UI snappy despite Apps Script latency.

**D8 — Dropdown option sources.** 類別: distinct `cat` values present in the data (+ the row's current value if absent). 收支別: fixed `[支出, 收入, 轉帳]`. TAG: distinct non-blank tags in the data + a blank （無） option (+ current if absent).

## Risks / Trade-offs

- [Two rows share a MessageId (shouldn't happen; bot dedups on it) → updateTxn writes the first match] → acceptable; the bot guarantees MessageId uniqueness.
- [Write latency makes rapid edits feel laggy] → optimistic local update hides latency; only failures reperturb the UI.
- [User edits then the sheet is re-sorted by the bot mid-session → stale row cache] → we key by MessageId, not row, so re-sort is harmless; a full re-fetch on demand refreshes counts.
- [Editing 收支別 to 轉帳 moves a row out of 支出 analytics] → intended, and matches the transfer model; the day heatmap total is recomputed on next fetch.

## Migration Plan

1. Backend: extend `getAllTxns()` (+`id`,+`posted`), add CFG indices, add `updateTxn`.
2. Frontend: make `heatPanel` day preview editable; add `showDone`; wire selects + record + toggle to `updateTxn` with optimistic update.
3. Verify offline (render + simulated updateTxn), then `clasp push` + deploy to `AKfycbyv…` (the user's live deployment).
4. Rollback: `git revert` + redeploy; no data migration.

## Open Questions

- Allow creating a brand-new category from the dropdown later? (User chose existing-only for now; easy to add a "＋ 新增" option later.)
