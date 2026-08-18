## 1. Replace the picker (sidebar/ToolPanel.html)

- [x] 1.1 Replace `<input id="a-source" list="banklist">` with `<select id="a-source"></select>`, keeping the `mfld full` wrapper. Update the nearby comment: options still come from `distinctBanks()`, but the control is a closed select because the datalist never surfaced. Verify: markup has no `list="banklist"` and no account name on the 來源 field.
- [x] 1.2 `openAddModal()`: fill `#a-source` with one `<option>` per `distinctBanks()` entry (via `esc`), then set `.value` to the first entry (empty string when there are none). Verify: opening the dialog on a fixture that starts with 現金 selects 現金.
- [x] 1.3 Remove `<datalist id="banklist">` from `render()`. Leave `taglist` alone. Verify: `grep banklist` is empty.

## 2. Fixture + gate

- [x] 2.1 Add `test/dashboard_source_picker.js` that extracts `distinctBanks` / `isManual`, feeds mock TXNS covering 現金 (manual), 國泰 / 富邦 / 臺新 (auto, decreasing volume), and asserts the order `現金, 國泰, 富邦, 臺新`. Also assert ToolPanel.html contains `<select id="a-source">` and contains neither `list="banklist"` nor `datalist id="banklist"`.
- [x] 2.2 Wire the fixture so `node check_sidebar.js` runs it (filename `dashboard_*.js`, export `run()`).
- [x] 2.3 `node check_sidebar.js` exits 0.
