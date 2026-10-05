# cards_transaction_bot

A personal credit-card transaction tracker: a Gmail auto-record + auto-classify
bot and a dark-theme web dashboard, both Google Apps Script bound to one Google
Sheet (the single source of truth) and deployed via `clasp` as a Web App.

## Ticketing — GitHub Issues

Tickets are **GitHub Issues** on `charlie60507/transaction_bot`; use `gh issue`.
Longer-form records that outlive one ticket live in `docs/` as plain Markdown
(for example, `docs/engineer-note-issue-<n>.md` and `docs/plan-*.md`).

## GitHub — PERSONAL account only

This repo is `charlie60507/transaction_bot`, on the user's **personal** GitHub. But
`gh` on this machine is authenticated as the **company** account
(`charlie-yang-gogox`, via a `GITHUB_TOKEN` env var), which gets **403** on this
repo's secrets and settings.

The fix is already in place: the repo-local Codex configuration supplies a personal
PAT as `GH_TOKEN`, which outranks `GITHUB_TOKEN` in `gh`'s resolution order — so
plain `gh` commands in this project run as `charlie60507` with no `gh auth` switching
and no effect on other repos. Confirm with `gh api user --jq .login` when in doubt.

- **A 401 on every `gh` call here means the PAT expired**, not a company/personal mixup
  — precedence is absolute, there is no fallback. Replace the value in
  the repo-local Codex configuration.
- That file holds credentials and is gitignored **twice** (repo `.gitignore` and the
  user's global ignore). Never commit it, never print `env.GH_TOKEN`.

## GitHub Issue Harness — session decisions are writable

SIGNAL: The GitHub Issue Harness is waiting for a requirement, scope, or product
decision, and the user answers it in the active session or asks for an Issue change.

ACTION: Treat that answer as authorization to persist the decision directly to the
GitHub Issue with `gh` or the GitHub API, in clear English, then rerun harness
`inspect`. Do not require the user to repeat the same decision manually on GitHub.
The same applies to other Issue body or comment changes the user requests in the
session; use guarded harness commands for harness-owned state transitions when they
exist, but direct Issue content edits are allowed.

WHY: A user answered the harness's only open product question in chat, but the
runner refused to record it and asked the user to duplicate the answer on GitHub.
GitHub must remain the durable control plane, but persisting an already-authorized
session decision is the runner's job, not extra work for the user.

## Merged Issue scope changes require a new Issue

SIGNAL: An Issue's PR has already merged and a later discussion establishes a
different product rule, replacement approach, or follow-up behavior.

ACTION: Create a new GitHub Issue for the new scope and run it through a fresh,
complete GitHub Issue Harness lifecycle. Never reopen, rewrite, or continue the
merged Issue as though its approved revision covered the new behavior, and never
patch the merged PR branch. Preserve the old Issue and PR as the record of what
actually shipped.

WHY: A transfer-accounting fix had already merged when the intended product rule
was corrected: imported bank transfers must remain transfers, self-transfers are
deleted, and retained transfers count through their assigned category. Continuing
the old Issue would have hidden a replacement product decision inside an
already-completed development generation instead of giving it its own reviewable
investigation, implementation, and verification history.

## Bank transfers remain transfers

SIGNAL: Defining import or dashboard behavior for Cathay or Fubon bank-transfer
notifications, especially when a retained transfer must contribute to categorized
personal spending.

ACTION: Preserve `收支別 = 轉帳` for every imported bank-transfer notification.
The user deletes transfers between their own accounts. Every other retained
transfer stays a transfer, receives a manual category such as `個人`, and must be
included in the corresponding categorized consumption totals. Never change the
imported accounting type to `支出` merely to make dashboard expense aggregation
include the row; fix the aggregation semantics while preserving the payment type.

WHY: A requirement to count a categorized haircut transfer as personal
consumption was misread as an instruction to import all retained transfers as
expenses. The resulting Issue and implementation changed the transfer identity,
while the user's actual workflow was to keep transfers as transfers, delete only
self-transfers, and categorize the rest.

## Dashboard “show all” requests target aggregation before truncation

SIGNAL: The user asks for a dashboard category summary to “show everything,” and
the visible UI contains both truncated text and an aggregate row such as
`其他 N 項`.

ACTION: Treat the aggregate row as the primary target: inspect how the omitted
items are grouped, and write the requirement so that the row expands to reveal
the individual categories. Do not assume the request is about CSS ellipsis unless
the user identifies a specific clipped label or screenshot anchor.

WHY: A request to fully display **支出分類 · 類別** was recorded as a text-wrapping
fix because category labels use ellipsis. The actual problem was the `其他 5 項`
bucket: the user needed to expand it and inspect the five hidden categories.

## Persistent configuration belongs in a settings surface

SIGNAL: Adding or managing a value whose lifetime is independent of one transaction,
such as an account/source, category vocabulary, or another reusable preference.

ACTION: Put management in an independently reachable settings interface. Transaction
creation may consume the configured value through a picker, but MUST NOT hide the
create/manage action inside the new-transaction flow. Prefer a settings modal opened
from the dashboard header over adding a primary navigation tab for infrequent setup.

WHY: Account creation was placed beside the source picker inside the new-transaction
modal. Although convenient for implementation, it made durable account configuration
look like a sub-action of recording one transaction; the owner correctly identified it
as part of product settings instead.

## GitHub Issue Harness

Use the repository's GitHub Issue Harness for issue-to-PR work. Its configuration
lives in `.harness/github-harness.yaml`; do not add a second ticket-routing profile.

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
- `linebot/` is the LINE webhook for Charlie-Bot-Channel. It deploys on
  `linebot/**` through `.github/workflows/deploy-linebot.yml`, whose deploy job
  skips itself while `linebot/.clasp.json` or the workflow's `DEPLOYMENT_ID`
  still holds a `REPLACE_WITH_*` placeholder.

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
one lock). Treat a change to `sidebar/line_ledger.js`, `addTxnRow_`,
`deleteRowById_` or `classifyWithGemini_` as a change to the LINE bot too, and
keep every `Ledger.<fn>()` target public (no trailing `_`); the gate checks it.

**The linebot's secrets live in its own Script Properties**, never in the repo:
`CHANNEL_ACCESS_TOKEN`, `OWNER_USER_ID` and `WEBHOOK_SECRET` (the `?k=` value on
the webhook URL). Its runtime state (`evt:*`, `pend:*`, `done:*`) lives there too.
Never print any of them in a log or a workflow.

**Rollback for the LINE bot is the webhook URL.** The old `Linebot-response`
Apps Script project (outside this repo) is kept as is: pointing the
Charlie-Bot-Channel webhook back at its deployment in LINE Developers undoes the
cut-over. Code rollback for `linebot/` is still git history, as above.

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
