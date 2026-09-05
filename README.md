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

### Where the Apps Script project lives
Everything pushed to Apps Script lives in `sidebar/`, and `sidebar/.clasp.json` is the
only clasp config in the repo — so every `clasp` command below is run from `sidebar/`,
never from the repo root. `.env` (ignored) is the place for local copies of config values.

### Configure Script Properties (recommended)
Use the built-in helper once per project to avoid hardcoding secrets:
```bash
cd sidebar
clasp run setScriptProperties --params '[{
  "ENVIRONMENT":"PRODUCTION",
  "SCRIPT_ID":"<THIS_APPS_SCRIPT_PROJECT_ID>",
  "SPREADSHEET_ID":"<YOUR_SPREADSHEET_ID>",
  "DEPLOYMENT_ID":"<PINNED_DEPLOYMENT_ID>",
  "PRODUCTION_SCRIPT_ID":"<PRODUCTION_APPS_SCRIPT_PROJECT_ID>",
  "PRODUCTION_SPREADSHEET_ID":"<PRODUCTION_SPREADSHEET_ID>",
  "PRODUCTION_DEPLOYMENT_ID":"<PRODUCTION_DEPLOYMENT_ID>",
  "DEPLOYMENT_SCRIPT_ID":"<THIS_APPS_SCRIPT_PROJECT_ID>",
  "TZ":"Asia/Taipei",
  "SHEET_NAME":"Transactions",
  "HEADER":"[\"已記帳\",\"銀行\",\"授權日期時間\",\"卡末四碼\",\"金額_NTD\",\"交易內容/商店\",\"類別\",\"Gmail連結\",\"MessageId\"]",
  "FUBON_QUERY_SUBJECT":"(subject:\"即時消費通知\" OR subject:\"富邦信用卡消費通知\" OR subject:\"富邦信用卡即時消費通知\")",
  "CATHAY_LABEL":"國泰世華消費",
  "CATHAY_SUBJECT":"消費彙整通知"
}]'
```

## Stage isolation

Stage is a separate Apps Script project, Google Sheet, web-app deployment, Script
Properties set, credentials, and Gmail trigger installation. The repository keeps
one canonical source tree; environment-specific identifiers and credentials are
never committed. Every project must have these Script Properties before serving
the dashboard or running the bot: `ENVIRONMENT` (`STAGE` or `PRODUCTION`),
`SCRIPT_ID`, `SPREADSHEET_ID`, and `DEPLOYMENT_ID`. Stage must also set the three
`PRODUCTION_*` guard properties to prevent accidental cross-targeting.

Stage must additionally set `GMAIL_STAGE_ACCOUNT`, `GMAIL_STAGE_MARKER`,
`FUBON_QUERY_SUBJECT`, `FUBON_TRANSFER_QUERY`, `CATHAY_LABEL`, and
`CATHAY_SUBJECT`. The marker must match `STAGE-<12+ uppercase letters or digits>`
and appear as a bounded token in every Stage query, label, and subject; the
runtime rejects missing or unmarked values instead of falling back to the
Production Gmail defaults. `GMAIL_STAGE_ACCOUNT` documents the dedicated mailbox
and the runtime verifies that it matches the executing Apps Script account; Gmail
triggers must be installed only in that project and mailbox.

Create the Stage project and Sheet separately, install only Stage Gmail triggers
using a dedicated test mailbox/label, then set its properties from that project.
Run `clasp run resetStageData` only against Stage. It creates or verifies
`Transactions`, `Deleted`, and `META`, verifies and repairs their exact headers,
clears rows while preserving the load-bearing `Deleted` tab and headers, and
writes deterministic synthetic data.
The dashboard header and bot logs identify the selected environment.

### Cloud isolation verification status

Repository verification is **blocked** from claiming cloud isolation. The exact
evidence still required from the owner or an authenticated cloud audit is:

- the Stage and Production Apps Script project IDs, proving they differ;
- the selected Stage and Production deployment inventories, with each deployment
  resolved to its owning script project;
- the Stage and Production spreadsheet IDs and sentinel read/write observations;
- the complete Script Properties for both projects, with secret values redacted
  but environment, spreadsheet, script, deployment, Production-fence, and Gmail
  identifiers visible;
- the installed trigger inventories and trigger identities in both projects;
- the executing Gmail identities/mailboxes and Stage-only query, label, and subject
  observations;
- the Stage and Production web-app target URLs and visible environment indicators;
- the CI credential/secret bindings proving Stage and Production deploy with
  separate credentials or explicitly approved isolated targets.

Until those observations are captured, cloud isolation is a human-decision/
blocked prerequisite and this repository makes no claim that the live cloud
resources are distinct.

For CI, dispatch `.github/workflows/deploy-dashboard.yml` with
`environment=stage`; configure `STAGE_CLASPRC_JSON`, `STAGE_SCRIPT_ID`, and
`STAGE_DEPLOYMENT_ID` separately from the Production secrets. Stage deployment
is rejected when its script or deployment ID equals the pinned Production target,
and the selected deployment must be present in the selected clasp project's
deployment inventory. Set `DEPLOYMENT_SCRIPT_ID` to the current project's script
ID in every Stage property set.
Production continues to deploy from pushes to `main` using its existing pinned
deployment. Before promotion, compare non-secret project/deployment IDs and
Production sentinel rows before and after Stage testing.
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
