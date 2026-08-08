## Why

A day is not a useful unit for identifying a transaction. Measured on the live sheet (1,034 rows): 94% of transactions land on a day that holds more than one, and there are 75 same-day/same-merchant collisions. When the 待記帳 queue shows nothing but `2026/08/05`, there is no way to tell which 全聯 charge is which, or which of three 餐飲 rows was the dinner someone else was fronted for — which is exactly the question the queue exists to answer, row by row.

The authorisation time is already in the sheet, in column C (`授權日期時間`, written by the bot from 授權時間). The dashboard drops it: `getAllTxns` sends `y`, `m`, `d` and nothing else. Two places even manufacture a *fake* time — manual add hardcodes `12:00:00`, and the bot falls back to `00:00:00` when it cannot parse 授權時間.

## What Changes

- **`getAllTxns` gains one field per transaction: `hm`** — `'HH:mm'` formatted in `CFG.TZ`, or `''` when the cell carries no time. A string, not a timestamp: it formats directly, and lexicographic order **is** chronological order with `''` sorting first for free.
- **`00:00:00` counts as "no time".** Apps Script reads a date-only cell and a midnight datetime as the same `Date`, so they cannot be told apart by value. Consulting the cell's number format was rejected — see design D2.
- **The editable row (`editRow`) renders the time** after the bank badge, dim and small: `富邦 •9837 · 21:25`. Nothing is rendered when `hm` is `''`. This component is shared by the 待記帳 queue and the heatmap day list, so **both surfaces get it — intended**.
- **The read-only row (`txnRow`, category drilldown + search) is unchanged.** Those surfaces answer "how much", not "which one".
- **A day is ordered by `hm` ascending, then by amount descending** — in both the 待記帳 queue and the heatmap day list, which are two call sites of one rule. **The amount tiebreak is load-bearing**: 844 of 1,034 rows have no time and therefore an equal sort key, so without it 82% of the history would fall back to sheet order and silently lose the ordering it has today.
- **Manual add gains an optional `<input type="time">`.** A time given → stored as date + time; left empty → a **date-only** value with the cell number format set to `yyyy/mm/dd`, matching the legacy rows. This replaces the hardcoded `12:00:00`, which is not merely cosmetic: it wedges every manual entry into the middle of the day's chronological order.

**Out of scope, deliberately:**
- `mapTxn_`, `getOverview`, `getTransactions` also format a date as `MM/dd HH:mm`. They have **no callers** (verified: zero `google.script.run` references in `ToolPanel.html`) — dead code from the pre-v5 dashboard, removed on a separate branch. Do not touch them here; editing them would only create a conflict.
- The bot's `00:00:00` fallback stays. Changing it would not make midnight distinguishable to the dashboard anyway (D2).

## Capabilities

### New Capabilities
- `transaction-time-of-day`: carry the authorisation time of day from the sheet to the dashboard, show it on the editable row, order a day chronologically without disturbing the days that have no times, and let a manual entry record a time or honestly record none.

### Modified Capabilities
<!-- None. No existing spec states how a day's rows are ordered or what an editable row displays beyond its controls, so this change adds requirements rather than revising any. -->

## Impact

- **sidebar/程式碼.js**: `getAllTxns()` emits `hm`; a shared `rowHM_(dt)` helper decides "no time" by value in `CFG.TZ`; `addTxn(fields)` accepts an optional `fields.time`, stops hardcoding `12:00:00`, sets the date cell's number format to `yyyy/mm/dd` (no time) or `yyyy/mm/dd hh:mm:ss` (time given), and returns `hm` in its optimistic object.
- **sidebar/ToolPanel.html**: `editRow` renders the time; one `byTimeThenAmount` comparator replaces the two `b.amount-a.amount` day sorts (`dayEditor`, `inboxTab`); the add dialog gains a time field; `submitAdd` passes it and puts `hm` on the optimistic row; `boot` defaults `hm` to `''`; one new CSS class for the dim time.
- **No sheet change, no bot change, no new column, no external service.** Nothing is written to the sheet that is not written today, apart from the manual-add date cell being honest about whether it has a time.
- Ships by pushing to `main`; the workflow runs `node check_sidebar.js` and deploys to the pinned deployment. Rollback is `git revert` — no data migration, since no stored data changes shape.
