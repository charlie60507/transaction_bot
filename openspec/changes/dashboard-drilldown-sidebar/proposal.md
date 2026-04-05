## Why

The Dashboard sheet shows monthly spending totals by category (e.g., "飲食 $10,000 in February"), but there's no way to quickly see which individual transactions make up that total. Users must manually switch to the Transactions sheet, visually scan dates and categories, and mentally tally. A drill-down sidebar would let users click any Dashboard total and instantly see the underlying transactions.

## What Changes

- **Custom menu**: Add a "交易工具 → 查看明細" menu item to the spreadsheet toolbar
- **HTML Sidebar**: When triggered, open a styled sidebar on the right side that shows:
  - Header with the selected month and category
  - Summary stats: total amount, transaction count, daily average, largest transaction
  - Card-style transaction list with date, merchant, amount, bank badge, and clickable Gmail link
  - Styled with colors, icons, and responsive layout
- **Cell detection**: Read the currently selected cell on the Dashboard pivot table to determine which month (from row) and category (from column header) to filter by
- **Transaction filtering**: Query the Transactions sheet for matching rows by date range and category

## Capabilities

### New Capabilities

- `drilldown-sidebar`: HTML sidebar UI that displays filtered transaction details from a Dashboard cell selection
- `custom-menu`: Apps Script custom menu registration for triggering the sidebar

### Modified Capabilities

(None)

## Impact

- **Files**: `cards_transaction_bot.js` — new functions for menu, cell detection, filtering, and sidebar rendering; new HTML template file for the sidebar UI
- **Dependencies**: Uses Apps Script `HtmlService` for sidebar rendering
- **UX**: Non-breaking addition — existing functionality is unchanged; the sidebar is an opt-in interaction via the custom menu
