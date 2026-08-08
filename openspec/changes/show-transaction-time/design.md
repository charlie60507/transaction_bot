## Context

Column C of `Transactions` is `授權日期時間`. The bot writes it from the mail's 授權日期 + 授權時間 and falls back to `'00:00:00'` when 授權時間 cannot be parsed; it also sets the column's number format to `yyyy/mm/dd hh:mm:ss` on every block of rows it appends. Manual rows are written by `addTxn`, which builds `new Date(fields.date + 'T12:00:00')` — the add dialog has no time field at all.

The dashboard is a fat frontend: `getAllTxns()` is the only read path, and it currently projects column C down to `y` / `m` / `d`. The page never sees the instant, so it cannot show a time, and every per-day list falls back to sorting by amount.

Measured on the live sheet (1,034 rows): 190 rows (18%) carry a time of day, all dated 2026/06/13 or later, and from 2026-07 onward it is 100%; the other 844 are date-only. Precision differs by source — 國泰's mail gives `HH:mm` (87 of 97 rows have `:00` seconds), 富邦's gives seconds.

Two surfaces render a day's rows through the same `editRow` component: the 待記帳 cross-day queue (`inboxTab`) and the heatmap day list (`dayEditor`). Each sorts its own day with its own copy of `b.amount - a.amount`.

## Goals / Non-Goals

**Goals:**
- Make a row identifiable inside its day, on the surface where rows are triaged.
- Order a day the way memory works — chronologically.
- Change nothing about the 844 legacy rows: same content, same order, same appearance.
- Let a manual entry record a real time, and record *no* time honestly when there is none.

**Non-Goals:**
- Filtering, grouping or aggregating by time of day (morning/evening breakdowns). Nothing here is a statistic.
- Editing the time of an existing transaction from the dashboard.
- Making midnight distinguishable from date-only (D2 — impossible without a schema change).
- Touching the bot, the sheet schema, or the dead `mapTxn_` / `getOverview` / `getTransactions` path.

## Decisions

**D1 — Send `hm: 'HH:mm'`, a preformatted string, not a timestamp.**
The alternatives were an epoch millisecond value or an ISO datetime, with the page formatting it. Rejected for three reasons, in order of weight:
1. *Timezone.* The page has no timezone knowledge — the only clock it holds is `NOW`, injected by `doGet` as three already-localised numbers. Every other date field (`y`/`m`/`d`) is formatted server-side through `CFG.TZ`. Sending an instant would make the browser's local zone decide what time a Taipei charge happened, which is wrong for exactly the users most likely to look (travelling, or a laptop left on another zone).
2. *Ordering comes free.* Lexicographic order on `'HH:mm'` **is** chronological order, and `''` sorts before every real time — which is precisely where a timeless row belongs. No parsing, no null-guard arithmetic, no `Infinity` sentinel in the comparator.
3. *One source of truth per instant.* `y`/`m`/`d` already come from the server. A second, differently-derived representation of the same cell is a place for the two to disagree.

**D2 — `00:00:00` counts as "no time", decided by VALUE.**
Apps Script hands back a `Date` for both a date-only cell and a midnight datetime; the values are identical, so no value-based test can separate them. Two alternatives were considered:

- *Consult the cell's number format* (`getNumberFormats` over column C, treat `hh` in the pattern as "has time"). Rejected twice over. First, number format is a **display attribute**: one careless "format cells" dragged over column C would make all 844 legacy rows claim a time and render `00:00`, and nothing about that failure is visible or reversible from the dashboard. Second — and this is the part only the code shows — the bot **already** sets `yyyy/mm/dd hh:mm:ss` on every block of rows it appends, including rows whose 授權時間 it failed to parse and filled with `00:00:00`. So the format does not even faithfully record whether the value carries a time. It would be an unreliable signal *and* a fragile one.
- *A separate "has time" column in the sheet.* Rejected: it is a silent human prerequisite that fails late and far from its cause — the same design mistake `我的消費` had to be rescued from (the header had to become self-creating after two rounds of "寫入失敗" against a sheet that lacked it). Adding a column to solve a display nicety is out of proportion.

**Accepted limitation:** a charge authorised at exactly `00:00` displays no time. Rate: 國泰 is minute-precision, so the whole `00:00` minute collides (1/1440); 富邦 is second-precision (1/86400). At current volume that is roughly **one row every two and a half years**. It is purely cosmetic — the row still sorts first, which is where midnight belongs — and typing `00:01` into the cell fixes it. That is a far better failure than the number-format one being avoided.

**D3 — The midnight test runs through `CFG.TZ`, not `Date` accessors.**
`Utilities.formatDate(dt, CFG.TZ, 'HH:mm:ss') === '00:00:00'` — never `dt.getHours()`. The script's timezone and the sheet's `CFG.TZ` are separate settings and are not guaranteed to match; deriving the displayed `hm` in one zone and the is-it-midnight test in another would make a row show `08:00` while being classified as timeless. One formatted read decides both: format once as `HH:mm:ss`, treat all-zero as no time, otherwise take the first five characters.

**D4 — Display `HH:mm`; seconds never reach the screen.**
富邦 gives seconds, 國泰 does not (87 of 97 rows end in `:00`). Rendering `21:25:37` next to `21:25:00` would advertise a precision that 87% of the timed rows do not have, and the extra glyphs cost more than they say. Two 富邦 charges in the same minute are separated by the amount tiebreak (D5) instead, which is the discriminator a human actually reads.

**D5 — Sort by `hm` ascending, then by amount descending. The tiebreak is load-bearing.**
All 844 pre-June rows share the same (empty) primary key. `Array.prototype.sort` is stable, so a time-only comparator would leave them in the order they arrive in — sheet order, which is an artefact of how the bot appends and re-sorts, not a deliberate ordering. That would silently change how **82% of the history** looks, on a change whose entire justification is the 18% that has times. With the amount tiebreak, a day with no times sorts *exactly* as it does today, and only days that carry times move. This is the one property to protect in review.

Deliberately **not** falling back to descending time, or to "timeless last": a row with no time is genuinely un-placed within its day, and putting it first (where midnight sorts, and where legacy days need it to sit unchanged relative to each other) keeps one rule rather than two.

**D6 — One comparator, two call sites.**
`dayEditor` and `inboxTab` each hold their own `b.amount - a.amount` today, which is exactly how two surfaces that must agree drift apart. Extract `byTimeThenAmount(a, b)` once and call it from both. A reviewer should be able to confirm the rule by reading one function.

**D7 — `editRow` is shared by the 待記帳 queue AND the heatmap day list, and that is intended here.**
Stated explicitly so nobody later reads the time appearing in the heatmap day list as a regression, or "fixes" it by forking the component. Both surfaces list the rows of one day and both are places the user asks *which one is this*; they should not diverge. The read-only `txnRow` — category drilldown and search results — is a different question ("how much did 餐飲 cost"), and a time there is noise, so it keeps showing the date only.

**D8 — Manual add: the time is optional, and empty means a date-only cell, not a default time.**
Three options were on the table. Keeping `12:00:00` is what exists and is the worst of them: it is a fabricated value that wedges every manual entry into the middle of the day's chronological order, ahead of lunch and behind breakfast, for no reason anyone chose. Defaulting to "now" is worse than it looks — a cash entry is typically recorded hours after it happened, so "now" is a plausible-looking lie, and a plausible lie is harder to spot than a blank. So: given a time, store date + time; given nothing, store a date-only value. Cash entries are often recorded without caring what time it was, and the row then behaves exactly like a legacy row — no time shown, sorts first in its day.

**D9 — A date-only manual row must also get the `yyyy/mm/dd` number format.**
`addTxn` currently sets `yyyy/mm/dd hh:mm:ss` unconditionally. Leaving that on a date-only row would display `00:00:00` in the sheet for a row that has no time — the same lie D2 refuses to tell on screen, told in the other app instead. The format therefore follows the value: `yyyy/mm/dd` when no time was given, `yyyy/mm/dd hh:mm:ss` when one was. Note this is a *display* fix only; per D2 nothing ever *reads* the format back.

**D10 — Degrade a stale page to today's behaviour.**
`boot` normalises `t.hm` to `''` exactly as it already does for `charged` / `mine`. A page cached before the matching server version then sees `''` on every row, the comparator's primary key is uniformly equal, and the day sorts purely by amount — which is precisely what that page did before this change. No blank badge, no `undefined` on screen, no crash in the comparator.

**D11 — The optimistic row carries `hm` too.**
`submitAdd` pushes a temporary row and renders before the server answers, and `addTxn` returns a mapped object for the same reason. Both must include `hm` (derived from the submitted time, `''` when none), or a freshly added row jumps position the moment the real row arrives — the same class of "the UI disagrees with itself for one round-trip" bug the split editor had to be careful about.

## Risks / Trade-offs

- [A charge authorised at exactly `00:00` shows no time] → accepted by D2; ~one row every two and a half years, cosmetic only, the row still sorts where midnight belongs, and typing `00:01` in the cell fixes it.
- [Days from July onward visibly reorder compared to today] → intended, and it is an acceptance criterion. The risk that matters is the *inverse* — legacy days reordering — which D5 exists to prevent and which the acceptance list checks explicitly.
- [Two call sites of one sort rule drift apart later] → D6 extracts the comparator; a future third surface should call it rather than copy it.
- [Someone "fixes" the `MM/dd HH:mm` in `mapTxn_` / `getOverview` / `getTransactions` while implementing this] → those functions have no callers and are being deleted on a sibling branch; touching them here only creates a conflict. Out of scope in the proposal, and worth a reviewer's eye on the diff.
- [A page served before the matching server version] → D10; behaves exactly as it did.
- [The bot keeps writing `00:00:00` for unparseable times] → left alone on purpose. Those rows render as timeless, which is honest: the time genuinely was not known.

## Migration Plan

1. Server: `rowHM_(dt)` + `hm` in `getAllTxns`; `addTxn` accepts `fields.time`, drops the `12:00:00` default, sets the number format per D9, returns `hm`.
2. Page: `boot` default, `byTimeThenAmount`, both day sorts, `editRow` rendering + CSS, add-dialog time field and `submitAdd` wiring.
3. Offline gate: `node check_sidebar.js` must exit 0 (parse, `google.script.run` targets, `CFG.*` keys), plus a stubbed-`SpreadsheetApp` harness for the midnight rule, the comparator and the two add-dialog paths.
4. Push to `main`; the workflow runs the gate and deploys to the pinned deployment. No manual `clasp deploy`.
5. Live check against the acceptance list — in particular a pre-June day in the heatmap, which must look byte-for-byte as it did.
6. Rollback: `git revert` + redeploy. No data migration: no stored value changes meaning, and the only new write behaviour (date-only manual rows) is indistinguishable from a legacy row.

## Open Questions

- Should the time ever appear on the read-only `txnRow`? Kept off per D7. If it is ever wanted, note that one component serves both the category drilldown and the search results, so it cannot be turned on for just one of them.
- Should `updateTxn` eventually be able to *correct* a time from the dashboard? Not now — the only current fix is typing into the sheet, which is acceptable for a one-row-every-few-years correction.
- If the bot's `00:00:00` fallback were changed to write a date-only cell, midnight-authorised charges would become distinguishable from unknown-time ones. That is a bot change and a separate question; it does not block anything here.
