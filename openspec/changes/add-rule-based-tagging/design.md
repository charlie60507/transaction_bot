## Context

`cards_transaction_bot.js` already has a mature single-value category pipeline: `loadCategoryRules_` (reads the `category` sheet), `matchCategory_` (case-insensitive substring, longest keyword first), and `autoCategorizeRows_` (orchestrator that fills column K, with a Gemini fallback for unmatched merchants and rule write-back/learning). The category value lands in **column K (種類手動)**, which both the Dashboard pivot and the drilldown sidebar (`sidebar/程式碼.js`, `IDX_CATEGORY_MANUAL: 10`) read.

This change adds a parallel, deliberately simpler "tag" dimension. The user wants full manual control over tag rules (no AI), single value per transaction, and a lightweight way to view per-tag totals.

## Goals / Non-Goals

**Goals:**
- A manually-maintained `tag` sheet (keyword → tag) as the sole source of truth.
- A new 標籤 column at **L** on `Transactions`, auto-filled by keyword rules only.
- Reuse the existing category code shape so the implementation is a faithful, low-risk mirror.
- A documented `QUERY`-based per-tag spend report (Approach 2) — no reporting code.

**Non-Goals:**
- No Gemini/AI tagging, no rule learning or write-back.
- No META-style valid-tag list (nothing to validate against without AI output).
- No changes to the category path, `classifyWithGemini_`, `writeCategoryRulesBack_`, or META handling.
- No changes to the `交易工具` custom menu or Dashboard drilldown — tag drilldown is a possible future follow-up.

## Decisions

- **Mirror the category functions, strip the AI half.** Add `loadTagRules_` (copy of `loadCategoryRules_` reading the `tag` sheet), reuse the substring/longest-first matching as `matchTag_`, and add `autoTagRows_` (copy of `autoCategorizeRows_` with the Gemini fallback and `writeCategoryRulesBack_` sections removed). *Why over a generic shared helper:* the category functions are short and the parallel structure keeps the diff obvious and reviewable; premature generalization would entangle the AI-bearing category path with the rule-only tag path.
- **Tag goes in column L, not K.** K is 種類手動 (read by the Dashboard pivot and sidebar). Placing the tag in the next free column (L) avoids any collision with the category path. *Alternative considered:* reusing an existing column — rejected, it would corrupt category reporting.
- **Run `autoTagRows_` right after `autoCategorizeRows_`** on the same `(startRow, numRows)` window, wrapped in its own try/catch so it is non-blocking. *Why:* tagging is a nice-to-have enrichment; it must never block ingestion or the category path.
- **Reporting is a documented `QUERY` formula, not code.** A `標籤統計` sheet with `=QUERY(Transactions!A:L, "select L, sum(E) where L is not null and L<>'' group by L order by sum(E) desc label sum(E) '總花費'", 1)`. *Why over an Apps Script report:* zero code, auto-updating, and the user already maintains the category Dashboard the same way.

## Risks / Trade-offs

- **Column L must be free on the live sheet** → Before shipping, confirm the production `Transactions` layout actually has L empty (the default header is only 9 columns A–I, but the live sheet has at least through K). Mitigation: verify the live column count during implementation; the fill logic only writes blank cells so a wrong column would be visible immediately and harmless to existing data.
- **Substring matching can over-match short keywords** (e.g. a 2-char keyword inside an unrelated merchant name) → Mitigation: longest-keyword-first ordering plus manual rule curation; this is the same trade-off the category path already accepts.
- **QUERY uses `month(C)+1` semantics if extended to month×tag** → documented variant only; not part of the core code path, so no runtime risk.
