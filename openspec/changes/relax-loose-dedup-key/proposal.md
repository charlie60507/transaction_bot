## Why

The loose dedup key previously used `bank + datetime (second precision) + last4 + amount`. In practice, the same transaction can appear across different notification channels (e.g., real-time alert vs. daily consumption summary) with different card last-4 digits or slight timestamp differences in seconds. This caused duplicate entries that the loose dedup should have caught.

## What Changes

- **Remove `last4` from loose dedup key**: `makeLooseDedupKey_` no longer includes the card last-4 digits. Same bank + same time + same amount is now considered a duplicate.
- **Reduce datetime precision to minute-level**: Changed from second precision (`yyyy/MM/dd HH:mm:ss`) to minute precision (`yyyy/MM/dd HH:mm`), tolerating second-level differences within the same minute.
- **Update all call sites**: All three callers (Fubon, Cathay consumption, Cathay transfer) no longer pass `last4` to `makeLooseDedupKey_`.
- **Update row-based builder**: `makeLooseDedupKeyFromRow_` no longer reads the `last4` column.

## Capabilities

### New Capabilities

(None)

### Modified Capabilities

- `dedup`: Loose dedup key fields and datetime precision changed.

## Impact

- **Files**: `cards_transaction_bot.js` — `makeLooseDedupKey_`, `makeLooseDedupKeyFromRow_`, and three call sites
- **Behavior change**: Loose dedup becomes more permissive. Transactions within the same minute, same bank, and same amount will be treated as duplicates regardless of card number. Strict dedup (with MessageId + last4 + second precision) is unchanged.
- **Risk**: In the rare case where two genuinely different transactions from the same bank with the same amount occur within the same minute, the second one will be incorrectly skipped. This scenario is extremely uncommon in daily spending.
