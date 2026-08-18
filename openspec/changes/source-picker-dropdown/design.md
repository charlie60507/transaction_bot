## Context

`distinctBanks()` already walks `TXNS` and returns every non-empty `t.bank`, ordered by manual usage then overall frequency. The add dialog binds that list to `<input id="a-source" list="banklist">` and pre-fills 現金. `<datalist>` is a suggestion layer, not a dropdown: when the input already has a value, most browsers (Safari in particular) never show the other names. The owner therefore only ever sees 現金.

The previous change (`derive-source-picker`) chose TAG's type-or-pick shape so a brand-new account could be typed. That deadlock is real, but the control failed its live job: the accounts that already exist cannot be picked. 類別 already lives with the same closed-list deadlock.

## Goals / Non-Goals

**Goals:**

- Make every used account visible and pickable in one tap.
- Keep the list derived from the data (`distinctBanks()`), with no hardcoded names.
- Keep the existing ordering and default (first derived entry).

**Non-Goals:**

- Typing a source that has never appeared. First row for a new account is added in the sheet.
- Editing 來源 on an existing transaction.
- Changing `distinctBanks()`, `addTxn`, or how 銀行 is stored.
- Correcting rows whose 銀行 reads `轉帳` — they remain an option until the cells change.

## Decisions

**D1 — Closed `<select>`, same shape as 類別 and 收支別.** A native select always shows every option on tap, including on the phone this dialog is used on. That is the bug. TAG stays a datalist because every project starts as a new name; 來源 is a small, already-known set of accounts.

*Alternative considered:* keep the input and draw a custom dropdown. Rejected: more code for the same native control 類別 already uses.

*Alternative considered:* select plus an 「其他」 escape hatch that reveals a text field. Rejected as extra scope — the owner asked for the used accounts as a dropdown, not a new-account path.

**D2 — Fill the select in `openAddModal()`, do not bake options into the static HTML.** Same rule as 類別: `innerHTML` from `distinctBanks()`, then `.value` = first entry. An empty page yields an empty select; `addTxn` still coerces a blank source to 現金.

**D3 — Delete `<datalist id="banklist">`.** Nothing else references it. TAG's `taglist` stays.

## Risks / Trade-offs

- **A newly opened account cannot be recorded from the web until one row exists** → accepted; same as 類別. The first row is typed in the sheet.
- **`轉帳` (or any other bad 銀行 value) appears as an option** → still a faithful mirror of the column, ranked last. Correcting the cells removes it.
- **Empty TXNS yields an empty select** → live sheet is not empty; server default still covers a blank submit.

## Migration Plan

1. Edit `sidebar/ToolPanel.html`; add a Node fixture for `distinctBanks()` and the select markup.
2. Merge to `main` (push-to-deploy). No data migration.
3. Rollback: `git revert` and let the normal deploy path run.

## Open Questions

None — CT-24's Change / Acceptance is the design. The previous change's datalist open question is resolved: it does not surface, so the control is a select.
