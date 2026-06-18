## Why

The sheet already auto-classifies each transaction into a single 類別 (category) via keyword rules + Gemini, but categories are coarse and Gemini-managed. Users want a second, lighter dimension — a free-form 標籤 (tag) they fully control with plain keyword rules — to slice spending in ways the category taxonomy doesn't capture (e.g. 外送 vs 通勤 vs 網購), and a simple way to see total spend per tag.

## What Changes

- Add a new `tag` rules sheet (`交易關鍵字` → `標籤`), structurally identical to the existing `category` sheet but maintained purely by hand. It is the sole source of truth — no valid-tag master list.
- Add a new 標籤 column to the `Transactions` sheet at **column L** (K = 種類手動 used by the category path and Dashboard pivot stays untouched).
- Auto-fill the tag on newly appended rows using **keyword rules only** (case-insensitive substring match against the merchant text, longest keyword first, single value per row). **No Gemini, no learning/write-back.**
- Wire tag auto-fill into the existing append flow, immediately after category auto-fill, as a non-blocking step.
- Document an Approach-2 reporting recipe: a `標籤統計` sheet whose `QUERY` formula shows per-tag total spend. This is a spreadsheet-side formula documented in the README, not Apps Script code.

## Capabilities

### New Capabilities
- `transaction-tagging`: Rule-based, single-value tagging of transactions from a manually-maintained keyword sheet, plus the documented QUERY-based per-tag spend report.

### Modified Capabilities
<!-- None. The category path, Gemini classification, META handling, and the 交易工具 menu / Dashboard drilldown (specs custom-menu, drilldown-sidebar) are all out of scope and unchanged. -->

## Impact

- **Code**: `cards_transaction_bot.js` — new `loadTagRules_`, `matchTag_`, `autoTagRows_` (mirroring `loadCategoryRules_`/`matchCategory_`/`autoCategorizeRows_` minus the Gemini + write-back sections); one new call wired into the append flow after `autoCategorizeRows_`.
- **Spreadsheet**: new `tag` sheet; new column L on `Transactions`; new `標籤統計` sheet holding the QUERY formula.
- **Docs**: `README.md` — document the `tag` sheet, the L column, and the `標籤統計` QUERY recipe (all-time and optional month×tag variants).
- **Out of scope / untouched**: `classifyWithGemini_`, `writeCategoryRulesBack_`, META handling, the existing category path, and the `交易工具` custom menu + Dashboard drilldown in `sidebar/程式碼.js`.
