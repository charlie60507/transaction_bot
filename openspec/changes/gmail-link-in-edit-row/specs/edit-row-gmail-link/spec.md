## ADDED Requirements

### Requirement: Gmail permalink on editRow when link is set

When `editRow` renders a transaction whose `link` is a non-empty string, the first line SHALL include a quiet envelope icon as a real `<a>` whose `href` is that permalink, placed to the left of the amount. The anchor SHALL have `target="_blank"` and `rel="noopener"`. Its `title` and `aria-label` SHALL be "Open original email". The icon SHALL be muted and use the accent color on hover. The control SHALL appear wherever `editRow` is used (heatmap day editor and 待記帳 queue).

#### Scenario: Auto-recorded row shows a new-tab Gmail link

- **WHEN** `editRow` is called with a transaction whose `link` is a non-empty Gmail permalink
- **THEN** the returned HTML contains an `<a>` with that href, `target="_blank"`, and `rel="noopener"`, to the left of the amount
- **AND** clicking it (including Cmd-click / right-click "open in new tab") opens Gmail in a new browser tab without navigating the dashboard

#### Scenario: Envelope is distinct from a spreadsheet icon

- **WHEN** the Gmail control is shown
- **THEN** it uses an envelope (or similarly mail-like) SVG, not a spreadsheet/grid glyph

### Requirement: Manual rows omit the Gmail control

When `editRow` renders a transaction whose `link` is empty, the first line SHALL NOT include a Gmail anchor or a disabled placeholder icon.

#### Scenario: Empty link renders no icon

- **WHEN** `editRow` is called with a transaction whose `link` is `""`
- **THEN** the returned HTML contains no Gmail permalink `<a>`

### Requirement: Read-only txnRow has no mail link

Read-only `txnRow` (category drilldown and 項目 largest-transaction lists) SHALL NOT render a Gmail permalink. Those surfaces are statistics, not editors.

#### Scenario: Category and project lists stay link-free

- **WHEN** `txnRow` renders a transaction that has a non-empty `link`
- **THEN** the returned HTML still contains no Gmail permalink `<a>`
