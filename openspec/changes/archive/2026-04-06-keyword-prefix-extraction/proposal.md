## Why

The `bootstrapCategoryRules()` function and `writeCategoryRulesBack_()` currently store full merchant names as keywords (e.g., "星巴克 信義門市"). When the same chain appears with a different branch name (e.g., "星巴克 新竹店"), the substring match fails because "星巴克 信義門市" is not contained in "星巴克 新竹店". This significantly reduces the rule-based hit rate and forces unnecessary Gemini API calls.

By extracting the common prefix from merchants that share the same category, a single keyword like "星巴克" would match all branches.

## What Changes

- **Modify `bootstrapCategoryRules()`**: After grouping merchants by category, extract the longest common prefix for merchants in the same category that share a common root. Store the prefix as the keyword instead of the full merchant name.
- **Modify `writeCategoryRulesBack_()`**: When caching Gemini results, attempt to extract a meaningful prefix (strip branch/store suffixes) before writing to the category sheet. If only one occurrence exists, store the full name as-is (no prefix extraction possible yet).
- **Add `extractCommonPrefix_()` helper**: Given an array of merchant strings, find the longest common prefix (trimmed, min length threshold to avoid overly short keywords).

## Capabilities

### New Capabilities

- `keyword-prefix`: Common prefix extraction logic for merchant keyword generation

### Modified Capabilities

(None — this is an internal improvement to existing auto-categorization)

## Impact

- **Files**: `cards_transaction_bot.js` — `bootstrapCategoryRules()`, `writeCategoryRulesBack_()`, new helper function
- **Behavior**: category sheet will contain shorter, more general keywords that match more merchant variations. Existing full-name keywords will still work (substring match is unchanged).
- **Risk**: An overly short prefix (e.g., 1-2 characters) could cause false matches. Mitigated by a minimum keyword length threshold (e.g., 2 Chinese characters / 3 Latin characters).
