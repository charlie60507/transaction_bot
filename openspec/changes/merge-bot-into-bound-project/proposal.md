## Why

The project is split across two separate Apps Script projects that both operate on the same Transactions spreadsheet: a **standalone** auto-record/auto-categorize bot (`cards_transaction_bot.js`, scriptId `18WyCJz…`, reads Gmail → writes rows → classifies) and a **bound** dashboard (`sidebar/程式碼.js` + `ToolPanel.html`, scriptId `1P4l2DY…`, menus / sidebar / web-app). Two projects means two authorizations, two `.clasp.json` files (the source of a real "already up to date" mis-push), two places to edit, and an integration gap where the bot writes 收支別 (J) = 支出 even for 國泰 transfers while the dashboard now keys transfers off J = 轉帳. Consolidating into one project removes all of that.

## What Changes

- Consolidate both projects into the **single bound project** (the only viable target: a bound script can do everything the standalone bot does — GmailApp, UrlFetch/Gemini, LockService, time triggers — PLUS the menu/sidebar/`getUi()` that a standalone script legally cannot; the bot file itself documents this limitation).
- Bring the bot's code into `sidebar/` so it is pushed to the bound project. Resolve the **one** global-name collision (`CFG`, the only name defined at top level in both files) by renaming the bot's `CFG` (Gmail query config).
- **BREAKING (behavior):** fix the 國泰 transfer path so newly recorded transfers write 收支別 (J) = 轉帳 instead of defaulting to 支出, so auto-recorded transfers are recognized by the dashboard's transfer handling.
- Move sheet access from `SpreadsheetApp.openById(SPREADSHEET_ID)` to `getActiveSpreadsheet()` (a later step, gated on confirming both projects target the same spreadsheet), dropping the `SPREADSHEET_ID` Script Property dependency.
- Retire the standalone project and the root `.clasp.json`, leaving a single `.clasp.json`.

## Capabilities

### New Capabilities
- `auto-record-bot`: the Gmail-driven auto-record + auto-categorize pipeline, now hosted in the bound project — documents where it lives, how it is triggered, and the transfer (收支別) contract it must honor.

### Modified Capabilities
<!-- None of the existing archived specs (category-config, custom-menu, drilldown-sidebar, tag-summary) change behavior; this is a hosting/consolidation move plus one transfer-column fix captured under the new capability. -->

## Impact

- **Code:** `cards_transaction_bot.js` relocated into `sidebar/` and adapted (CFG rename, transfer-J fix, later `getActiveSpreadsheet`). Dashboard code unchanged in behavior.
- **clasp:** root `.clasp.json` removed; single `sidebar` project remains. Fixes the two-config foot-gun.
- **Cloud (operator-only, cannot be done from the repo):** copy Script Properties (`GEMINI_API_KEY`, Gmail queries, `SPREADSHEET_ID`, `HEADER`, …) into the bound project; re-authorize the added Gmail + UrlFetch scopes; recreate the time-driven trigger on `appendLast7DaysToSheet` in the bound project and disable the old standalone trigger.
- **Risk of double-recording** during cutover is bounded by the existing strict + loose + MessageId dedup, but the standalone trigger MUST be disabled once the bound one runs.
