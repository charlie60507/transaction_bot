## 1. Inject URL + title control

- [x] 1.1 In `doGet`, set `t.sheetUrl = getSpreadsheet_().getUrl()` (same injection path as `now`)
- [x] 1.2 In `ToolPanel.html`, add `var SHEET_URL = '<?= sheetUrl ?>';`, muted/hover-accent `.sheet-link` / `.title-row` styles, and a sheet-grid SVG (not the Gmail envelope)
- [x] 1.3 Add `sheetLink()` and render it immediately to the right of **交易 Dashboard** as `<a class="sheet-link" href="…" target="_blank" rel="noopener" title="Open spreadsheet" aria-label="Open spreadsheet">`. Keep `＋ 新增` as the only CTA; do not change the footer; do not hard-code `gid`

## 2. Fixture + gate

- [x] 2.1 Add `test/dashboard_sheet_link.js` that extracts `sheetLink` (and asserts the title HTML in `render`) from `ToolPanel.html`, feeds the injected URL, and asserts `<a class="sheet-link" … target="_blank" rel="noopener">` with that href
- [x] 2.2 Wire the fixture so `node check_sidebar.js` runs it (CI gate still that command; it already picks up `test/dashboard_*.js`)
- [x] 2.3 `node check_sidebar.js` exits 0
