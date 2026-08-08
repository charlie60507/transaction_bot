## Context

Columns (0-based): A=已記帳(0), B=bank(1), C=date(2), D=last4(3), E=amount(4), F=merchant(5), G=類別auto(6), H=link(7), I=MessageId(8), J=收支別(9), K=種類manual(10); a `TAG` column located by header name somewhere past K. `getAllTxns()` is the only read path the dashboard uses (fat frontend); the page then aggregates `t.amount` in roughly a dozen places — 分析 totals, category cards, heatmap `perDay`, day-list sums, `trendData`, `cardPanel`, `projectTab`, `recurring`.

User decisions taken during design: statistics only, no repayment tracking; the field must not add friction to the ~95 rows a month that need no split; both directions of fronting occur, so no hard cap.

## Goals / Non-Goals

**Goals:**
- Every statistic reflects the owner's own consumption, not the card amount.
- A row that needs no split is indistinguishable from today.
- The card amount stays visible on split rows for reconciliation.

**Non-Goals:**
- Tracking who owes what, whether it was repaid, or a receivables view.
- Modelling the repayment itself (cash, transfer — never enters this column).
- Changing 收支別 or 種類 semantics.

## Decisions

**D1 — 代墊 is NOT a fourth value of 收支別.** This was the first idea and it is wrong for the stated goal. `ToolPanel.html` has nine `t.type==='支出'` comparisons; a row typed 代墊 falls out of every one of them, taking the portion that *is* the owner's consumption with it — the charge would vanish from 餐飲 entirely. Rescuing it means rewriting all nine predicates to an `isSpend()` helper, and **missing one fails silently**: the row simply disappears from that statistic, with no error and no visual tell.

**D2 — Change the summed VALUE, not the predicates, and do it once at the source.** `getAllTxns()` returns `amount` already netted, `charged` for display and `mine` as the raw declaration. The page's dozen aggregation sites keep summing `t.amount` unchanged. Chosen over editing each site because the failure mode of a missed site is then "still shows 7,000" — visible and self-reporting — rather than a number silently vanishing. This also resolves the `recurring()` median question by construction: it sees consumption, consistently with everything else.

**D3 — Store the owner's consumption, not the advanced amount.** It is the number typed and the number every statistic consumes. It also survives an amount correction: "I consumed 2,000" stays true if the charge is restated, whereas a stored advance of 5,000 would silently re-derive into a different share.

**D4 — Blank means the whole charge is the owner's, and the blank check comes FIRST.** `Number('') === 0`, so reading the cell before testing for blank would turn every ordinary row into "none of this was mine" and zero out the dashboard. `rowMine_` tests `'' | null | undefined` before `Number()`. A real `0` is therefore distinguishable from blank, which is required — "the whole charge was fronted for others" is a genuine case.

**D5 — Locate the column by HEADER NAME, never a fixed index.** `TAG` already lives past K via `getTagColIndex_`; hardcoding a position for the new column risks colliding with it. `getMineColIndex_` copies that existing pattern. Absent header ⇒ `-1` ⇒ every row reads as all-mine, i.e. exactly today's behaviour, so the code can ship before the sheet column exists and degrades gracefully if it is ever renamed.

**D6 — No cap at the card amount.** Usually the charge exceeds consumption (fronting for others); the reverse also happens and then consumption exceeds the charge. Over-the-charge values commit and get an explanatory inline note; only negatives and non-numbers are rejected. The note still catches a fat-fingered extra zero without blocking a legitimate entry.

**D7 — The amount is the entry point; nothing is added to `.er2`.** `editRow`'s control strip already carries 類別 / 收支 / TAG plus the 記帳 button. A fourth field would ask a question whose answer is "no" for 95% of rows. The amount becomes a button that renders as plain text, with a dashed underline on hover as the only affordance.

**D8 — Commit on Enter or 確定 only, never on blur.** On touch, blur is part of the same tap already heading for another control; committing there is how a 已記帳 press straight after typing used to be swallowed (the CT-16 class of bug). Esc and 取消 close without writing.

**D9 — Aggregate annotations appear only when the excluded amount is positive.** The reverse case makes `charged − mine` negative, and "代墊 −$2,000 未計入" is nonsense; `advOf()` clamps at 0 so those rows carry no note.

**D10 — Optimistic write with revert**, matching `applyEdit`. `applySplit` updates both `mine` and `amount` locally the same way the server normalises, so an optimistic render agrees with the next reload; failure restores both fields and toasts.

## Risks / Trade-offs

- [The sheet column is missing or renamed → the feature silently does nothing on read] → deliberate: reads degrade to today's behaviour, and *writes* fail loudly with 「找不到「我的消費」欄」 rather than writing into a neighbouring column.
- [The split gesture has no hover affordance on touch, so it is undiscoverable] → accepted; single-user tool, and the alternative (a permanent control) is the problem this design exists to avoid.
- [A stale page served before the matching server version has no `charged`] → `boot` defaults `charged` to `amount` and `mine` to null, so such a page behaves exactly as it did before.
- [`recurring()` medians shift for a split recurring charge] → intended per D2; splitting a fixed monthly subscription is rare.

## Migration Plan

1. Backend: `CFG.HDR_MINE`, `getMineColIndex_`, `rowMine_`; extend `getAllTxns` / `updateTxn`; switch the aggregation helpers.
2. Frontend: split control + inline editor, display annotations, `applySplit` wiring.
3. Verify offline: `node check_sidebar.js`, plus a VM harness that stubs SpreadsheetApp and asserts the blank/zero rule, the write payloads and the aggregation totals.
4. Add the `我的消費` header cell to the sheet.
5. Push to `main`; the deploy workflow runs the gate and deploys to the pinned deployment.
6. Rollback: `git revert` + redeploy. No data migration — an un-populated column is inert.

## Open Questions

- Should the read-only `txnRow` (category drilldown, search results) also be tappable to split? Kept read-only for now to match today's behaviour; note that it is one component serving two surfaces, so changing it changes both.
- If forgetting who has repaid ever becomes a real problem, a single `已收回` checkbox slots in and the outstanding total becomes "sum of `金額 − 我的消費` where positive and unticked". Deliberately not built now.
