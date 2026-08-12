## 1. Derive the list (sidebar/ToolPanel.html)

- [x] 1.1 Add `distinctBanks()` next to `distinctTags()`: walk `TXNS` once, counting each non-empty `t.bank` twice over — total occurrences, and occurrences on rows where `isManual(t)` is true. Return the names ordered manual-count descending first, then overall-count descending, with a stable tie-break so the list does not reshuffle between renders. Comment WHY the manual group leads (design D2). Verify: on the live data the result begins `現金, 國泰, 富邦, 台新`.
- [x] 1.2 Render `<datalist id="banklist">` alongside the existing `taglist` datalist, from `distinctBanks()`. Verify: the element exists in the rendered page and holds one `<option>` per distinct bank.

## 2. Replace the picker (sidebar/ToolPanel.html)

- [x] 2.1 Replace the hardcoded `<select id="a-source">` with `<input id="a-source" list="banklist" spellcheck="false">`, keeping the `mfld full` wrapper that closes the grid hole. Carry a placeholder in the same voice as the TAG field's. Verify: no source name remains anywhere in the markup.
- [x] 2.2 `openAddModal()`: pre-fill `#a-source` with the first entry of `distinctBanks()` (empty string when there are no transactions at all). Verify: opening the dialog on live data shows 現金.
- [x] 2.3 `submitAdd()`: `.trim()` the source before sending, as the TAG field already does. Verify: a value typed with a trailing space is stored trimmed.

## 3. Gate

- [x] 3.1 `node check_sidebar.js` exits 0, run unpiped with the exit code read directly.
- [x] 3.2 `git diff` touches `sidebar/ToolPanel.html` and the change artifacts only — no server file, no unrelated hunk.
- [x] 3.3 Confirm nothing else referenced `a-source` as a `<select>` (e.g. reading `.options` or `.selectedIndex`). Verify: `grep -n "a-source"` shows only the markup, the pre-fill and the read in `submitAdd`.

## 4. Live check (owner, after deploy)

- [ ] 4.1 Open the add dialog: 來源 shows 現金 pre-filled, and the list offers 現金 / 國泰 / 富邦 / 台新 (and 轉帳 last, until those two rows are corrected).
- [ ] 4.2 Add a row with a typed source that is not in the list; confirm it saves and then appears in the list next time.
- [ ] 4.3 Add a row with 國泰 and confirm the per-card spending panel groups it under 國泰.
