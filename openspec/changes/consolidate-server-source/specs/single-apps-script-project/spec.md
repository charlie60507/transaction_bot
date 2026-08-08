## ADDED Requirements

### Requirement: The repo hosts exactly one Apps Script project

The repository SHALL contain exactly one `clasp` project, rooted at `sidebar/`, targeting the
bound script that hosts both the dashboard and the auto-record bot. There MUST NOT be a second
`.clasp.json` (or a `.claspignore` that excludes `sidebar/**`) anywhere else in the tree, because
that gives `clasp push` a second destination selected purely by which directory the command was
run from. This is recorded in `CLAUDE.md` so it is discoverable without reading the tree.

#### Scenario: clasp has one target

- **WHEN** `clasp push` is run from the repository root
- **THEN** there is no project configuration to push, so nothing is sent to any Apps Script project
- **AND** in particular the retired standalone project cannot be written to from this repo

#### Scenario: The bound project still pushes normally

- **WHEN** `clasp push -f` and `clasp deploy -i <pinned deployment id>` are run from `sidebar/`
- **THEN** the bound project is updated exactly as before

#### Scenario: The deploy workflow is unaffected

- **WHEN** a commit that changes only repo-root files lands on `main`
- **THEN** the dashboard deploy workflow does not run, because its path filter covers only
  `sidebar/**`, `check_sidebar.js` and the workflow file

### Requirement: One copy of the bot; rollback is git history

The auto-record bot SHALL exist as exactly one file, `sidebar/cards_transaction_bot.js`. A frozen
second copy MUST NOT be kept in the tree as a rollback target. Rollback for the bot SHALL be
performed from git history — reverting the offending commit and deploying through the normal
path — not by restoring an in-tree snapshot.

#### Scenario: Recovering from a bot regression

- **WHEN** a bot change turns out to be wrong
- **THEN** the fix is a `git revert` of that commit, deployed through the usual push-to-`main` path
- **AND** no separate snapshot file has to be located, compared, or trusted

#### Scenario: No snapshot can silently undo later fixes

- **WHEN** the repository is inspected for copies of the bot
- **THEN** only `sidebar/cards_transaction_bot.js` is found
- **AND** there is no older file that, if restored, would reintroduce already-fixed defects
