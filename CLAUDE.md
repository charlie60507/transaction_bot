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

## Deploy

The dashboard deploys itself: pushing to `main` with changes under `sidebar/**`
triggers `.github/workflows/deploy-dashboard.yml`, which runs the offline gate
and then `clasp push -f` + `clasp deploy -i <pinned deployment id>`. Shipping is
therefore ONE `git push` — do not also deploy by hand, or the deployment gets a
duplicate version for the same commit.

**This repo holds exactly one Apps Script project, in `sidebar/`.**
`sidebar/.clasp.json` is the only clasp config in the tree, so `clasp` is only
ever run from `sidebar/` and there is nowhere else to push. The root used to
carry its own `.clasp.json` (the retired standalone project) plus a frozen copy
of `cards_transaction_bot.js` kept as a rollback snapshot — and one `clasp push`
from the root would have shipped that snapshot to the old project. The snapshot
had also decayed past being one: it predated `parseFubonTransfer_` entirely, so
restoring it would have silently undone two 富邦-transfer fixes. **Rollback for
the bot is git history** — `git revert` the bad commit and let the normal
push-to-deploy path run — never a second copy of the file in the tree.

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
before committing (`node check_sidebar.js`, or `CHECK_VERBOSE=1` to list every
check); a non-zero exit blocks the deploy in CI.

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
