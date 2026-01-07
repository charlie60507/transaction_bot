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

### Local files (not committed)
- `.env` (ignored): keep local copies of config values.
- `.clasp.json`: points to your Script ID; already present in this repo.

### Configure Script Properties (recommended)
Use the built-in helper once per project to avoid hardcoding secrets:
```bash
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
```bash
# login (once)
clasp login

# push code to Apps Script
clasp push

# test run
clasp run appendLast7DaysToSheet --params '[]'
```

### Triggers
In the Apps Script UI, add a time-based trigger (e.g., hourly) for `appendLast7DaysToSheet`.

### Notes
- Keep `.env` out of version control (already ignored).
- Logs are in English; data values remain as-is (Chinese headers) to match the sheet schema.

