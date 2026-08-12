## Why

The manual-add 來源 picker offers six hardcoded options, four of which have never appeared in the sheet, while the two accounts carrying 97% of all transactions — 國泰 and 富邦 — cannot be selected at all. The list was typed by hand once and has never been reconciled with the data it claims to describe.

## What Changes

- **`來源` becomes a type-or-pick `<input list="banklist">`** backed by a `<datalist>` derived from the `bank` field already present on every transaction in `TXNS`. No account name remains in the markup.
- **The suggestion list is ordered in two groups**: sources previously entered *manually* (by manual count), then all remaining sources (by overall count). Measured on 1,034 live rows this yields `現金 · 國泰 · 富邦 · 台新`.
- **The field is pre-filled** with the first suggestion, set in `openAddModal()` rather than written into the markup.
- **`其他` is removed.** Once free text is allowed it names nothing, and would only become a bucket that is not any particular thing.
- **The two rows whose 銀行 column reads `轉帳` are left uncorrected**, at the owner's decision, so `轉帳` remains a suggestion ranked last until those cells change.

Not **BREAKING**: no stored value changes, and `addTxn` already accepts any `source` string.

## Capabilities

### New Capabilities

- `manual-entry-source`: offer the accounts that actually exist, ordered by how the field is actually used, without preventing a newly opened account from being recorded.

### Modified Capabilities

None. No existing capability's requirements change — `openspec/specs/` holds `category-config`, `custom-menu`, `drilldown-sidebar` and `tag-summary`, none of which describe the manual-add dialog.

## Impact

- `sidebar/ToolPanel.html` only: one new function, one new `<datalist>`, the 來源 markup, a pre-fill line in `openAddModal()`, and a `.trim()` in `submitAdd()`.
- No server change. `addTxn` already accepts an arbitrary `source` and already coerces a blank one to `現金`.
- No data migration. Existing rows are untouched; this changes what the dialog offers, not what any row holds.
- Deploy path unchanged: push to `main` triggers the existing `clasp push` + pinned `clasp deploy`.
