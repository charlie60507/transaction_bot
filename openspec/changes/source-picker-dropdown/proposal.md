## Why

The add-transaction 來源 field already derives every distinct 銀行 from the loaded transactions, but it is a text `<input list="banklist">` pre-filled with 現金. In the owner's browser the datalist never surfaces as a picker, so the field looks like it only offers 現金 — even though live history includes 臺新, 富邦, 現金 and 國泰. `derive-source-picker` left this as an open question; this change answers it.

## What Changes

- **來源 becomes a closed `<select>`**, populated from the existing `distinctBanks()` list (every non-empty `t.bank` on the page). Tapping it shows every used account.
- **No account name in the markup.** Options still come from the data; a newly seen 銀行 appears on the next load with no code change.
- **Default selected value** remains the first derived entry (現金 today, because it leads the manual-usage group).
- **Free-text / datalist is removed.** Typing a brand-new account from this dialog is out of scope (same closed-list deadlock as 類別; the first row for a new account is added in the sheet).

Not **BREAKING**: no stored value changes. `addTxn` still accepts whatever string the select submits.

## Capabilities

### New Capabilities
- `manual-source-dropdown`: the manual-add 來源 field is a `<select>` of every distinct 銀行 already loaded; no hardcoded names; first derived entry is pre-selected.

### Modified Capabilities
<!-- None — `manual-entry-source` from derive-source-picker was never archived under openspec/specs/. -->

## Impact

- `sidebar/ToolPanel.html` only: swap the 來源 input for a select, fill it in `openAddModal()`, drop the unused `banklist` datalist.
- No server change. No new `google.script.run` target.
- Offline fixture asserts `distinctBanks()` order and that the markup is a `<select>`, not a datalist input.
