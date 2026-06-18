## 1. Pre-flight

- [x] 1.1 Confirm the live `Transactions` sheet layout: verify column L is free (default header is A–I; category fills K). Adjust the tag column index in code if the live sheet differs.
- [x] 1.2 Confirm the merchant text column used for matching is F (交易內容/商店), consistent with `autoCategorizeRows_`.

## 2. Tag rule loading

- [x] 2.1 Add `loadTagRules_(ss)` mirroring `loadCategoryRules_` (cards_transaction_bot.js:643): read the `tag` sheet, skip rows with blank keyword or blank tag, return rules sorted longest-keyword-first.
- [x] 2.2 Handle missing/empty `tag` sheet by returning an empty array (no error).

## 3. Tag matching

- [x] 3.1 Add `matchTag_(merchant, rules)` reusing the `matchCategory_` logic (cards_transaction_bot.js:670): case-insensitive substring match, return first match (longest keyword first) or null.

## 4. Tag auto-fill orchestrator

- [x] 4.1 Add `autoTagRows_(ss, sh, startRow, numRows)` mirroring `autoCategorizeRows_` (cards_transaction_bot.js:797) but with the Gemini fallback AND the rule write-back sections removed.
- [x] 4.2 Read merchant from column F and current tag from column L for the target rows; only fill column L where it is currently blank; write a single tag value per row.
- [x] 4.3 Wrap the whole orchestrator in a non-blocking try/catch that logs and swallows errors (matches category path behavior).

## 5. Wire into append flow

- [x] 5.1 Call `autoTagRows_(ss, sh, startRow, numRows)` immediately after the existing `autoCategorizeRows_` call, on the same newly-appended row window.

## 6. Reporting (documentation only)

- [x] 6.1 Document in README.md: the `tag` sheet schema (`交易關鍵字` / `標籤`), the new 標籤 column L on Transactions, and that tagging is rule-only (no Gemini).
- [x] 6.2 Document the `標籤統計` QUERY recipe: all-time per-tag total `=QUERY(Transactions!A:L, "select L, sum(E) where L is not null and L<>'' group by L order by sum(E) desc label sum(E) '總花費'", 1)`, plus the optional month×tag variant.

## 7. Verify

- [ ] 7.1 `clasp push`, then run `appendLast7DaysToSheet` and confirm column L fills for merchants matching `tag` rules and stays blank otherwise.
- [ ] 7.2 Confirm the category path (column K) and the 交易工具 menu / Dashboard drilldown are unaffected.
- [ ] 7.3 Paste the `標籤統計` QUERY and confirm per-tag totals render correctly.
