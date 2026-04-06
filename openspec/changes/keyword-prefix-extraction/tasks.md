## 1. Prefix Extraction Helper

- [x] 1.1 Add `extractCommonPrefix_(strings)` — compute LCP of an array of strings, trim at word/CJK boundary
- [x] 1.2 Add `extractKeywordsFromGroup_(merchants, minLength)` — given merchants sharing a category, return prefix if valid or individual full names as fallback

## 2. Update Bootstrap

- [x] 2.1 Modify `bootstrapCategoryRules()` to group merchants by category, then call `extractKeywordsFromGroup_()` per group instead of storing full merchant names

## 3. Update AI Cache Writeback

- [x] 3.1 Modify `writeCategoryRulesBack_()` to group new mappings by category, apply prefix extraction before appending to category sheet

## 4. Deploy & Verify

- [x] 4.1 Push via `clasp push`
- [x] 4.2 Re-run `bootstrapCategoryRules()` to regenerate category sheet with prefix-based keywords
