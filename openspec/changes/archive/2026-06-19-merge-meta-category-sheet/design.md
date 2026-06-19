## Context

Two scripts share the spreadsheet. The standalone `cards_transaction_bot.js` reads `category` (rules) via `loadCategoryRules_`/`writeCategoryRulesBack_`/`bootstrapCategoryRules` and `META` (valid categories) via `loadValidCategories_`. The bound `sidebar/程式碼.js` owns the 交易工具 menu + Dashboard drilldown, and contains a live-only `reorganizeMetaAndSetupRangeDropdown` that previously migrated `META` to a vertical 種類(A)/TAG(B) layout and set the Transactions TAG dropdown to `META!B2:B`.

This change consolidates both config sheets into one `META` page and re-points all dropdowns. A prior session already fixed `loadValidCategories_` to read META column A vertically; this change moves the 種類 vocabulary to column D, so that fix is superseded again here.

## Goals / Non-Goals

**Goals:**
- One `META` page: `A 交易關鍵字 | B 種類` rules + `D 種類清單 | E TAG清單` vocabulary, `C` as spacer.
- Runtime reads/writes updated to the merged layout, with rule appends robust against unequal column lengths.
- A safe, one-time migration that also rebuilds all dropdowns and removes the old `category` sheet.
- Retire the conflicting `reorganizeMetaAndSetupRangeDropdown` and bring the bound script back into the repo.

**Non-Goals:**
- No keyword auto-tagging (TAG remains a manual dropdown).
- No change to the Dashboard pivot / drilldown (reads Transactions col K).
- No change to email parsing, dedup, or the append flow itself.

## Decisions

- **Keep rules and vocabulary in separate column blocks (A:B vs D:E), not stacked.** The rule table grows continuously (Gemini learning) while the vocabulary is small and static; side-by-side blocks let each grow/shrink independently. *Alternative considered:* vertical stacking with a divider — rejected because appends would interleave and ranges would be fragile.
- **`writeCategoryRulesBack_` computes the append row from column A's last non-empty cell, not `sh.getLastRow()`.** Because D/E may extend below A:B, the sheet's last row is not the rule table's last row; using it would scatter new rules below the vocabulary with blank gaps. Scanning column A is exact. *Trade-off:* one extra column read, negligible at this scale.
- **`loadCategoryRules_` keeps reading A:B over the full used range and relies on the existing blank-keyword skip.** Vocabulary-only rows (A blank) are naturally filtered, so no row-count bookkeeping is needed.
- **Migration locates the TAG column by header name (`indexOf("TAG")`) and aborts if absent.** The 種類 column is taken as K (matches `sidebar` `IDX_CATEGORY_MANUAL:10`). Logging detected positions before applying prevents silently writing validation to the wrong column. *Alternative considered:* hardcoding both columns — rejected as too fragile against header drift.
- **Retire `reorganizeMetaAndSetupRangeDropdown` rather than leave it dormant.** A dormant function that silently reverts the layout is a latent footgun; removing it (and syncing the bound script to the repo) eliminates the divergence the prior sessions surfaced.

## Risks / Trade-offs

- **Migration is destructive (deletes `category`, rewrites `META`)** → Mitigation: read all source data into memory first, write the merged layout, only then delete `category`; abort early if the TAG column is missing so a partial run can't corrupt validation.
- **Actual Transactions header names may differ from assumptions** → Mitigation: locate TAG by header; log detected 種類(K)/TAG positions before applying; confirm against the live header row during verification before trusting the dropdowns.
- **Two clasp projects must both be pushed** → Mitigation: explicit Part C steps (pull bound → edit → push bound → commit) separate from the standalone push, so neither project is left stale.
