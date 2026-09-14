# cards_transaction_bot

A personal credit-card transaction tracker: a Gmail auto-record + auto-classify
bot and a dark-theme web dashboard, both Google Apps Script bound to one Google
Sheet (the single source of truth) and deployed via `clasp` as a Web App.

## Ticketing — GitHub Issues (Linear is retired)

Tickets are **GitHub Issues** on `charlie60507/transaction_bot`; use `gh issue`.
See the GitHub section below for the personal/company auth split that makes `gh`
work here.

**Linear was retired on 2026-09-14.** The personal Linear workspace (team **CT**,
CT-1…CT-26) is history only — never open new tickets there. `scripts/linear.js`
and the gitignored `.linear-key` stay in the repo so those old tickets can still
be read (`node scripts/linear.js --get "CT-<n>"`). The company Linear MCP
(`mcp__claude_ai_Linear__*`) is a different workspace, is **blocked at the harness
level** (`.claude/settings.local.json` → `permissions.deny`), and must never be
used in this repo.

Longer-form records that outlive one ticket live in `docs/` as plain Markdown
(e.g. `docs/engineer-note-issue-<n>.md`, `docs/plan-*.md`).

**Stale config:** `.gogox-claude.yaml` still declares `ticket_system: linear`, so
a GGC pipeline (`/route`, `/ggx-work`, `/dev:ff`) run here would still route to
Linear. Fix that before running one.

## GitHub — PERSONAL account only

This repo is `charlie60507/transaction_bot`, on the user's **personal** GitHub. But
`gh` on this machine is authenticated as the **company** account
(`charlie-yang-gogox`, via a `GITHUB_TOKEN` env var), which gets **403** on this
repo's secrets and settings. Same split as the Linear one above.

The fix is already in place: `.claude/settings.local.json` sets `env.GH_TOKEN` to a
personal PAT, and `GH_TOKEN` outranks `GITHUB_TOKEN` in `gh`'s resolution order — so
plain `gh` commands in this project run as `charlie60507` with no `gh auth` switching
and no effect on other repos. Confirm with `gh api user --jq .login` when in doubt.

- **A 401 on every `gh` call here means the PAT expired**, not a company/personal mixup
  — precedence is absolute, there is no fallback. Replace the value in
  `.claude/settings.local.json`.
- That file holds credentials and is gitignored **twice** (repo `.gitignore` and the
  user's global ignore). Never commit it, never print `env.GH_TOKEN`.

## Running GGC pipelines here (`/ggx-work`, `/route`, `/dev:ff`)

- This repo carries `.gogox-claude.yaml` (`ticket_system: linear`) so `/route`
  and `/ggx-work` resolve without the company `org.yaml`.
- **All Linear I/O goes through `scripts/linear.js`** — never the Linear MCP
  (it is denied). If a stage needs a Linear op `linear.js` lacks (assignee,
  estimate, marker comment, label add/remove), STOP and extend `linear.js`;
  do not fall back to the MCP.
- **Prefer inline execution.** The company MCP is denied, so any sub-agent that
  tries to reach company Linear fails closed. Run pipeline work in the main
  session rather than spawning sub-agents where practical.

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
