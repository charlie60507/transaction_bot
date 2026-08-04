# cards_transaction_bot

A personal credit-card transaction tracker: a Gmail auto-record + auto-classify
bot and a dark-theme web dashboard, both Google Apps Script bound to one Google
Sheet (the single source of truth) and deployed via `clasp` as a Web App.

## Ticketing — PERSONAL Linear only

Tickets (team **CT**) live in the user's **personal** Linear workspace, reachable
ONLY via `node scripts/linear.js` (personal API key in the gitignored
`.linear-key`). The company Linear MCP (`mcp__claude_ai_Linear__*`) is a DIFFERENT
workspace, cannot see these tickets, and is **blocked at the harness level** here
(`.claude/settings.local.json` → `permissions.deny`). Never use it in this repo.

    read one:   node scripts/linear.js --get "CT-<n>"
    list:       node scripts/linear.js --list
    set status: node scripts/linear.js --set "CT-<n>=<State>"   (states: Backlog / Todo / In Progress / In Review / Done)
    create:     node scripts/linear.js --title "..." [--desc-file f.md] [--priority 0..4] [--labels "Bug"]

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
