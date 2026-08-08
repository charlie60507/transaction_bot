## 1. Server — the time reaches the page (sidebar/程式碼.js)

- [x] 1.1 Add `rowHM_(dt)`: format `dt` once as `HH:mm:ss` through `CFG.TZ`; return `''` when the result is `'00:00:00'`, otherwise the first five characters. Comment WHY midnight counts as no time (D2) and why the test goes through `CFG.TZ` rather than `dt.getHours()` (D3). Verify: `rowHM_` on a midday Date returns `'HH:mm'`, on a midnight Date returns `''`.
- [x] 1.2 `getAllTxns()`: add `hm: rowHM_(dt)` to the pushed object, reusing the `dt` already parsed for `y`/`m`/`d` (no second read of column C). Verify: the returned object has `hm` on every row; no other field changed.
- [x] 1.3 Do NOT touch `mapTxn_`, `getOverview`, `getTransactions`. Verify: `git diff` shows no hunk in those functions.

## 2. Server — manual add records a real time or none (sidebar/程式碼.js)

- [x] 2.1 `addTxn(fields)`: accept an optional `fields.time` of the form `HH:mm`; build `new Date(fields.date + 'T' + time + ':00')` when present and `new Date(fields.date + 'T00:00:00')` when absent, replacing the hardcoded `'T12:00:00'`. Reject a malformed non-empty time with a clear Chinese error, consistent with the existing 缺少日期 / 金額需大於 0 messages. Verify: a bad `time` throws; a good one is honoured; an absent one yields midnight.
- [x] 2.2 `addTxn`: set the date cell's number format to `'yyyy/mm/dd'` when no time was given and `'yyyy/mm/dd hh:mm:ss'` when one was, replacing the unconditional call (D9). Verify: the two paths set different formats.
- [x] 2.3 `addTxn`: return `hm` in the optimistic object, derived the same way as 1.1 (`''` when no time was given). Verify: the returned object's `hm` matches what `getAllTxns` would report for the row just written.
- [x] 2.4 Confirm `insertPositionForDate_` still places the new row correctly: it compares `dt.getTime()`, so a date-only add now sorts to the start of its day instead of the middle. Verify: no code change needed, and a date-only add lands among its own day's rows.

## 3. Page — ordering (sidebar/ToolPanel.html)

- [x] 3.1 `boot`: normalise `t.hm = (t.hm == null) ? '' : String(t.hm)`, next to the existing `charged` / `mine` defaults, with a comment saying a stale page then behaves exactly as before (D10). Verify: data with no `hm` renders without `undefined` anywhere.
- [x] 3.2 Add one `byTimeThenAmount(a, b)` comparator: `hm` ascending (string compare, `''` first), then amount descending. Comment that the amount tiebreak is load-bearing — 82% of rows have an equal primary key and would otherwise fall back to sheet order (D5). Verify: an all-untimed list comes out in amount-descending order; a mixed list puts untimed rows first.
- [x] 3.3 `dayEditor`: replace `.sort(function(a,b){ return b.amount-a.amount; })` with `.sort(byTimeThenAmount)`. Verify: only the comparator changed.
- [x] 3.4 `inboxTab`: replace the per-day `groups[k].sort(function(a,b){ return b.amount-a.amount; })` with `.sort(byTimeThenAmount)`, and update the neighbouring comment that currently says "biggest amount first (same as the per-day editor)". Verify: `grep 'b.amount-a.amount' sidebar/ToolPanel.html` returns no per-day sort (the search-results and top-list sorts are separate and stay).

## 4. Page — display (sidebar/ToolPanel.html)

- [x] 4.1 `editRow`: render `· HH:mm` after the bank badge when `t.hm` is non-empty, and nothing at all when it is empty. Verify: a timed row reads `富邦 •9837 · 21:25`; an untimed row is byte-identical to today's output.
- [x] 4.2 Add the CSS class for it under the existing `.er1` rules, using `--text-muted` and 11px to match `.badge` / `.dw`. Verify: no new colour literal is introduced.
- [x] 4.3 Leave `txnRow` alone (category drilldown + search). Verify: `git diff` shows no hunk in `txnRow`.

## 5. Page — the add dialog (sidebar/ToolPanel.html)

- [x] 5.1 Add `<input type="time" id="a-time">` as its own `.mfld` next to the date field, labelled as optional. Verify: the field renders and the dialog grid still lays out on a phone width.
- [x] 5.2 `openAddModal`: clear `a-time` on every open (it must not carry over from the previous entry), alongside the existing `a-amt` / `a-mer` resets. Verify: reopening the dialog shows an empty time.
- [x] 5.3 `submitAdd`: pass `time` in `fields`; leave the date and amount validation as it is (the time is optional and never blocks the save). Verify: saving with an empty time still succeeds.
- [x] 5.4 `submitAdd`: put `hm` on the optimistic `temp` row, derived from the submitted time (`''` when empty), so the row does not jump when the server's row arrives (D11). Verify: adding a 19:40 row places it chronologically immediately, before the round-trip completes.

## 6. Verify

- [x] 6.1 `node check_sidebar.js` — run it directly and check the exit code is 0 (never pipe it through `head`/`tail`). Covers: every file parses, every `google.script.run` target resolves, every `CFG.*` key exists.
- [x] 6.2 Offline harness with a stubbed `SpreadsheetApp` / `Utilities`: `rowHM_` on a timed / date-only / exactly-midnight cell; `addTxn` with and without a time (stored value AND number format); `getAllTxns` emits `hm` on every row.
- [x] 6.3 Comparator unit check: all-untimed → amount descending unchanged; all-timed → chronological; mixed → untimed first; same `hm` → larger amount first.
- [ ] 6.4 Live check after deploy, against the issue's acceptance list: a July 待記帳 row shows its time and a pre-June row shows none; the heatmap day list matches; a day with times reads chronologically; **a pre-June day in the heatmap is ordered exactly as it is today**; category drilldown and search rows are unchanged; a manual add with a time stores it, and one without stores a date-only cell that shows no time.
