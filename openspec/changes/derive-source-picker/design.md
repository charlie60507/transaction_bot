## Context

Two pickers in `ToolPanel.html` already answer the question "where does a list of options come from", and they answer it differently on purpose. Both carry their reasoning in comments:

- **類別** is a closed `<select>` fed by `distinctCats()` — deliberately closed, because that taxonomy was just cleaned up and must not fragment.
- **TAG** is an `<input list="taglist">` you can type into — deliberately open, because "a project only exists once a transaction carries it, so if the picker can only offer values already in the sheet there is no way to start a new one from the web at all."

來源 is currently neither: a closed `<select>` whose options come from nowhere but a developer's memory. Measured against 1,034 live rows, four of its six options have never occurred and the two dominant accounts are absent.

Constraints: the page is a fat frontend — `TXNS` already carries `bank` on every transaction, so no server round trip is needed. The dialog is used rarely (4 manual rows in the sheet's whole history, all 現金) and mostly on a phone.

## Goals / Non-Goals

**Goals:**

- Offer the accounts that exist, without anyone maintaining a list.
- Keep a newly opened account recordable, since manual entry may be the only way its first transaction can exist.
- Put the option that is actually typed most often first, and encode *why* it is first so the order survives a change in habit.

**Non-Goals:**

- Correcting the two rows whose 銀行 column reads `轉帳` — the owner has chosen to leave them.
- Editing 來源 on an existing transaction. The editable row exposes 類別, 收支 and TAG but not 來源; a mis-picked source is still only fixable in the spreadsheet.
- Constraining or validating account names. This change suggests; it does not police.
- Any change to how `銀行` is stored, aggregated or displayed elsewhere.

## Decisions

### D1 — 來源 takes TAG's shape, not 類別's

A closed list derived from the data deadlocks: a newly opened account cannot be offered until a row carries it, and for an account whose transactions do not arrive by mail, manual add is the only way to create that row. That is exactly the deadlock TAG's comment describes, so it gets TAG's answer — a `<datalist>` that suggests without constraining.

*Alternative considered:* a closed `<select>` derived from the data plus a permanent `其他` escape hatch. Rejected: it moves the deadlock rather than removing it, and 其他 is a bucket that identifies nothing, so the account would be lost anyway.

### D2 — Order by manual usage first, overall usage second

Two groups: sources actually entered by hand (identified by the existing `isManual` helper — the `manual-` id prefix), ranked by manual count; then everything else by overall count.

*Alternative considered:* hardcode `現金` first. It produces the correct list today, and it is precisely the move that produced the fictional list this change removes — an assumption that was true at the time, frozen into the markup, and left to rot. What is durable is the reason: manual entry is usually cash, because card transactions arrive by mail on their own and never need typing. Ranking by manual usage encodes that reason, so the order follows a change in habit with no edit here.

*Alternative considered:* a single sort by manual count alone. Rejected: with 4 manual rows in the whole history the signal is too thin, and one stray manual entry would outrank an account with 558 transactions. The two-group split keeps never-typed accounts in familiar volume order.

Ties fall back to first-appearance order rather than `0`, so the list cannot reshuffle between renders.

### D3 — Do not filter known-bad values out of the derived list

`轉帳` will be suggested, because two rows carry it in the 銀行 column. The reflex fix is a filter dropping any value that matches a 收支別 name.

*Rejected:* the filter would make the dialog look correct while the sheet stayed wrong, buried in a file nobody opens to ask about data quality. The suggestion list is a faithful mirror of the column — when it shows something absurd, that is the column saying so. Correcting the two cells removes the option with no code involved, and the ordering already buries them (never manual, 2 occurrences, therefore last).

### D4 — Pre-fill from the data, not from the markup

The initial value is set in `openAddModal()` from the first derived entry. A value written into the HTML would be a second hardcoded assumption of exactly the kind D2 rejects, and would go stale the same way. An empty page yields an empty field, and `addTxn` already coerces a blank source to `現金`.

## Risks / Trade-offs

- **Free text lets a typo create a divergent account (`富邦銀行` vs `富邦`), splitting the per-card spending panel** → the list is four items and is displayed while typing, so a divergent value is visible at the moment it is created rather than discovered later in a total that does not add up. Accepted as the cost of removing D1's deadlock. The residual sting is that 來源 is not editable on an existing row, so the correction has to happen in the spreadsheet.
- **`<datalist>` rendering varies by browser, and iOS Safari is stingy about surfacing suggestions** → the field is a plain text input underneath and is pre-filled with the most likely value, so the dialog stays usable even where suggestions never appear. Not tested on a device; carried into Open Questions.
- **The list mirrors the column, so bad data becomes a visible option** → deliberate (D3), and ranked last.
- **Ordering depends on `isManual`, which infers "typed by hand" from a `manual-` id prefix** → rows typed directly into the spreadsheet carry no MessageId and so are counted as automatic. This under-counts manual habit, but only in the direction of leaving the order as it is today; it cannot invent a rank.

## Migration Plan

No migration. Frontend only, no stored value changes, no schema change, and no existing row is read differently than before.

Deploy is the repository's normal path: merging to `main` triggers `clasp push -f` and `clasp deploy` against the pinned deployment id. Rollback is `git revert` of the single commit followed by a push, which redeploys the previous dialog — nothing persisted in the sheet depends on this change, so a rollback needs no data repair.

## Open Questions

- Does `<datalist>` actually surface suggestions in the browser the owner uses on their phone? If it does not, the suggestion layer needs replacing with a hand-drawn dropdown; the recorded values would be unaffected.
- Should 來源 become editable on an existing transaction? Out of scope here, but the absence is what makes a mis-picked source expensive.
- Will the two `轉帳` rows be corrected? Doing so removes that suggestion with no code change; leaving them is a standing decision, not an oversight.
