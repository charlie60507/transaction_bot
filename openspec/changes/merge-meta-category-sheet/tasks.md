## 1. Part A — runtime reads/writes (cards_transaction_bot.js)

- [x] 1.1 `loadCategoryRules_` (:642): change `getSheetByName('category')` → `'META'`; keep reading A:B (keyword, 種類); blank-keyword rows stay skipped.
- [x] 1.2 `loadValidCategories_` (:661): read 種類 vocabulary from column D — `getRange(2, 4, lastRow-1, 1)` — and filter blanks.
- [x] 1.3 `writeCategoryRulesBack_` (:749): change target sheet to `META`; compute the append row from the last non-empty cell in column A (+1), not `sh.getLastRow()`; build the existing-keyword set from column A only.
- [x] 1.4 `bootstrapCategoryRules` (:860): change `getSheetByName('category')` → `'META'`; write header only to A1:B1 = `['交易關鍵字','種類']`; do not touch D/E.

## 2. Part B — one-time migration + validation rebuild

- [x] 2.1 Add `migrateMetaCategoryToMerged()`: read old `category` A:B rules and current `META` 種類(A)/TAG(B) lists into memory first.
- [x] 2.2 Locate Transactions columns: 種類 = K; TAG via header `indexOf("TAG")`. Logger.log both detected positions; if TAG not found, abort with a message before any write.
- [x] 2.3 Rewrite `META` to the merged layout: headers A1=交易關鍵字, B1=種類, D1=種類清單, E1=TAG清單; rules→A:B, 種類 vocab→D, TAG vocab→E.
- [x] 2.4 Rebuild dropdowns with `requireValueInRange(..., true)` + `setAllowInvalid(true)`: Transactions K → `META!D2:D`; Transactions TAG → `META!E2:E`; `META!B2:B` → `META!D2:D`.
- [x] 2.5 After successful migration, delete the old `category` sheet.

## 3. Part C — retire reorganize + sync bound script

- [x] 3.1 `clasp pull` the bound project (scriptId `1P4l2…`) — confirmed live = repo + reorganize only; repo's `sidebar/程式碼.js` already equals "live minus reorganize".
- [x] 3.2 Remove `reorganizeMetaAndSetupRangeDropdown` from `sidebar/程式碼.js` — repo version never contained it (already the desired state).
- [x] 3.3 `clasp push` the bound project (via temp rootDir="" to avoid the broken nested rootDir); re-pulled and verified reorganize = 0 occurrences.

## 4. Verify

- [x] 4.1 `node --check cards_transaction_bot.js` (OK) and `clasp push` the standalone project (Part A + B) — pushed.
- [ ] 4.2 Run `migrateMetaCategoryToMerged()` once: confirm `META` has A:B rules + D/E lists, `category` sheet is gone, and the K/TAG dropdowns point to `META!D2:D` / `META!E2:E`. **(USER — destructive; run from editor and check the log line for detected K/TAG columns.)**
- [ ] 4.3 Run `appendLast7DaysToSheet`: confirm rule matching works, Gemini fallback uses the column-D 種類 list, no errors in the log. **(USER)**
- [ ] 4.4 Commit + push both scripts (standalone Part A+B; bound Part C).
