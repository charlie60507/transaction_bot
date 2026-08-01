## ADDED Requirements

### Requirement: Dedicated 分析 tab

The dashboard SHALL present a third top-level tab `分析` alongside `類別` and `項目(TAG)`, which hosts the three analysis panels. The 分析 tab SHALL use the same 期間 controls and scope model as the 類別 tab (全部 / 當月 / 當年 / a picked year+month), so switching between 類別 and 分析 preserves the selected period. The 類別 tab SHALL NOT contain the analysis panels.

#### Scenario: Analysis tab present and selectable

- **WHEN** the dashboard loads
- **THEN** three tabs are shown: 類別, 項目(TAG), 分析
- **WHEN** the user selects 分析
- **THEN** the three analysis panels are shown with the 期間 controls

#### Scenario: Category tab stays lean

- **WHEN** the user is on the 類別 tab
- **THEN** the per-card, heatmap, and ranking panels are NOT shown there

### Requirement: Per-card spending panel

The 分析 tab SHALL render a panel that groups the active scope's expense transactions by card, where a card is identified by the pair (bank, last-4 digits). For each card the panel SHALL show its total spend, its share of the scope's total card spend as a percentage, its transaction count, and its average spend per transaction, sorted by total descending. Only transactions with `type === 支出` are included; 轉帳 and 收入 are excluded. A transaction with a blank last-4 SHALL be grouped into a single fallback bucket for that bank rather than dropped, so per-card totals reconcile with the scope's total expense.

#### Scenario: Cards ranked by spend within scope

- **WHEN** the active scope contains expense transactions across two or more cards
- **THEN** each distinct (bank, last-4) card appears once with its total, share %, count, and average
- **AND** rows are ordered from highest total to lowest

#### Scenario: Blank last-4 does not lose spend

- **WHEN** one or more expense transactions have a blank last-4 for a bank
- **THEN** those transactions are grouped into one fallback bucket for that bank
- **AND** the sum of all card totals equals the scope's total expense

#### Scenario: Scope with no expenses

- **WHEN** the active scope contains no expense transactions
- **THEN** the panel shows an empty state instead of card rows

### Requirement: Spend calendar heatmap

The 分析 tab SHALL render a calendar heatmap as a 7-column grid (one column per weekday) where each day cell's color intensity encodes that day's total expense relative to the month's peak day, but ONLY when the active scope resolves to a single calendar month (scope level `month`). When the scope is 全部 or 全年/當年, the heatmap grid SHALL NOT be rendered; instead a short hint SHALL be shown telling the user the heatmap appears only for a single month. The panel SHALL also show the peak day and its amount, the number of days with any spend, and the daily average. Only `type === 支出` transactions contribute. In the current, partially-elapsed month, days after today SHALL render inert (dimmed, no value).

#### Scenario: Heatmap shown for a single month

- **WHEN** the active scope is a single month (當月 or a picked year+month)
- **THEN** the heatmap panel is rendered with one cell per day of that month
- **AND** each day's intensity reflects that day's total expense

#### Scenario: Heatmap grid hidden for non-month scopes

- **WHEN** the active scope is 全部 (all) or 全年 / 當年 (year)
- **THEN** the heatmap grid is not rendered
- **AND** a hint is shown that the heatmap appears only when a single month is selected

#### Scenario: Current partial month

- **WHEN** the active scope is the current month and today is before month end
- **THEN** days after today are rendered inert with no value
- **AND** the summary (peak, spend-days, daily average) is computed only over elapsed days

#### Scenario: Month with no spend

- **WHEN** the selected single month has no expense transactions
- **THEN** the grid renders with all-neutral cells and a zeroed summary

### Requirement: Heatmap day preview

Each heatmap day cell that has expense SHALL be clickable. Clicking a day SHALL select it (visually highlighted) and reveal that day's individual expense transactions below the grid — each showing merchant, category, card, and amount, sorted by amount descending — headed by the day's total and transaction count. Clicking the selected day again SHALL collapse the preview. The selection SHALL reset when the user switches tabs, changes the 期間 scope, or picks a different month. Days with no spend and inert future days SHALL NOT be clickable.

#### Scenario: Expand a day's transactions

- **WHEN** the user clicks a heatmap day that has spend
- **THEN** that day is highlighted
- **AND** its expense transactions are listed below the grid with the day's total and count

#### Scenario: Collapse by clicking again

- **WHEN** a day is expanded and the user clicks the same day
- **THEN** the preview collapses

#### Scenario: Selection resets on context change

- **WHEN** a day is expanded and the user switches tab, changes scope, or picks another month
- **THEN** the preview is cleared

#### Scenario: Empty and future days are not clickable

- **WHEN** a day has no spend, or is a future day in the current month
- **THEN** that cell is not clickable

### Requirement: Category ranking with month-over-month change

The 分析 tab SHALL render a panel ranking the active scope's expense categories by total spend descending, and for each category SHALL show a change indicator (▲ up / ▼ down / 持平) versus the same category in the previous comparable period. The previous period SHALL be derived the same way the existing KPI deltas derive it: for a month scope, the previous month compared over the same elapsed days when the current month is partial; for a year scope, the previous year over the same elapsed months. When there is no comparable previous period (all-time scope) or the category had no spend in the previous period, the indicator SHALL show a neutral marker (`—` or `新`) rather than a percentage. Only `type === 支出` transactions are included.

#### Scenario: Category rose versus previous period

- **WHEN** a category's total in the active month exceeds its total in the previous month's same period
- **THEN** that category's row shows an upward (▲) delta with the percentage change

#### Scenario: New category with no prior spend

- **WHEN** a category has spend in the active scope but none in the previous comparable period
- **THEN** its row shows `新` instead of a percentage

#### Scenario: All-time scope has no comparison

- **WHEN** the active scope is 全部 (all-time)
- **THEN** each category row shows a neutral marker (`—`) instead of a delta

#### Scenario: Ranking excludes transfers and income

- **WHEN** the scope contains 轉帳 and 收入 transactions alongside expenses
- **THEN** only 支出 categories appear in the ranking and their totals exclude 轉帳 and 收入
