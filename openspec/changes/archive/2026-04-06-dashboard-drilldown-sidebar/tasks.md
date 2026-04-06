## 1. Custom Menu

- [x] 1.1 Add `onOpen()` function that registers "交易工具" menu with "查看明細" item
- [x] 1.2 Wire the menu item to call `showDrilldownSidebar()` function

## 2. Cell Detection & Filtering

- [x] 2.1 Implement `getDrilldownContext_()` — read active cell on Dashboard, extract year+month from row, category from column header
- [x] 2.2 Validate the selection: check active sheet is Dashboard, cell is within the pivot area, column maps to a known category
- [x] 2.3 Implement `filterTransactions_()` — query Transactions sheet for rows matching the month range and category, return sorted results (newest first)
- [x] 2.4 Compute summary stats: total, count, daily average, largest transaction

## 3. HTML Sidebar UI

- [x] 3.1 Create `DrilldownSidebar.html` with templated layout: header (month + category + stats), transaction card list, empty/error states
- [x] 3.2 Style the sidebar: card-based design, bank badges (富邦=blue, 國泰=green), comma-formatted amounts, clickable Gmail link icons, Chinese-friendly fonts
- [x] 3.3 Implement `showDrilldownSidebar()` — orchestrate context detection, filtering, template rendering, and sidebar display via `HtmlService`

## 4. Error Handling

- [x] 4.1 Show alert if active sheet is not Dashboard
- [x] 4.2 Show friendly message in sidebar if selected cell is outside pivot area
- [x] 4.3 Show empty state in sidebar if no transactions match

## 5. Deploy & Verify

- [x] 5.1 Update `.claspignore` if needed and push via `clasp push`
- [x] 5.2 Verify menu appears on spreadsheet open and sidebar renders correctly
