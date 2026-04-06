## ADDED Requirements

### Requirement: Sidebar displays filtered transactions for selected Dashboard cell
When the user selects a cell in the Dashboard pivot area and triggers the drill-down, the system SHALL open an HTML sidebar showing all transactions matching the corresponding month and category.

#### Scenario: Valid pivot cell selected
- **WHEN** the user selects cell D4 on the Dashboard sheet (e.g., year=2025, month=3, category=購物)
- **THEN** the sidebar SHALL open showing all Transactions where 授權日期時間 falls within 2025/03 AND 類別 equals "購物"

#### Scenario: No matching transactions
- **WHEN** the user triggers drill-down for a month/category combination with zero transactions
- **THEN** the sidebar SHALL display a friendly empty state message (e.g., "這個月沒有此類別的交易")

#### Scenario: Cell outside pivot area
- **WHEN** the user selects a cell that does not map to a valid category column (e.g., column A, B, or beyond the last category column)
- **THEN** the sidebar SHALL display an error message explaining that the selected cell is not in the pivot area

#### Scenario: Active sheet is not Dashboard
- **WHEN** the user triggers drill-down while on a sheet other than Dashboard
- **THEN** the system SHALL display an alert instructing the user to switch to the Dashboard sheet

### Requirement: Sidebar header shows summary stats
The sidebar header SHALL display the selected month, category name, total amount, transaction count, daily average, and the single largest transaction.

#### Scenario: Summary stats accuracy
- **WHEN** the sidebar opens for 2025/02 飲食 with 8 transactions totaling $10,000
- **THEN** the header SHALL show: month "2025/02", category "飲食", total "$10,000", count "8 筆", daily average "$357" (10000/28), and largest transaction amount and merchant

### Requirement: Transaction list displays card-style entries
Each transaction in the sidebar SHALL be rendered as a card showing: date (MM/DD), merchant name, amount (formatted with comma separators), bank name as a colored badge, and a clickable Gmail link icon.

#### Scenario: Card content
- **WHEN** a transaction row has 授權日期時間=2025/02/15 14:30, 交易內容="星巴克", 金額=150, 銀行="富邦", Gmail連結="https://mail.google.com/..."
- **THEN** the card SHALL display "02/15 14:30", "星巴克", "NT$150", a "富邦" badge, and a clickable link icon opening the Gmail URL

#### Scenario: Transactions sorted by date descending
- **WHEN** the sidebar shows multiple transactions
- **THEN** transactions SHALL be sorted by 授權日期時間 in descending order (newest first)

### Requirement: Sidebar styling
The sidebar SHALL use a modern card-based design with: colored bank badges (different colors for 富邦 vs 國泰), alternating card backgrounds, proper Chinese font rendering, and responsive layout within the 300px sidebar width.

#### Scenario: Bank badge colors
- **WHEN** a transaction is from 富邦
- **THEN** the badge SHALL use a distinct color (e.g., blue) different from 國泰 (e.g., green)
