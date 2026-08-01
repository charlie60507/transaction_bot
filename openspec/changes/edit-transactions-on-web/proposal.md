## Why

Today every correction — fixing a category, marking 收支別, tagging a project, ticking 已記帳 — means opening the Google Sheet. The user wants to do all of it on the web dashboard while reviewing spending day-by-day. The Sheet stays the data store (SSOT); we add a write-back path so the user never has to open it.

## What Changes

- Turn the heatmap **day preview** (analysis tab, click a day) into an editable **待記帳** list for that day: each transaction shows inline dropdowns for 類別 / 收支別 / TAG and an **已記帳** action — no click-to-expand.
- Marking a transaction 已記帳 **removes it from the day list** (the list is the un-recorded queue). A toggle reveals already-recorded rows to fix mistakes (取消記帳 to bring one back).
- Add backend write-back keyed by **MessageId** (column I, stable across the bot's re-sorts): 類別→K (手動種類, non-destructive to the bot's auto G), 收支別→J, TAG→TAG column, 已記帳→A.
- `getAllTxns()` gains two fields per transaction: `id` (MessageId) and `posted` (已記帳), needed to target writes and drive the queue.
- 已記帳 is a **review flag only** — it does NOT change any analytics (KPIs, donut, ranking, heatmap totals still count every transaction).

## Capabilities

### New Capabilities
- `web-edit-transactions`: edit a transaction's 類別 / 收支別 / TAG / 已記帳 from the dashboard's per-day list, written back to the Sheet by MessageId, with the un-recorded-queue behavior.

### Modified Capabilities
<!-- The read-only dashboard capabilities are unaffected; this is additive. -->

## Impact

- **sidebar/程式碼.js** (backend): `getAllTxns()` adds `id` + `posted`; new `updateTxn(messageId, patch)` endpoint (patch ⊂ {cat,type,tag,posted}) that finds the row by MessageId and writes K/J/TAG/A; needs `IDX_MESSAGEID` (8) and `IDX_POSTED` (0) in CFG, and the TAG column index (already located by header).
- **sidebar/ToolPanel.html** (frontend): the heatmap day preview becomes the editable list (inline selects + record button + show-recorded toggle); optimistic local update on change, `google.script.run.updateTxn(...)` write, revert on failure.
- No new sheets, no schema change (writes existing columns), no new external service. Deploy to the user's live deployment (`AKfycbyv…`).
