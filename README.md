## Cards Transaction Bot (Apps Script)

English README describing how to run, configure, and deploy this Apps Script project that ingests Gmail credit card notifications (Fubon and Cathay) and **Cube App Transfers**. It parses transactions and appends the **last 7 days** of data into a Google Sheet.

### What it does
- **Consumption**: Scans Gmail for Fubon (one record per email) and Cathay (multiple records per email) transactions.
- **Transfers**: Scans Cathay Cube App transfer notifications.
- **Retention**: Fetches the last **7 days** of transactions to ensure no data loss over weekends or holidays.
- **Robust Deduplication**:
    - **General**: Checks `Bank + MessageId + Time + Last4 + Amount`.
    - **Transfers**: Uses **Strict MessageID Check** (if MessageID exists, skip) + Fallback Loose Check (Time + Amount) for legacy data.
- **Auto-Formatting**: Appends parsed rows and defaults "Income/Expense" column to "支出".

### Prerequisites
- Node.js and `npm`
- `@google/clasp` installed globally: `npm install -g @google/clasp`
- Google account with access to the target Spreadsheet and Gmail
- Apps Script API enabled (https://script.google.com/home/usersettings)

### Where the Apps Script projects live
There are two Apps Script projects, one folder each. Run every `clasp` command from the
folder of the project you are changing, never from the repo root.

- `sidebar/` — the dashboard, the Gmail import, and the `Ledger` library facade
  (`sidebar/line_ledger.js`) that the LINE bot calls.
- `linebot/` — the LINE webhook (see "LINE bot" below).

`.env` (ignored) is the place for local copies of config values.

### Configure Script Properties (recommended)
Use the built-in helper once per project to avoid hardcoding secrets:
```bash
cd sidebar
clasp run setScriptProperties --params '[{
  "SPREADSHEET_ID":"<YOUR_SPREADSHEET_ID>",
  "TZ":"Asia/Taipei",
  "SHEET_NAME":"Transactions",
  "HEADER":"[\"已記帳\",\"銀行\",\"授權日期時間\",\"卡末四碼\",\"金額_NTD\",\"交易內容/商店\",\"類別\",\"Gmail連結\",\"MessageId\"]",
  "FUBON_QUERY_SUBJECT":"(subject:\"即時消費通知\" OR subject:\"富邦信用卡消費通知\" OR subject:\"富邦信用卡即時消費通知\")",
  "CATHAY_LABEL":"國泰世華消費",
  "CATHAY_SUBJECT":"消費彙整通知"
}]'
```
Script Properties persist across triggers; you set them once unless you change targets.

### Deploy / update
Pushing to `main` with changes under `sidebar/**` deploys the dashboard by itself (see
CLAUDE.md); the commands below are the manual fallback.
```bash
# login (once)
clasp login

# push code to Apps Script — from sidebar/, the only clasp config in the repo
cd sidebar
clasp push

# test run
clasp run appendLast7DaysToSheet --params '[]'
```

### Triggers
In the Apps Script UI, add a time-based trigger (e.g., hourly) for `appendLast7DaysToSheet`.

### Notes
- Keep `.env` out of version control (already ignored).
- Logs are in English; data values remain as-is (Chinese headers) to match the sheet schema.

### LINE bot (`linebot/`)
Records a transaction from one free-text LINE message sent to the owner's bot. Every sheet
read and write goes through the dashboard project, included as the library `Ledger` with
`developmentMode: true`: LINE rows are written by `addTxn`'s own row code under the dashboard's
script lock, and a `sidebar/` push changes LINE behaviour with no `linebot` redeploy. Deploying
either project never redeploys the other. `node check_sidebar.js` verifies that every
`Ledger.<fn>(` call in `linebot/` resolves to a public function in `sidebar/`.

One-time setup (the owner, after merge):

1. **Create the project.** In an empty scratch directory, `clasp create --type standalone --title linebot`,
   then copy the new `scriptId` into `linebot/.clasp.json`, replacing
   `REPLACE_WITH_LINEBOT_SCRIPT_ID`. The scriptId is not a secret.
2. **Library.** `linebot/appsscript.json` already points at the dashboard project
   (`libraryId` = the scriptId in `sidebar/.clasp.json`) as `Ledger`, version `1`, with
   `developmentMode: true`, so the version number only has to exist; HEAD is what runs.
   Both projects use `Asia/Taipei`.
3. **Push** from `linebot/`: `cd linebot && clasp push -f`.
4. **Script Properties** of the `linebot` project (Project Settings → Script Properties).
   Names only; the values never go into this repo, a fixture, or a log:
   - `CHANNEL_ACCESS_TOKEN` — the channel access token (reply API only; push is never called);
   - `OWNER_USER_ID` — the owner's LINE userId for this channel; every other sender is ignored;
   - `WEBHOOK_SECRET` — a long random string that must arrive as `?k=<secret>` on the webhook URL.
   The Gemini key is NOT duplicated: the parse runs inside the library and reads the
   dashboard's `GEMINI_API_KEY`.
5. **Authorize once** in the Apps Script editor (run any function, accept the spreadsheet and
   external-request scopes).
6. **First deploy** as a web app (Execute as: me; Who has access: anyone) and record the
   deployment id; later deploys must reuse it with `clasp deploy -i <id>`.
7. **Cut over:** in LINE Developers, set the channel's webhook URL to
   `<exec URL>?k=<WEBHOOK_SECRET>`. The console's "Verify" button may complain about the Apps
   Script 302 redirect; delivery still works.

**Rollback** is pointing the webhook back at the old `Linebot-response` deployment, which is
left untouched.

Runtime state lives in the `linebot` project's own Script Properties: `evt:<webhookEventId>`
(redelivery guard, 7 days), `pend:<token>` (an account choice waiting for a tap, 24 hours) and
`done:<token>` (a used or cancelled choice, 24 hours). All three are pruned on every call.
