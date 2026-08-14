## Why

The dashboard is kept open as a standing tab; the Google Sheet is opened only when something actually needs the spreadsheet (bulk edits, Deleted rows, a formula). There is currently no way to get there from the page — you have to find the Sheet in Drive or a bookmark. The browser-tab favicon is not clickable, so this has to be an in-page control.

## What Changes

- Add a quiet spreadsheet icon immediately to the right of the sticky heading **交易 Dashboard**. Clicking it opens the bound spreadsheet in a new tab, so the dashboard tab stays put.
- Real `<a target="_blank" rel="noopener">`, not a `google.script.run` call. Right-click / Cmd-click must work. The page has `<base target="_top">`, so `_blank` is required or the Web App iframe navigates away.
- Muted (`--text-muted`), accent on hover. Not a second primary button — `＋ 新增` stays the only CTA in that row.
- Small SVG (sheet grid), not an emoji, and distinct from the CT-21 Gmail envelope on `editRow`.
- `title` / `aria-label`: "Open spreadsheet".
- Inject the spreadsheet URL from `doGet` via `getSpreadsheet_().getUrl()` the same way `now` is injected (`t.sheetUrl` → `var SHEET_URL = '<?= sheetUrl ?>'`), so the id stays only in `CFG.SPREADSHEET_ID`. Do not hard-code `gid`.
- Do not change the footer line "即時讀取自 Transactions".

## Capabilities

### New Capabilities
- `title-spreadsheet-link`: a quiet new-tab link to the bound spreadsheet, sitting immediately to the right of the sticky **交易 Dashboard** heading.

### Modified Capabilities
<!-- None — existing drilldown / tag-summary / custom-menu / category-config / edit-row-gmail-link requirements are unchanged. -->

## Impact

- **sidebar/程式碼.js**: `doGet` injects `sheetUrl` from `getSpreadsheet_().getUrl()`.
- **sidebar/ToolPanel.html**: `.sheet-link` next to `.title` in `render()`, plus muted/hover-accent CSS. Frontend: `var SHEET_URL = '<?= sheetUrl ?>';`
- Distinct from CT-21's Gmail envelope (different destination; different glyph). Offline fixture asserts the title HTML contains `<a class="sheet-link" … target="_blank" rel="noopener">` with the injected URL.
