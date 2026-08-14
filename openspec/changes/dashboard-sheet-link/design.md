## Context

The dashboard is a standing tab served by `doGet` from `sidebar/程式碼.js`. The bound spreadsheet is the source of truth (`CFG.SPREADSHEET_ID` via `getSpreadsheet_()`), but the page has no in-page control to open it. The heading **交易 Dashboard** is already sticky (`.head { position: sticky }`). The page sets `<base target="_top">`, so a plain `<a>` would navigate the Web App iframe away from the dashboard. CT-21 already added a Gmail envelope on `editRow` (`.mail`); this control is a different destination and must use a different glyph.

## Goals / Non-Goals

**Goals:**
- Place a quiet spreadsheet-grid icon immediately to the right of **交易 Dashboard**.
- Click (and Cmd-click / right-click "open in new tab") opens the bound spreadsheet in a new browser tab; the dashboard tab stays put.
- Inject the URL from `doGet` the same way `now` is injected, so the spreadsheet id stays only in `CFG.SPREADSHEET_ID`.
- Keep `＋ 新增` as the only CTA in that row; the icon is muted, accent on hover.
- Stay visible with the sticky header. Narrow width must not shove `＋ 新增` off the row.

**Non-Goals:**
- Hard-coding a `gid` (Google remembers the last tab).
- Changing the footer "即時讀取自 Transactions".
- Reusing the CT-21 envelope glyph or putting this control on `editRow`.
- Opening the sheet inside the dashboard, or a `google.script.run` hop.

## Decisions

**D1 — Real `<a target="_blank" rel="noopener">`, not a button.** Cmd-click and the context menu only work on an actual href. `_blank` is mandatory because of `<base target="_top">`. `rel="noopener"` is the usual new-tab hygiene.

**D2 — Inject `sheetUrl` from `doGet`.** `t.sheetUrl = getSpreadsheet_().getUrl()` and `var SHEET_URL = '<?= sheetUrl ?>';` mirrors `t.now` / `NOW`. The frontend never mentions `CFG.SPREADSHEET_ID`. No hard-coded `gid`.

**D3 — Sheet-grid SVG, not the CT-21 envelope.** Two destinations stay visually distinct. Class `.sheet-link` (not `.mail`). `title` / `aria-label`: "Open spreadsheet". Muted (`--text-muted`), accent on hover.

**D4 — Immediately right of `.title`, not a second CTA.** Wrap title + icon in `.title-row` (`inline-flex`, centered). The right cluster (period + `＋ 新增`) keeps `flex-shrink: 0` so the add button is not shoved off a narrow row.

**D5 — Helper `sheetLink()` next to `mailLink()`.** `render()` concatenates it after the title text. The Node fixture extracts that helper (and asserts `render`'s title HTML contains the anchor) the same way CT-21 extracts `mailLink` / `editRow`.

## Risks / Trade-offs

- [`<base target="_top">` forgotten] → `_blank` is set on the tag, not inherited.
- [Confusion with the Gmail envelope] → grid SVG + `.sheet-link`, never `.mail`.
- [URL injection as a JS string] → spreadsheet `getUrl()` is a docs.google.com path with no quotes; `esc(SHEET_URL)` is still used on the href.
- [Narrow header] → title-row can shrink; add-button cluster does not.

## Migration Plan

1. Edit `sidebar/程式碼.js` (`doGet`) and `sidebar/ToolPanel.html` (CSS + title). Add a Node fixture that asserts the title HTML contains `<a class="sheet-link" … target="_blank" rel="noopener">` with the injected URL.
2. Merge to `main` (push-to-deploy). No data migration.
3. Rollback: `git revert` and let the normal deploy path run.

## Open Questions

None — the ticket's Change / Acceptance is the design.
