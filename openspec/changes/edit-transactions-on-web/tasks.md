## 1. Backend (sidebar/程式碼.js)

- [x] 1.1 Add `IDX_MESSAGEID: 8` and `IDX_POSTED: 0` to CFG
- [x] 1.2 `getAllTxns()`: add `id` (String MessageId, col I) and `posted` (Boolean, col A) to each returned txn
- [x] 1.3 Add `updateTxn(messageId, patch)`: scan col I for messageId; write patch fields — cat→K, type→J, tag→TAG column (by header), posted→A; return {ok:true} or throw a clear error if not found
- [x] 1.4 Guard: validate `type` ∈ {支出,收入,轉帳}; ignore unknown patch keys; treat blank tag as clearing the cell

## 2. Frontend — editable day list (sidebar/ToolPanel.html)

- [x] 2.1 boot: map `posted` to Boolean on incoming TXNS; keep `id`
- [x] 2.2 Add `showDone` state; helpers to derive distinct categories and tags for dropdown options
- [x] 2.3 Rewrite the heatmap day preview to list ALL that day's txns (not just 支出), default filtered to `!posted`, as editable rows (類別/收支別/TAG selects + 已記帳 button)
- [x] 2.4 Add the "顯示已記帳 (N)" toggle; recorded rows shown dimmed with 取消記帳
- [x] 2.5 Colour the 收支別 select by value (支出/收入/轉帳); empty state when the day's queue is clear

## 3. Wire edits to backend

- [x] 3.1 On select change: optimistic local update + `google.script.run.updateTxn(id,{field:value})`; on failure revert + toast
- [x] 3.2 On 已記帳 / 取消記帳: optimistic `posted` toggle + `updateTxn(id,{posted:bool})`; failure revert + toast
- [x] 3.3 Ensure edits do not disturb analytics (aggregations keep counting all txns incl. posted)

## 4. Verify & deploy

- [x] 4.1 Offline: render day preview editable; simulate updateTxn (stub google.script.run) — change category/type/tag/posted, assert local state + payloads correct; recorded row leaves the queue; analytics unaffected
- [x] 4.2 `clasp push` + deploy to the user's live deployment `AKfycbyvVvKPI…` (NOT the stale AKfycbyK…)
- [ ] 4.3 Live check: open a day, change a category → confirm the Sheet K cell updates; mark 已記帳 → row leaves list and Sheet A ticks; report observation
