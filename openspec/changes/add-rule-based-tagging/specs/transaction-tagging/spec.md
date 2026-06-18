## ADDED Requirements

### Requirement: Tag rules sheet

The system SHALL read tag rules from a sheet named `tag` with header `[交易關鍵字, 標籤]`. Each data row maps a keyword (column A) to a tag (column B). The sheet is the sole source of truth for tags and is maintained manually by the user; the system MUST NOT create, validate against, or write rules back to it automatically.

#### Scenario: Load rules sorted longest-keyword-first

- **WHEN** tag rules are loaded for matching
- **THEN** rows with a non-empty keyword and non-empty tag are returned, sorted by keyword length descending (longest keyword first for most-specific match)
- **AND** rows with a blank keyword or blank tag are skipped

#### Scenario: Missing or empty tag sheet

- **WHEN** the `tag` sheet does not exist, or contains only a header row
- **THEN** an empty rule set is returned and no tagging is applied
- **AND** the append flow continues without error

### Requirement: Rule-based single-value tagging

The system SHALL assign at most one tag to a transaction by matching the merchant text (`交易內容/商店`, column F) against the loaded tag rules using case-insensitive substring matching, returning the tag of the first matching rule (longest keyword first). It MUST NOT use Gemini or any AI fallback for tagging, and MUST NOT learn or persist new rules.

#### Scenario: Merchant matches a keyword

- **WHEN** a transaction's merchant text contains a rule's keyword (case-insensitive)
- **THEN** that rule's tag is selected for the transaction

#### Scenario: Multiple keywords match

- **WHEN** more than one rule keyword is contained in the merchant text
- **THEN** the tag of the rule with the longest keyword is selected

#### Scenario: No keyword matches

- **WHEN** no rule keyword is contained in the merchant text
- **THEN** no tag is assigned and the tag cell is left blank for manual entry

### Requirement: Tag column placement and fill behavior

The system SHALL write the tag into column L of the `Transactions` sheet. It MUST only fill column L when the cell is currently blank, and MUST NOT modify column K (種類手動) or column G (類別) or any other existing column.

#### Scenario: Fill blank tag cell on new rows

- **WHEN** newly appended rows have a blank column L and the merchant matches a rule
- **THEN** the matched tag is written into column L for those rows

#### Scenario: Preserve existing tag

- **WHEN** a row's column L already contains a value
- **THEN** the system leaves that value unchanged even if a rule would match

### Requirement: Non-blocking integration into append flow

The system SHALL run tag auto-fill immediately after category auto-fill (`autoCategorizeRows_`) within the append flow, for the same set of newly appended rows. Tagging MUST be non-blocking: any error during tagging is caught and logged, and MUST NOT prevent transaction rows from being appended or the category path from completing.

#### Scenario: Tagging error does not break ingestion

- **WHEN** an error occurs while applying tags
- **THEN** the error is caught and logged
- **AND** appended transaction rows and category values are unaffected

### Requirement: Per-tag spend report

The system SHALL document a spreadsheet-side `QUERY` reporting recipe (Approach 2) that produces total spend grouped by tag, rather than generating the report from Apps Script. The README MUST document a `標籤統計` sheet whose formula sums `金額_NTD` (column E) grouped by tag (column L), all-time, ordered by total descending.

#### Scenario: All-time per-tag total

- **WHEN** the user pastes the documented QUERY formula into the `標籤統計` sheet
- **THEN** the sheet shows each non-blank tag with its summed spend, ordered from highest to lowest total
