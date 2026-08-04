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

Deploy is via `clasp` to a specific Web App deployment — NOT merge-to-deploy.
Never auto-deploy. When code is ready, show the diff + the offline verify
(`node check_*.js` against `sidebar/ToolPanel.html`) and wait for approval, then:

    cd sidebar && clasp push -f && clasp deploy -i <live-deployment-id> -d "..."

The live deployment id (the URL the user actually opens) is recorded in the
project memory; deploy there, not a stale deployment.
