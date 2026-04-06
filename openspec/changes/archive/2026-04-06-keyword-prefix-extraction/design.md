## Context

The auto-categorization system stores merchant→category mappings in the `category` sheet. Currently, full merchant names are stored as keywords (e.g., "全聯福利中心 關新店"). The `matchCategory_()` function uses case-insensitive substring matching. The problem is that full merchant names from different branches don't match each other.

## Goals / Non-Goals

**Goals:**
- Extract common prefixes from merchants sharing the same category to produce shorter, more general keywords
- Apply prefix extraction in both `bootstrapCategoryRules()` (initial seed) and `writeCategoryRulesBack_()` (ongoing AI cache)
- Set a minimum keyword length to avoid overly broad matches

**Non-Goals:**
- Changing the `matchCategory_()` matching logic (substring match stays the same)
- Retroactively cleaning up existing category sheet entries (bootstrap can be re-run manually)
- NLP or fuzzy matching — pure string prefix extraction

## Decisions

### 1. Prefix extraction algorithm

**Choice**: Longest common prefix (LCP) on groups of merchants sharing the same category, then trim trailing whitespace and partial words.

**Steps**:
1. Group merchants by their assigned category
2. For each group with 2+ merchants, compute LCP character by character
3. Trim the result: remove trailing partial words (cut at last space or CJK boundary)
4. If the trimmed prefix meets minimum length, use it; otherwise keep full merchant names individually

**Alternative considered**: Regex to strip common suffixes like "XX店", "XX門市" — rejected as too fragile and locale-specific.

### 2. Minimum keyword length

**Choice**: Minimum 2 characters. This handles both CJK (2 Chinese characters = meaningful, e.g., "全聯") and Latin (e.g., "711").

**Rationale**: 1 character is too broad (could match unrelated merchants). 2 CJK characters or 2+ Latin characters provide sufficient specificity.

### 3. When to extract prefix in writeCategoryRulesBack_

**Choice**: For newly cached AI results within a single run, group by category and extract prefix if 2+ merchants share the same category. If only one merchant maps to a category, store the full name — prefix extraction will happen on the next bootstrap run when more data exists.

**Rationale**: Keeps the ongoing cache simple. The bootstrap function is the primary tool for prefix optimization.

## Risks / Trade-offs

- **Prefix too short** → False matches (e.g., "台" matching "台新銀行" and "台灣大車隊"). Mitigation: min length 2 chars + longest-keyword-first priority in matching.
- **Prefix too long** → Doesn't generalize enough. Mitigation: trimming at word/CJK boundaries ensures meaningful prefixes.
- **Re-running bootstrap** → Replaces specific keywords with prefixes. Acceptable since prefix-based matching is strictly more general.
