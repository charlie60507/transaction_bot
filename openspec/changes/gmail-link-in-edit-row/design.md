## Context

`editRow` is the editing surface for one transaction. It already appears in the heatmap day editor and the 待記帳 queue. The first line is "what is this charge" (bank, time, merchant, amount); the second is actions. `getAllTxns()` already returns `link` (Sheet column H). Manual rows have an empty link. The page sets `<base target="_top">`, so a plain `<a>` would navigate the Web App iframe away from the dashboard.

## Goals / Non-Goals

**Goals:**
- Surface the Gmail permalink on `editRow` when `t.link` is non-empty, as a real new-tab link left of the amount.
- Omit the control entirely when `link` is empty.
- Keep Cmd-click / right-click "open in new tab" working (must be an `<a>`, not a click handler).

**Non-Goals:**
- Server or payload changes.
- Adding the link to read-only `txnRow`.
- CT-20's spreadsheet icon (a different destination; must not reuse that glyph).
- Opening Gmail inside the dashboard.

## Decisions

**D1 — Real `<a target="_blank" rel="noopener">`, not a button.** Cmd-click and the context menu only work on an actual href. `_blank` is mandatory because of `<base target="_top">`. `rel="noopener"` is the usual new-tab hygiene.

**D2 — Envelope SVG, not the CT-20 sheet glyph.** Two destinations stay visually distinct. Muted (`--text-muted`), accent on hover. `title` / `aria-label`: "Open original email".

**D3 — Left of the amount on `.er1`.** The mail is evidence for the charge, not a second-line action. Empty `link` adds no node (no disabled placeholder).

**D4 — Frontend only.** `t.link` is already on every `getAllTxns()` row.

## Risks / Trade-offs

- [Broken or stale permalink] → still a real link; Gmail shows its own error. We do not validate URLs.
- [`<base target="_top">` forgotten] → `_blank` is set on the tag, not inherited.
- [Confusion with a future sheet icon] → envelope, not a grid/spreadsheet glyph.

## Migration Plan

1. Edit `sidebar/ToolPanel.html`; add a Node fixture that extracts `editRow` and asserts the anchor.
2. Merge to `main` (push-to-deploy). No data migration.
3. Rollback: `git revert` and let the normal deploy path run.

## Open Questions

None — the ticket's Change / Acceptance is the design.
