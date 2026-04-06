## ADDED Requirements

### Requirement: Extract common prefix from merchant names
The system SHALL compute the longest common prefix (LCP) for groups of merchant names sharing the same category, trimmed at word/CJK boundaries, and use the prefix as the keyword when it meets the minimum length threshold.

#### Scenario: Multiple merchants with same prefix and category
- **WHEN** merchants ["星巴克 信義門市", "星巴克 新竹店", "星巴克 台北101"] all map to category "飲食"
- **THEN** `extractKeywordsFromGroup_()` SHALL return a single keyword "星巴克" for the group

#### Scenario: Merchants with no meaningful common prefix
- **WHEN** merchants ["全聯福利中心", "家樂福"] both map to category "超市"
- **THEN** the system SHALL keep both full merchant names as separate keywords since LCP is empty

#### Scenario: Single merchant in category
- **WHEN** only one merchant "NETFLIX" maps to category "娛樂"
- **THEN** the system SHALL store "NETFLIX" as the keyword (no prefix extraction possible)

#### Scenario: Common prefix too short
- **WHEN** merchants ["台新銀行", "台灣大車隊"] share a 1-character prefix "台"
- **THEN** the system SHALL NOT use "台" as keyword (below minimum length of 2) and SHALL keep both full names as separate keywords

### Requirement: Minimum keyword length threshold
Keywords produced by prefix extraction SHALL have a minimum length of 2 characters. Prefixes shorter than 2 characters SHALL be discarded, and the original full merchant names SHALL be used instead.

#### Scenario: Exactly 2 character prefix
- **WHEN** the LCP is "全聯" (2 characters)
- **THEN** the system SHALL accept it as a valid keyword

#### Scenario: 1 character prefix
- **WHEN** the LCP is "台" (1 character)
- **THEN** the system SHALL reject it and fall back to full merchant names

### Requirement: Trim prefix at word boundary
The extracted prefix SHALL be trimmed to remove trailing partial words or whitespace. For CJK text, each character is a valid boundary. For Latin text, the prefix SHALL be trimmed at the last space.

#### Scenario: Latin text with partial word
- **WHEN** merchants are ["UBER EATS Taipei", "UBER EATS Kaohsiung"]
- **THEN** the LCP "UBER EATS " SHALL be trimmed to "UBER EATS"

#### Scenario: CJK text needs no special trimming
- **WHEN** merchants are ["全聯福利中心 關新店", "全聯福利中心 光復店"]
- **THEN** the LCP "全聯福利中心 " SHALL be trimmed to "全聯福利中心"

### Requirement: Bootstrap uses prefix extraction
`bootstrapCategoryRules()` SHALL group merchants by their manually assigned category (column K), extract prefixes per group, and write the resulting keywords to the category sheet.

#### Scenario: Bootstrap produces general keywords
- **WHEN** the Transactions sheet has 5 rows with merchant "星巴克 XX" all categorized as "飲食" in column K
- **THEN** after running `bootstrapCategoryRules()`, the category sheet SHALL contain one row with keyword "星巴克" and category "飲食" instead of 5 separate full-name rows

### Requirement: writeCategoryRulesBack_ uses prefix extraction for batch results
When caching multiple Gemini results in a single run, `writeCategoryRulesBack_()` SHALL group new mappings by category and apply prefix extraction before writing to the category sheet.

#### Scenario: Two AI results share a prefix
- **WHEN** Gemini classifies ["麥當勞 信義店", "麥當勞 南港店"] both as "飲食" in the same run
- **THEN** the system SHALL write one keyword "麥當勞" to the category sheet instead of two full names
