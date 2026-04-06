## Context

The spreadsheet has a Dashboard sheet with a pivot table: rows are year-months (e.g., `2025 3`), columns are spending categories (飲食, 交通, 娛樂, ...), and cells contain summed amounts. The raw data lives in the Transactions sheet with columns: 已記帳(A), 銀行(B), 授權日期時間(C), 卡末四碼(D), 金額_NTD(E), 交易內容/商店(F), 類別(G), Gmail連結(H), MessageId(I), 收支(J).

The Dashboard pivot starts at row 1 (header) with year in column A and month in column B. Category columns start at C. The right side of the Dashboard has a daily detail list (columns R-T: date, merchant, amount) which is separate from the pivot.

## Goals / Non-Goals

**Goals:**
- Let users click any cell in the Dashboard pivot area, then open a sidebar showing the matching transactions
- Sidebar should be visually polished: summary stats, card-style transaction list, bank badges, clickable Gmail links
- Detect year, month, and category from the selected cell's position in the pivot

**Non-Goals:**
- Modifying the Dashboard pivot structure or formulas
- Supporting drill-down from the daily detail list (right side of Dashboard)
- Adding charts or graphs to the sidebar
- Supporting multi-cell selection or cross-month queries

## Decisions

### 1. HTML Sidebar over Modal Dialog

**Choice**: Use `SpreadsheetApp.getUi().showSidebar()` with `HtmlService`.

**Rationale**: Sidebar stays open while the user continues viewing the Dashboard. A modal dialog blocks interaction. Sidebar width (300px default) is enough for a transaction list.

**Alternative considered**: Modal dialog — rejected because it blocks the spreadsheet and requires dismissal.

### 2. Separate HTML template file

**Choice**: Create a `DrilldownSidebar.html` file for the sidebar UI, using Apps Script's `HtmlService.createTemplateFromFile()` with templated data injection.

**Rationale**: Keeps HTML/CSS separate from JS logic. Apps Script supports `.html` files pushed via clasp. Templating allows server-side data injection without client-side API calls.

**Alternative considered**: Building HTML as a string in JS — rejected for maintainability.

### 3. Cell position detection from Dashboard layout

**Choice**: Read the active cell's row and column. Map row to year+month using columns A+B. Map column to category using the header row (row 1). Then filter Transactions by matching month range and category.

**Rationale**: The pivot layout is stable (year in A, month in B, categories in C onward). Reading header labels makes it resilient to column reordering.

**Alternative considered**: Named ranges — overkill for a simple pivot layout.

### 4. Filtering logic on server side

**Choice**: Filter Transactions data in Apps Script (server-side), pass pre-filtered results to the HTML template.

**Rationale**: Avoids `google.script.run` async calls from client-side JS. Simpler, faster, single render.

## Risks / Trade-offs

- **Dashboard layout changes** → If the user restructures the pivot (moves columns, adds rows above), cell detection breaks. Mitigation: read category from the header row dynamically, not by hardcoded column index.
- **Large transaction volume** → If a month has hundreds of transactions in one category, the sidebar HTML could be slow. Mitigation: unlikely given personal spending; cap at 200 rows if needed.
- **Non-pivot cell selected** → User clicks a cell outside the pivot area (e.g., the daily list on the right). Mitigation: validate that the selected column maps to a known category; show a friendly error if not.
