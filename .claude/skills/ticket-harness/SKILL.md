---
name: ticket-harness
description: >-
  Runs the five-step Linear ticket loop for this personal dashboard repo:
  OpenSpec from the ticket, implement, mock-data Node fixture test, open PR,
  auto-merge, then mark Linear Done. Use when shipping CT-* tickets, running
  the ticket harness, or the user names this skill.
---

# Ticket harness (CT)

Personal repo only. Tickets live in the **personal** Linear workspace (team CT).
**Never** use the company Linear MCP. **Never** print `.linear-key` or `env.GH_TOKEN`.
**Never** `clasp` deploy by hand — merge to `main` with `sidebar/**` deploys via
`.github/workflows/deploy-dashboard.yml`.

## Linear / GitHub

```
node scripts/linear.js --get "CT-<n>"
node scripts/linear.js --set "CT-<n>=In Progress"   # Backlog / Todo / In Progress / In Review / Done
node scripts/linear.js --comment CT-n --body "..."
```

Repo: `charlie60507/transaction_bot`. Use `gh` as-is (`GH_TOKEN` already set).

## Per-ticket loop (exactly these five)

Work on a **clean branch from up-to-date `main`**. One new branch per ticket.
Do not commit unrelated dirty files (`.cursor/settings.json`, leftover edits).
If several tickets edit the same file (e.g. `sidebar/ToolPanel.html`), **wait
until the previous PR is merged** before starting the next.

Set Linear to `In Progress` when you start.

### 1. OpenSpec from the ticket

```
node scripts/linear.js --get "CT-n"
```

Derive a kebab-case change name from the ticket. Follow
`.claude/skills/openspec-new-change/SKILL.md`, then create **all** artifacts
needed to apply (proposal → design → specs → tasks) using
`openspec status` / `openspec instructions` — do not stop after the first
template. Ground every artifact in the ticket Problem / Change / Acceptance.
Do not invent extra scope.

### 2. Develop

Follow `.claude/skills/openspec-apply-change/SKILL.md`. Implement only what
the spec/AC says. Code comments in English. When committing, follow
`.claude/skills/commit/SKILL.md`. Run `node check_sidebar.js` before the PR
(must exit 0).

### 3. Mock-data verification (load-bearing)

`node check_sidebar.js` is the deploy gate (syntax + `google.script.run` +
CFG keys) but it does **not** prove behavior. Apps Script `google.script.run`
cannot run locally. Do **not** claim "looks good in HTML".

Add or extend a Node fixture that:

- Loads / extracts the relevant dashboard logic (or a small testable slice)
- Feeds mock `TXNS` covering the ticket's AC
- Asserts the behavior (a file that fails on a regression)

Prefer `test/dashboard_*.js` runnable with `node …`. Wire it so
`node check_sidebar.js` still remains the CI gate (have the gate invoke the
fixtures) **or** run both in this harness. Do not break
`.github/workflows/deploy-dashboard.yml` unless necessary.

### 4. Open PR

Commit, `git push -u`, `gh pr create` with Summary + Test plan (ticket AC as
a checklist). HEREDOC body. Never update git config. Never `--force` to
main. Never skip hooks. Commit messages and PR bodies in English.

### 5. Auto-merge

```
gh pr merge --auto --squash
```

(or `--squash` if already mergeable and `--auto` is unavailable). Prefer
`--auto` so GitHub waits for deploy-dashboard / gate checks. Wait until
**merged** before starting the next ticket.

Then:

```
node scripts/linear.js --set "CT-n=Done"
node scripts/linear.js --comment CT-n --body "Merged: <PR URL>"
```

## Constraints

- Small diffs. No drive-by refactors.
- If OpenSpec CLI is missing or a step blocks, fix or install — do not skip.
- Rollback is git history, never a second Apps Script project.
