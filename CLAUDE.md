# cards_transaction_bot

A personal credit-card transaction tracker: a Gmail auto-record + auto-classify
bot and a dark-theme web dashboard, both Google Apps Script bound to one Google
Sheet (the single source of truth) and deployed via `clasp` as a Web App.

## Ticketing — GitHub Issues

Tickets are **GitHub Issues** on `charlie60507/transaction_bot`; use `gh issue`.
See the GitHub section below for the personal/company auth split that makes `gh`
work here.

Longer-form records that outlive one ticket live in `docs/` as plain Markdown
(e.g. `docs/engineer-note-issue-<n>.md`, `docs/plan-*.md`).

## GitHub — PERSONAL account only

This repo is `charlie60507/transaction_bot`, on the user's **personal** GitHub. But
`gh` on this machine is authenticated as the **company** account
(`charlie-yang-gogox`, via a `GITHUB_TOKEN` env var), which gets **403** on this
repo's secrets and settings.

The fix is already in place: `.claude/settings.local.json` sets `env.GH_TOKEN` to a
personal PAT, and `GH_TOKEN` outranks `GITHUB_TOKEN` in `gh`'s resolution order — so
plain `gh` commands in this project run as `charlie60507` with no `gh auth` switching
and no effect on other repos. Confirm with `gh api user --jq .login` when in doubt.

- **A 401 on every `gh` call here means the PAT expired**, not a company/personal mixup
  — precedence is absolute, there is no fallback. Replace the value in
  `.claude/settings.local.json`.
- That file holds credentials and is gitignored **twice** (repo `.gitignore` and the
  user's global ignore). Never commit it, never print `env.GH_TOKEN`.

## GitHub Issue Harness

Use the repository's GitHub Issue Harness for issue-to-PR work. Its configuration
lives in `.harness/github-harness.yaml`; do not add a second ticket-routing profile.

## UI changes — preview first

Any change to what the dashboard looks like or how it is operated (layout, navigation, controls,
interaction patterns, copy on screen) gets an **interactive artifact preview before any code,
issue or PR**. The owner approves the preview; only then is the issue written or the code changed.
A pure logic or data change with no visible effect is exempt.

- **The preview is a working mock, not a picture.** Use the dashboard's real tokens (`:root` in
  `sidebar/ToolPanel.html`), real data from the sheet where it matters, and make the key
  interactions actually work (tabs switch, drag reorders). Show both phone and desktop widths:
  the dashboard is used on a phone.
- **Design to current UX conventions, not to "the feature works".** Before drawing, ask how a
  well-made mobile app handles the same job, and prefer that: segmented tabs over stacked
  sections, drag handles over arrow buttons, bottom sheets on phone, inline add rows, quiet
  inline save state over a toast per action. A control that is merely functional is a draft.
- **The approved preview is the spec.** Link it from the issue, and write any interaction detail
  it settles (gestures, default tab, save timing, error recovery) into the issue body so the
  implementer does not have to reverse-engineer the mock.

Why: the category-order feature (#65) shipped exactly as specified, as ↑/↓ buttons in one
stacked Settings modal. It worked and still had to be redesigned (tabs, drag-to-reorder),
because nobody had looked at the interaction before it was built.

## Deploy

The dashboard deploys itself: pushing to `main` with changes under `sidebar/**`
triggers `.github/workflows/deploy-dashboard.yml`, which runs the offline gate
and then `clasp push -f` + `clasp deploy -i <pinned deployment id>`. Shipping is
therefore ONE `git push` — do not also deploy by hand, or the deployment gets a
duplicate version for the same commit.

**This repo holds two Apps Script projects, one per folder.**
- `sidebar/` is the dashboard, the hourly Gmail import and the `Ledger` library
  (`sidebar/line_ledger.js`). It deploys on `sidebar/**` through
  `deploy-dashboard.yml`.
- `linebot/` is the LINE webhook for Charlie-Bot-Channel. Its deploy target is
  the existing `Linebot-response` Apps Script project (its scriptId is in
  `linebot/.clasp.json`; the webhook's pinned deployment id is the
  `DEPLOYMENT_ID` in `.github/workflows/deploy-linebot.yml`). It deploys on
  `linebot/**` through that workflow, which `clasp push`es over the project and
  redeploys the same deployment id, so the webhook URL never changes. The
  deploy job skips itself if either id is ever a `REPLACE_WITH_*` placeholder.

Each folder has its own `.clasp.json`, and **`clasp` runs from the folder of the
project being changed** — never from the root, which has no clasp config. The two
path filters are disjoint, so deploying one project never redeploys the other.
The root used to carry its own `.clasp.json` (the retired standalone project)
plus a frozen copy of `cards_transaction_bot.js` kept as a rollback snapshot —
and one `clasp push` from the root would have shipped that snapshot to the old
project. The snapshot had also decayed past being one: it predated
`parseFubonTransfer_` entirely, so restoring it would have silently undone two
富邦-transfer fixes. **Rollback for the bot is git history** — `git revert` the
bad commit and let the normal push-to-deploy path run — never a second copy of
the file in the tree.

**A `sidebar/` push changes LINE behaviour with no linebot redeploy.** `linebot/`
includes `sidebar/` as the `Ledger` library with `developmentMode: true`, so the
webhook always runs the `sidebar/` code most recently pushed: the write, undo,
account-list, category and Gemini-parse logic, the dashboard's script lock and
its `GEMINI_API_KEY` all live there. This coupling is intended (one `addTxn`,
one lock). Treat a change to `sidebar/line_ledger.js`, `addTxn(fields, held)`,
`deleteTxn(messageId, held)` (both in `sidebar/程式碼.js`) or
`classifyWithGemini_` as a change to the LINE bot too, and keep every
`Ledger.<fn>()` target public (no trailing `_`). The `Ledger.<fn>()` resolution
check runs in `node check_sidebar.js linebot` and in no-argument mode, and the
`sidebar/` deploy gate runs both `node check_sidebar.js sidebar` and
`node check_sidebar.js linebot`, so a sidebar-only deploy that would break the
LINE bot (an unresolved `Ledger.<fn>()` target or a failing `linebot_*`
fixture) is blocked. Still run `node check_sidebar.js` with no argument before
pushing, to catch it before CI does.

**The linebot's secrets live in its own Script Properties**, never in the repo:
`CHANNEL_ACCESS_TOKEN`, `OWNER_USER_ID` and `WEBHOOK_SECRET` (the `?k=` value on
the webhook URL), already set on the `Linebot-response` project. Its runtime state (`evt:*`, `pend:*`, `done:*`) lives there too.
Never print any of them in a log or a workflow.

**Rollback for the LINE bot's cut-over is the backup, not the webhook URL.**
`linebot/` deploys over the `Linebot-response` project's own code, and the code it
replaced was backed up outside the repo to
`~/Documents/transaction-bot-backups/linebot-response-2026-10-05/`. To restore it,
`clasp push -f` from that backup folder, then
`clasp deploy -i <DEPLOYMENT_ID> -d "..."` to the same deployment id the
workflow pins; the webhook URL stays as is. Code rollback within `linebot/` is
still git history, as above.

**The `Deleted` sheet is load-bearing, not an archive.** Dashboard delete
copies the whole `Transactions` row there and then removes it; the bot
concatenates `Deleted` into its dedup index so a deleted auto-row does not
come back on the next 7-day scan. Deleting the tab (or renaming it) treats
it as empty — the run still completes, and anything still inside that window
resurrects. Recovery is moving the row back onto `Transactions`. Do not drop
the sheet to "clean up".

**The gate is `node check_sidebar.js`.** Apps Script has no build step, so a
typo'd `google.script.run` target or a stale `CFG.IDX_*` constant would surface
only in the live dashboard. The script checks that every `.js`/`.json`/inline
`<script>` parses, that every `google.script.run.<fn>()` resolves to a real
server function, and that every `CFG.<KEY>` reference exists. Run it locally
before committing (`node check_sidebar.js` checks both folders and runs their
`test/` fixtures; `node check_sidebar.js sidebar` or `linebot` checks one, which is
what each workflow runs; `CHECK_VERBOSE=1` lists every check); a non-zero exit
blocks the deploy in CI.

Still true, and load-bearing:

- **The deployment id is pinned in the workflow.** The project has several
  deployments; an unpinned `clasp deploy` creates a NEW one and the URL actually
  in use never changes. The live id is also recorded in project memory.
- **The Apps Script credential lives in the `CLASPRC_JSON` repo secret**
  (contents of `~/.clasprc.json`, clasp 3.x `tokens.default` shape). It is a
  Google OAuth refresh token and this repo is PUBLIC — never echo, `cat`, or
  otherwise print that file in a workflow. When the refresh token is revoked the
  deploy step starts failing: re-run `clasp login`, then re-upload the secret.
- **Manual deploy is the fallback** (CI down, or deploying without a commit):

      cd sidebar && clasp push -f && clasp deploy -i <live-deployment-id> -d "..."
      cd linebot && clasp push -f && clasp deploy -i <linebot-deployment-id> -d "..."

- Changing the deploy trigger, the gate, or the pinned deployment id is a
  policy change — ask first.

## The Sheet — layout and direct data access

The spreadsheet (`CFG.SPREADSHEET_ID`) has exactly three tabs: `Transactions`
(gid `1842423494`), `Deleted` (`110900880`) and `META` (`2135287369`). The legacy
hidden formula dashboards (`_calc`, `_dash`, `Dashboard`, `儀表板`) were deleted on
2026-10-01 together with the TAG column.

**`Transactions` columns** (the header row is the contract):

    A 已記帳 | B 銀行 | C 授權日期時間 | D 卡末四碼 | E 金額_NTD | F 交易內容/商店 |
    G 類別 | H Gmail連結 | I MessageId | J 收支 | K 種類(手動) | L 我的消費 | M 交易 ID

A–K are fixed indices (`CFG.IDX_*`). `我的消費` and `交易 ID` are located by
header name only, so inserting or deleting a column right of K is safe for code.
Nothing left of L may move. `Deleted` mirrors the same columns, so change both
tabs together. The bot writes A–I (its `HEADER` Script Property) plus `交易 ID`.

**`META` columns:** A 交易關鍵字 and B 種類 hold the keyword rules. C 收支. D 種類清單 is the
category list; the picker, the rule dropdown and the Gemini fallback all read it.
**E is empty but must stay.** It was the retired TAG清單, and deleting the column
would shift G. F is a spacer. G 帳戶清單 is fixed at column G (`CFG.META_ACCOUNT_COL`).

Category boundaries (the owner's rules, used for manual and rule classification):
- `汽車` / `重機`: fixed costs of owning a vehicle (insurance, plates, loan, accessories, registration).
- `交通`: per-use costs (charging, fuel, parking, rides).
- `房屋`: one-off home purchases (renovation, design, furniture, appliances, mortgage and home insurance).
- `家居`: recurring household running costs (utilities, internet, phone, laundry, daily goods).

**Reading.** The sheet is link-viewable, so a whole tab exports without auth:
`https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=<gid>`. Never
use the `gviz/tq?tqx=out:csv` endpoint. It silently truncates long tabs (it
returned 135 of 1,280 rows).

**Writing** goes through the Sheets API as the service account
`sheet-writer@cards-dashboard.iam.gserviceaccount.com`. That account is an Editor
on this spreadsheet only, and it lives in the owner's personal GCP project
`cards-dashboard`, which has the Sheets API enabled. Get a token by impersonating it:

    gcloud auth print-access-token --account=charlie60507@gmail.com \
      --impersonate-service-account=sheet-writer@cards-dashboard.iam.gserviceaccount.com \
      --scopes=https://www.googleapis.com/auth/spreadsheets

- Always pass `--account`. The machine's active gcloud account is the company one.
- Two other credential routes do not work:
  - gcloud's default ADC login is blocked by Google from requesting the `spreadsheets` scope.
  - The clasp token has no Sheets scope.
- Revoke access by removing the service account from the sheet's share list.

Data-change discipline:
- Locate rows by `交易 ID`, never by row number, because the bot re-sorts the sheet.
- Before writing, check every target cell's current value and abort the whole batch on any mismatch.
- Back up the affected tabs outside the repo first; the repo is public. Backups live in
  `~/Documents/transaction-bot-backups/`.
- Afterwards, re-export and diff cell by cell against the pre-change export.
