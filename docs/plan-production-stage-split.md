# Plan: production / stage split so a demo agent can drive the dashboard destructively

**Status: PLAN — shape agreed with the owner, not started. Open questions at the bottom.**

*Recorded 2026-09-14. This file is the record; discussion continues here or on a
GitHub Issue that links to it. (An earlier copy exists as Linear CT-26, from
before this repo moved to GitHub Issues — treat this file as authoritative.)*

## Goal

Let a demo/QA agent drive a real browser against the dashboard **freely and
destructively** (edit, delete, bulk-post, manual add) in a **Stage** environment,
while everything that runs normally — the time-driven import trigger and the
dashboard the owner actually uses — stays on **Production** and is never
reachable from that agent.

## Why this exists

2026-09-05: a half-built stage environment wrote its whole property set into the
**production** Apps Script project's Script Properties (`ENVIRONMENT=STAGE`,
`SPREADSHEET_ID` -> a stage sheet, all four Gmail queries -> `STAGE-…` labels).
Production then imported nothing for days, silently — `inserted=0` is a legal
value, so nothing complained. No data was lost (the bot wrote to the stage sheet
but had nothing to write; the dashboard was unaffected because it hardcodes the
production spreadsheet id).

The design defect, stated once: **environment selection lived in mutable state
that both environments shared, inside the thing being switched.** Any stray run
could flip it, and nothing would object.

## Options considered

### A. Two Apps Script projects, environment derived from `ScriptApp.getScriptId()` — CHOSEN

One source tree, two deploy targets. A table in the code maps script id ->
environment:

```js
const ENVIRONMENTS = {
  '<prod script id>':  { name: 'PRODUCTION', spreadsheetId: '<prod sheet>',  webAppUrl: '…', gmail: { /* prod queries */ } },
  '<stage script id>': { name: 'STAGE',      spreadsheetId: '<stage sheet>', webAppUrl: '…', gmail: { /* STAGE- labels */ } }
};
function env_() {
  const id = ScriptApp.getScriptId();
  const e = ENVIRONMENTS[id];
  if (!e) throw new Error('Unknown script project ' + id + ' — refusing to run');
  return e;
}
```

Why this one: the demo agent needs a **separate URL**; an Apps Script URL comes
from a **deployment**; a deployment belongs to a project. Two URLs therefore
require two projects. Environment is then derived from an immutable runtime fact
instead of a writable property, so the 2026-09-05 incident becomes structurally
impossible — there is no knob left to write.

### B. One project, config passed as a parameter — REJECTED

Keep one project; make `appendLast7DaysToSheet()` / `…Stage()` thin wrappers over
`importTransactions_(cfg)` with the stage config as a local constant, persisted
nowhere. Solves the pollution problem just as well and has zero drift risk.

Rejected because it cannot serve the goal: one project serves one Web App code
path, and the server cannot tell which deployment served a request (no documented
API for it — re-check before reversing this decision). The only way to signal the
environment through the browser is a query parameter threaded back through every
`google.script.run` call. `ToolPanel.html` has **7** such call sites, including the
mutating ones. One missed call site and the agent deletes production rows — the
exact failure this plan exists to prevent.

**B becomes the right answer if the browser-driving requirement is ever dropped.**

### C. No stage environment; offline fixture tests — REJECTED for this goal, still worth doing

Parsers, dedup and dashboard server logic are all testable in node against saved
email/sheet fixtures; the repo already has `test/` and `check_sidebar.js`. Lowest
cost, nothing live to corrupt. It gives a browser-driving agent nothing to drive,
so it does not replace A — but it should absorb everything that does not
genuinely need a live project.

## The drift objection, and the answer

The owner's objection to A: "won't I push to prod and forget stage?"

- There is **one** source tree. Both projects are pushed from the same `sidebar/`
  directory, same files. Two deploy targets, not two copies of the code — the code
  cannot diverge.
- **Production cannot be forgotten**: CI pushes it on every merge to `main`.
- **Stage can go stale** — but that only matters if stage is used without pushing.
  So the push is the first line of the demo command, not something to remember:

      clasp -P sidebar/.clasp.stage.json push -f

- Worst case if someone opens the stage URL by hand without that: they look at an
  old build for a few minutes. Production is untouched; no data is harmed.
- Optional later hardening, only if this actually bites: before a demo run, compare
  the stage project's `updateTime` (Apps Script API `projects.get`) with the last
  commit time and refuse to run when stale. Needs no code change.

## Work items

1. Create the Stage Apps Script project, **container-bound** to the existing stage
   spreadsheet `cards_transaction_bot — STAGE`
   (`clasp create --type sheets --parentId <stage sheet id>`), and deploy it as a
   Web App -> the URL the demo agent drives.
2. Add `sidebar/.clasp.stage.json`. CI keeps using `sidebar/.clasp.json` only and
   must never touch the stage target.
3. Add the `ENVIRONMENTS` table + `env_()`; an unknown script id throws.
4. Route every environment-dependent value through `env_()` (see Traps).
5. Seed the stage sheet with a snapshot of production rows. It is disposable — the
   agent is expected to wreck it; re-seeding is the recovery.
6. Log `env=… sheet=…` at the start of every run, and warn when an import ends with
   `inserted=0` **and** all queries returned 0 threads **and** bank mail does exist
   in the window. That three-way condition is what would have made the 2026-09-05
   failure visible on day one.

## Traps — these are the plan's make-or-break, not details

- **`程式碼.js:4` hardcodes the production spreadsheet id.** It must come from
  `env_()`, or the stage dashboard reads production data and the agent's first
  delete hits real rows.
- **`程式碼.js:441` hardcodes the production Web App URL** (the "open panel" menu
  item). It must come from `env_()`, or the stage panel bounces the agent back to
  production.
- **The time-driven trigger belongs only to the Production project.** Do not
  install one on Stage, or the stage bot runs on its own and burns Gmail quota.

## Constraints

- `appsscript.json` is pushed identically to both projects, so `webapp.access`
  cannot differ. Stage stays `MYSELF`, and the demo agent must carry the owner's
  Google session. Diverging the manifest to make stage anonymous would reintroduce
  exactly the drift this design avoids.
- Stage Gmail isolation depends on a dedicated `STAGE-…` label set holding copies of
  real notification mails: production queries key off subject/sender, stage queries
  key off those labels.

## Verified while writing this plan

- `ScriptApp.getScriptId()` requires **no** OAuth scope.
- clasp 3.x supports a global `-P, --project <file>` (also env
  `clasp_config_project`), so a second config file is all a second target needs.
- The stage script project named by the leftover `SCRIPT_ID` property (`1QI9sz…`)
  **does not exist** (Apps Script API 404). Only the stage *spreadsheet* was ever
  created, so work item 1 is a genuine create, not a re-use.
- `ToolPanel.html` has 7 `google.script.run` call sites.

## Open questions

1. How does the stage sheet get seeded and re-seeded — a one-off manual copy, or a
   `seedStage()` function in the repo? This decides how cheap "wreck it and reset"
   really is.
2. Does the demo agent need the **bot** on stage at all, or only the dashboard? If
   only the dashboard, the `STAGE-…` Gmail label set is unnecessary and the stage
   Gmail config can be dropped entirely.
3. Is option C (offline fixtures) worth doing first? It may absorb enough of the
   testing need that A's value drops.
4. Should `env_()` live in a third file shared by `cards_transaction_bot.js` and
   `程式碼.js`, or inside one of them?

## Non-goals

- Changing the deploy trigger, the offline gate, or the pinned production
  deployment id (a policy change — ask first).
- Making Stage publicly reachable.
- Rewriting the Gmail intake onto the Gmail advanced service.
