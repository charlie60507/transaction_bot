## ADDED Requirements

### Requirement: Spreadsheet icon next to the sticky title

The sticky heading **交易 Dashboard** SHALL have a quiet spreadsheet-grid icon immediately to its right. The control SHALL be a real `<a class="sheet-link">` whose `href` is the URL injected from `doGet` (`getSpreadsheet_().getUrl()` → `t.sheetUrl` → `SHEET_URL`). The anchor SHALL have `target="_blank"` and `rel="noopener"`. Its `title` and `aria-label` SHALL be "Open spreadsheet". The icon SHALL be muted (`--text-muted`) and use the accent color on hover. It SHALL NOT be a second primary button — `＋ 新增` remains the only CTA in that row. The SVG SHALL be a sheet grid (or similarly spreadsheet-like), not an emoji and not the CT-21 Gmail envelope. The href SHALL NOT hard-code a `gid`.

#### Scenario: Title row contains a new-tab spreadsheet link

- **WHEN** the dashboard `render()` builds the sticky header
- **THEN** the title HTML contains an `<a class="sheet-link">` with `target="_blank"` and `rel="noopener"` whose `href` is the injected spreadsheet URL
- **AND** clicking it (including Cmd-click / right-click "open in new tab") opens the spreadsheet in a new browser tab without navigating the dashboard

#### Scenario: Icon stays with the sticky heading

- **WHEN** the page is scrolled
- **THEN** the icon remains visible next to **交易 Dashboard** because it lives inside the sticky `.head`

#### Scenario: Glyph is distinct from the Gmail envelope

- **WHEN** the spreadsheet control is shown
- **THEN** it uses a sheet-grid SVG, not the envelope used on `editRow`

### Requirement: Header row keeps ＋ 新增 as the only CTA

The spreadsheet icon SHALL be visually quiet. On a narrow viewport the title-and-icon cluster MAY shrink, but `＋ 新增` SHALL remain on the same header row.

#### Scenario: Narrow width does not shove the add button off the row

- **WHEN** the dashboard is viewed at a narrow width
- **THEN** the `＋ 新增` button remains visible on the header row

### Requirement: Footer and spreadsheet id are unchanged

The footer line "即時讀取自 Transactions" SHALL NOT change. The spreadsheet id SHALL remain only in `CFG.SPREADSHEET_ID`; the frontend SHALL receive the URL via `var SHEET_URL = '<?= sheetUrl ?>';`.

#### Scenario: Footer copy and CFG id stay put

- **WHEN** the page renders
- **THEN** the footer still reads "即時讀取自 Transactions"
- **AND** the frontend does not contain a hard-coded spreadsheet id or `gid`
