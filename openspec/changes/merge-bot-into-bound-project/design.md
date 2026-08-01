## Context

Two Apps Script projects, one spreadsheet:
- **Standalone bot** — `cards_transaction_bot.js` (root, scriptId `18WyCJz…`, root `.clasp.json`, rootDir `""`). Opens the sheet via `SpreadsheetApp.openById(SPREADSHEET_ID)` (property). Entry `appendLast7DaysToSheet()`: Gmail search (富邦 subject / 國泰 label+subject) → parse → dedup (strict + loose + MessageId) → append A–I → default J=支出 → autoCategorize K (rules + Gemini `gemini-2.5-flash`). Runs on a time trigger (set in that project's UI).
- **Bound dashboard** — `sidebar/程式碼.js` + `ToolPanel.html` (scriptId `1P4l2DY…`, `sidebar/.clasp.json`, rootDir `.`). `getActiveSpreadsheet()`, custom menu, drilldown sidebar, TAG summary, web-app `doGet`.

Evidence gathered: the two files share exactly **one** top-level global name — `CFG` (bot: Gmail config; dashboard: column-index config). Everything else is disjoint. Apps Script runs all files in a project in one shared global scope, so that single collision is the only code-level merge blocker.

## Goals / Non-Goals

**Goals:**
- One Apps Script project (the bound one) hosting bot + dashboard + sidebar.
- One `.clasp.json`. Remove the two-config mis-push foot-gun.
- Auto-recorded 國泰 transfers carry 收支別 (J) = 轉帳.
- No loss of the bot's dedup/classification behavior; no dashboard behavior change.

**Non-Goals:**
- Rewriting the bot's parsing/classification logic.
- Changing the Gemini model or the category-rules mechanism.
- Any dashboard feature change.

## Decisions

**D1 — Merge target is the BOUND project; direction is not reversible.** A bound script is a superset: it can do Gmail/UrlFetch/triggers AND `getUi()`/`showSidebar()`/menus. A standalone script cannot host the sidebar/menu (the bot file states this at line ~600). So the bot moves into the bound project, never the reverse.

**D2 — Resolve the sole collision by renaming the bot's `CFG`.** Rename bot `CFG` → `GMAIL_CFG` (and its references). The dashboard's `CFG` (column indices) is referenced far more widely, so renaming the bot side is the smaller, safer edit.

**D3 — Two-copy transition, single-copy end state.** During migration keep the original root `cards_transaction_bot.js` (standalone) FROZEN and untouched, and add the adapted copy under `sidebar/`. This keeps auto-record working the whole time. Only at final cutover do we delete the root copy + retire the standalone project. Rationale: never leave a window where nothing records; avoid editing a live file mid-flight.

**D4 — Defer the `openById → getActiveSpreadsheet` swap behind a same-spreadsheet check.** Keep `openById(SPREADSHEET_ID)` in the moved copy first (behavior-identical once the property is set in the bound project). Swap to `getActiveSpreadsheet()` only after confirming the bound project's container spreadsheet IS the bot's `SPREADSHEET_ID`. If the swap is wrong, the bot would silently write to the wrong sheet — so gate it. `getActiveSpreadsheet()` is valid in a bound script's trigger and web-app contexts.

**D5 — Operator owns all cloud state.** Script Properties, OAuth re-consent, and trigger creation/deletion live in the Apps Script UI / server, not the repo. The migration explicitly splits tasks into **[me] code+clasp** and **[you] cloud**, and every cloud step has an exact click-path.

**D6 — Cutover is trigger-swap, not code-swap.** The bound copy becomes authoritative the moment its time trigger is created AND the standalone trigger is disabled — in that order-sensitive pair. Dedup (strict+loose+MessageId) bounds any brief overlap, but the standalone trigger MUST be disabled to avoid steady-state double runs.

## Risks / Trade-offs

- [Swapping to getActiveSpreadsheet against the wrong sheet → silent mis-write] → keep openById until same-sheet is confirmed (D4).
- [Both triggers active → double processing] → dedup absorbs it; still disable the standalone trigger immediately at cutover (D6).
- [Bound project missing GEMINI_API_KEY after move → AI classification silently skipped] → the code already no-ops without the key and logs it; copy the property before relying on AI; verify via a manual run's log.
- [Re-auth scopes not granted → GmailApp/UrlFetch throw on first bound run] → first step for the operator is a manual `appendLast7DaysToSheet()` run to trigger the consent prompt.
- [Two copies of the 1000-line file diverge during transition] → the root copy is frozen (no edits) and deleted at cutover; only the sidebar copy is edited.

## Migration Plan (ordered, verifiable)

1. **[me]** Copy `cards_transaction_bot.js` → `sidebar/` (adapted: `CFG`→`GMAIL_CFG`; transfer path writes J=轉帳; keep `openById` for now). Do NOT push yet.
2. **[you]** In the BOUND project's Apps Script → Project Settings → Script Properties, add the bot's properties (`SPREADSHEET_ID`, `GEMINI_API_KEY`, Gmail queries, `HEADER`, `TZ`, `SORT_ORDER`). (Copy from the standalone project's properties.)
3. **[me]** `clasp push` the bound project (bot code now present, inert without a trigger).
4. **[you]** Run `appendLast7DaysToSheet()` once manually in the bound project → grant the Gmail + UrlFetch consent → check the execution log records/classifies and that a transfer row shows J=轉帳. (Dedup makes re-runs safe.)
5. **[you]** Create a time-driven trigger on `appendLast7DaysToSheet` in the bound project; then DISABLE the standalone project's trigger.
6. **[me, gated]** After you confirm the bound container == `SPREADSHEET_ID`, swap `openById` → `getActiveSpreadsheet()`, drop the `SPREADSHEET_ID` dependency; push.
7. **[me]** Delete the root `cards_transaction_bot.js` + root `.clasp.json`; single project remains. **[you]** optionally delete the retired standalone Apps Script project.

**Rollback at any point:** the standalone project + its trigger are untouched until step 5; re-enabling its trigger (and not creating the bound one) restores the original state. Code rollback is `git revert`.

## Open Questions

- Confirm the bound project's container spreadsheet is the same as the bot's `SPREADSHEET_ID` (gates step 6). Until confirmed, step 6 stays deferred and `openById` remains.
