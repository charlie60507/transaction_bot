## Why

The dashboard is the standing tab; Gmail is opened only when a row looks wrong. `getAllTxns()` already returns `link` (column H, the Gmail permalink the bot stored), but the page never renders it. Auto-recorded rows therefore force a leave-and-search detour, while the evidence belongs on the edit row's first line.

## What Changes

- In `editRow` (`sidebar/ToolPanel.html` only): if `t.link` is non-empty, render a quiet envelope icon as a real `<a href="…" target="_blank" rel="noopener">` on the first line, to the left of the amount.
- If `t.link` is empty (manual rows), render nothing — no disabled icon.
- Do not add the link on read-only `txnRow` (category accordion, 項目 largest-txn lists). Those are statistics, not editing surfaces.
- No server change. `link` is already on the payload. No new `google.script.run` target.

## Capabilities

### New Capabilities
- `edit-row-gmail-link`: show a new-tab Gmail permalink on `editRow` when `t.link` is set; omit it when empty; never add it to read-only `txnRow`.

### Modified Capabilities
<!-- None — existing drilldown / tag-summary / custom-menu / category-config requirements are unchanged. -->

## Impact

- **sidebar/ToolPanel.html** (frontend): `editRow` first line plus a muted/hover-accent envelope style. The page has `<base target="_top">`, so `_blank` is mandatory or the Web App iframe navigates away.
- **sidebar/程式碼.js**: unchanged.
- Distinct from CT-20's spreadsheet icon (not in this change). Offline fixture asserts the anchor is present iff `link` is set and carries `target="_blank"`.
