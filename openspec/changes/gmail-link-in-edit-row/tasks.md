## 1. editRow Gmail control

- [x] 1.1 Add muted/hover-accent `.mail` styles and an envelope SVG (not a spreadsheet glyph)
- [x] 1.2 In `editRow` first line, left of the amount: if `t.link` is non-empty, render `<a href="…" target="_blank" rel="noopener" title="Open original email" aria-label="Open original email">`; if empty, render nothing
- [x] 1.3 Leave `txnRow` unchanged (no mail link on category drilldown / 項目 lists)

## 2. Fixture + gate

- [x] 2.1 Add `test/dashboard_gmail_link.js` that extracts `editRow` / `txnRow` from `ToolPanel.html`, feeds mock TXNS, and asserts: non-empty link → anchor with `target="_blank"` and `rel="noopener"`; empty link → no anchor; `txnRow` never has the anchor
- [x] 2.2 Wire the fixture so `node check_sidebar.js` runs it (CI gate still that command)
- [x] 2.3 `node check_sidebar.js` exits 0
