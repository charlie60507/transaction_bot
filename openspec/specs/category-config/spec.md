## Purpose

Defines the categorization config data model: a single `META` sheet that holds both the keyword→種類 auto-classification rules and the 種類/TAG vocabulary lists, the runtime read/write contract over that sheet, and the data-validation dropdowns sourced from it.

## Requirements

### Requirement: Single merged META config layout

The system SHALL store all categorization config in one sheet named `META` with this column layout: `A 交易關鍵字`, `B 種類` (the keyword→category rule table, which grows over time), a spacer column `C`, `D 種類清單` (the valid-category vocabulary), and `E TAG清單` (the valid-tag vocabulary). The rule columns (A:B) and the vocabulary columns (D:E) MUST be independent so appends to one never overwrite the other. The separate `category` sheet MUST no longer be used.

#### Scenario: Rules and vocabulary coexist on one page

- **WHEN** the merged `META` sheet holds rules in A:B and vocabulary in D:E of differing lengths
- **THEN** reading rules ignores the vocabulary columns, and reading vocabulary ignores the rule columns

### Requirement: Rule loading from merged META

The system SHALL load keyword→category rules from `META` columns A (交易關鍵字) and B (種類), skipping rows with a blank keyword or blank category, sorted longest-keyword-first.

#### Scenario: Load rules ignoring vocabulary rows

- **WHEN** `META` has rule rows in A:B and additional vocabulary-only rows where A is blank (because D/E extend further down)
- **THEN** only rows with both a keyword and a category are returned as rules
- **AND** they are sorted longest-keyword-first

### Requirement: Valid-category vocabulary from column D

The system SHALL load the valid-category list from `META` column D (種類清單), starting at row 2, filtering blanks. This list is the set passed to the Gemini classifier and used to validate its output.

#### Scenario: Gemini valid set reads column D

- **WHEN** the categorizer needs the valid-category list
- **THEN** it reads `META` column D (not column A or row 2 horizontally)

### Requirement: Rule write-back appends without leaving gaps

When caching newly learned keyword→category mappings, the system SHALL append them to `META` columns A:B starting at the row after the last non-empty cell in column A — NOT after the sheet's overall last row — so that longer vocabulary columns (D:E) do not cause blank gaps in the rule table. It MUST NOT append duplicate keywords.

#### Scenario: Append below last rule, not below vocabulary

- **WHEN** the TAG/種類 vocabulary in D/E extends below the last rule in A:B and new rules are written
- **THEN** the new rules are appended immediately after the last keyword in column A, with no blank gap

#### Scenario: Skip duplicates

- **WHEN** a new mapping's keyword already exists in column A
- **THEN** it is not appended again

### Requirement: One-time migration with validation rebuild

The system SHALL provide a one-time `migrateMetaCategoryToMerged()` that reads the existing `category` rules and `META` vocabulary, rewrites `META` into the merged layout, rebuilds the data-validation dropdowns, and deletes the old `category` sheet. It MUST locate the Transactions TAG column by its header name and MUST abort without making changes if that column cannot be found, logging the detected column positions before applying.

#### Scenario: Successful migration

- **WHEN** `migrateMetaCategoryToMerged()` runs and the Transactions TAG column is found
- **THEN** `META` is rewritten with rules in A:B and vocabulary in D:E
- **AND** the old `category` sheet is deleted
- **AND** the Transactions 種類 (K) dropdown points to `META!D2:D`, the Transactions TAG dropdown points to `META!E2:E`, and the rule 種類 column `META!B2:B` points to `META!D2:D`

#### Scenario: Abort when TAG column missing

- **WHEN** the Transactions TAG column header cannot be located
- **THEN** the migration aborts without modifying any sheet
- **AND** a message is logged

### Requirement: Retire superseded reorganize function

The bound-script function that previously reorganized `META` into the old vertical 種類/TAG layout (`reorganizeMetaAndSetupRangeDropdown`) SHALL be removed, because running it would revert the merged layout and re-point the TAG dropdown to the wrong range.

#### Scenario: Old reorganizer no longer present

- **WHEN** the bound script is inspected after this change
- **THEN** `reorganizeMetaAndSetupRangeDropdown` is absent
