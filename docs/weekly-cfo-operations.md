# Weekly CFO Operations

The weekly CFO report is computed by the dashboard/Ledger Apps Script project and pushed by the
LINE Apps Script project. The scheduled report runs on Monday morning in `Asia/Taipei` and covers
the preceding Monday through Sunday. Its month projection uses recorded daily consumption only;
it never adds expected subscriptions or missing entries.

## One-time trigger installation

1. Open the `Linebot-response` Apps Script project associated with `linebot/.clasp.json`.
2. Select and run `installWeeklyCfoTrigger` from the editor.
3. Complete the authorization prompt if Apps Script requests it.
4. Open **Triggers** and confirm exactly one time-driven trigger targets
   `sendWeeklyCfoReport`, runs weekly on Monday, and is configured for the 08:00 hour in
   `Asia/Taipei`.

The installer is idempotent. Running it again keeps one correct weekly-CFO handler trigger and
does not touch unrelated triggers. Ordinary report execution never installs or changes triggers.

## Verification

Before pushing a change, run the repository gate:

```sh
node check_sidebar.js
```

For live verification:

1. In the LINE Apps Script project, run `sendWeeklyCfoReportManual` once.
2. Confirm that exactly one Flex card arrives in the owner's LINE account.
3. Compare the card's week total, month-to-date daily spending, month-end projection, configured
   baseline, named observations, and optional project total with the dashboard and source sheet at
   the same Sunday cutoff.
4. Check the Apps Script execution log for a successful run. The log must not contain the owner
   user ID, channel access token, transaction facts, or Gemini request/response bodies.

The manual sender deliberately bypasses the scheduled sent-week key and does not modify it. It is
safe for an explicit operator test, but every invocation sends another card.

To verify scheduled idempotency in a controlled test project, invoke `sendWeeklyCfoReport` twice
for the same report week and observe one push. A failed LINE HTTP response must leave the
`weekly-cfo:last-sent-week` Script Property unchanged so that a later invocation retries.

## Failure behavior

- A missing `CHANNEL_ACCESS_TOKEN` or `OWNER_USER_ID` fails the execution before delivery.
- A non-200 LINE push response fails the execution and does not advance the sent-week key.
- Gemini failure, invalid JSON, or any numeric token not present in the computed facts discards
  all Gemini prose. The deterministic facts-only card is still sent.
- Without recorded current-month daily consumption, the projection is shown as unavailable.
- Subscription-change text is absent until a separate verified detector is available; absence of
  a recorded charge is never treated as a subscription event.

## Rollback

Code rollback uses Git history: revert the change on `main` and let the normal path-filtered
workflows redeploy `sidebar/` and `linebot/` to their pinned deployment IDs. Do not create a new
Apps Script deployment ID and do not deploy from the repository root.

To stop only the schedule while investigating, delete the trigger whose handler is
`sendWeeklyCfoReport` in the LINE project's **Triggers** page. This does not affect webhook replies
or transaction recording. Re-run `installWeeklyCfoTrigger` after the code and credentials are
healthy.
