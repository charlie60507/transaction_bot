## 1. Bring bot code into the bound project  [me]

- [x] 1.1 Copy `cards_transaction_bot.js` → `sidebar/cards_transaction_bot.js` (keep the root copy frozen as the live fallback)
- [x] 1.2 Rename the bot's `CFG` → `GMAIL_CFG` (definition + all references) to clear the sole global collision with the dashboard's `CFG`
- [x] 1.3 Fix the 國泰 transfer path so recorded transfers write 收支別 (J) = 轉帳; keep the default-支出 for ordinary rows
- [x] 1.4 Keep `openById(SPREADSHEET_ID)` for now (behavior-identical); do NOT push yet
- [x] 1.5 Offline sanity: confirm no duplicate top-level names remain between the two sidebar files

## 2. Bound-project Script Properties  [you — Apps Script UI]

- [x] 2.1 In the BOUND project → Project Settings → Script Properties, copy from the standalone project: `SPREADSHEET_ID`, `GEMINI_API_KEY`, `FUBON_QUERY_SUBJECT`, `CATHAY_LABEL`, `CATHAY_SUBJECT`, `HEADER`, `TZ`, `SORT_ORDER` (only those that are set)

## 3. Push + authorize + verify  [me push, you auth/verify]

- [x] 3.1 [me] `clasp push` from `sidebar/` (bot code now in the bound project, inert without a trigger)
- [x] 3.2 [you] Run `appendLast7DaysToSheet()` once manually in the bound project; grant the Gmail + UrlFetch consent prompt
- [x] 3.3 [you] Check the execution log: rows recorded + classified, no errors; confirm a 轉帳 row shows 收支別 (J) = 轉帳

## 3b. OAuth unblock (unplanned detour, done)  [you — Cloud Console]

- [x] 3b.1 Gmail restricted scope hard-blocked on the default GCP project; created a standard GCP project `cards-dashboard`
- [x] 3b.2 Configured OAuth consent screen (External, Testing) + added self as Test user; linked the bound project to it; authorized

## 4. Cutover  [you — Apps Script UI]

- [x] 4.1 Create a time-driven trigger on `appendLast7DaysToSheet` in the BOUND project
- [x] 4.2 DISABLE the standalone project's time trigger (order matters — do this right after 4.1)
- [x] 4.3 Observe one trigger cycle: exactly one project records, no duplicates

## 5. Same-spreadsheet swap  [me — gated on your confirmation]

- [ ] 5.1 [you] Confirm the bound project's container spreadsheet == the bot's `SPREADSHEET_ID`
- [ ] 5.2 [me] Swap `openById(SPREADSHEET_ID)` → `getActiveSpreadsheet()`; drop the `SPREADSHEET_ID` dependency; push

## 6. Retire the standalone project  [me code, you cloud]

- [ ] 6.1 [me] Delete root `cards_transaction_bot.js` and root `.clasp.json`; single `.clasp.json` remains
- [ ] 6.2 [me] Commit; verify `clasp status` from `sidebar/` still tracks all bound files
- [ ] 6.3 [you] Optionally delete the retired standalone Apps Script project
- [ ] 6.4 Archive the OpenSpec change once the bound pipeline is confirmed stable
