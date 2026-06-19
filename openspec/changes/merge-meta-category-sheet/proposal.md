## Why

Categorization config is split across two sheets with different shapes: `META` holds the controlled vocabularies (種類 list, TAG list) that feed dropdowns and Gemini's valid-category set, while `category` holds the keyword→種類 auto-classification rules. Keeping two config tabs is confusing to maintain. Consolidating them into one `META` page makes the config self-contained, but the existing data-validation dropdowns point at the old ranges and must be re-pointed so they don't break.

## What Changes

- Merge `META` and `category` into a single `META` sheet with a fixed column layout: `A 交易關鍵字 | B 種類` (the growing rule table), `C` spacer, `D 種類清單 | E TAG清單` (the fixed vocabulary lists).
- Re-point all data validation: Transactions 種類 col (K) → `META!D2:D`; Transactions TAG col → `META!E2:E`; the rule 種類 col `META!B2:B` → `META!D2:D`.
- Update the runtime functions that read/write these sheets (`loadCategoryRules_`, `loadValidCategories_`, `writeCategoryRulesBack_`, `bootstrapCategoryRules`) to use the merged `META` layout.
- Add a one-time `migrateMetaCategoryToMerged()` function that builds the merged layout from existing data, rebuilds the dropdowns, and deletes the old `category` sheet — with a guard that aborts if the Transactions TAG column can't be located.
- Retire the bound script's `reorganizeMetaAndSetupRangeDropdown` (it would re-break the new layout), and sync the bound script back to the repo.

## Capabilities

### New Capabilities
- `category-config`: The categorization config data model — a single `META` sheet holding keyword→種類 rules plus the 種類/TAG vocabulary lists, the runtime read/write contract over it, and the data-validation dropdowns sourced from it.

### Modified Capabilities
<!-- None. The existing specs (custom-menu, drilldown-sidebar) read Transactions column K and are unaffected. -->

## Impact

- **Code (standalone `cards_transaction_bot.js`)**: `loadCategoryRules_` (:642), `loadValidCategories_` (:661), `writeCategoryRulesBack_` (:749), `bootstrapCategoryRules` (:860); new `migrateMetaCategoryToMerged()`.
- **Code (bound `sidebar/程式碼.js`)**: remove `reorganizeMetaAndSetupRangeDropdown`; pull the live bound script into the repo and re-push.
- **Spreadsheet**: `META` becomes the single config page (A:B rules + D/E lists); `category` sheet deleted; dropdowns on Transactions K + TAG re-pointed.
- **Out of scope / untouched**: TAG stays a manual dropdown (no keyword auto-tagging); Dashboard pivot / drilldown (reads col K).
