## Context

The bot uses a two-tier dedup strategy when appending transactions to the Google Sheet:

1. **Strict dedup**: `bank | messageId | datetime(seconds) | last4 | amount` — exact match, catches identical re-imports.
2. **Loose dedup**: `bank | datetime(seconds) | last4 | amount` — catches the same transaction arriving via different emails (different MessageId).

The loose key is too narrow: the same real-world transaction can appear with different `last4` values (e.g., consumption summary vs. real-time alert) and with slightly different timestamps at the seconds level. This causes false negatives in dedup, leading to duplicate rows.

## Goals / Non-Goals

**Goals:**
- Widen the loose dedup key to catch cross-channel duplicates by removing `last4` and reducing time precision to minute-level.
- Keep strict dedup unchanged so exact re-imports are still caught precisely.

**Non-Goals:**
- Changing the strict dedup key (`makeDedupKey_`).
- Adding new dedup tiers or configurable precision.
- Backfilling or cleaning up existing duplicate rows in the sheet.

## Decisions

### 1. Remove `last4` from loose key

**Choice**: Drop `last4` entirely from the loose dedup key.

**Rationale**: The primary scenario causing duplicates is the same transaction reported with different card identifiers across notification types. Removing `last4` eliminates this class of false negatives. The strict key still includes `last4` for precise matching.

**Alternative considered**: Keep `last4` but make it optional — rejected because it adds complexity with no meaningful benefit; the strict key already covers the precise case.

### 2. Minute-level datetime precision

**Choice**: Format datetime as `yyyy/MM/dd HH:mm` (drop seconds).

**Rationale**: Notification emails for the same transaction can report timestamps that differ by a few seconds. Minute-level precision is sufficient granularity for dedup while tolerating these differences.

**Alternative considered**: Round to nearest 5-minute window — rejected as too aggressive; minute precision is the minimal relaxation needed.

## Risks / Trade-offs

- **False positive dedup** → Two genuinely different transactions from the same bank, same amount, within the same minute will be treated as duplicates. Mitigation: this scenario is extremely rare in practice; strict dedup (with MessageId) ensures at least one copy is always kept.
- **No rollback needed** → This is a logic-only change with no data migration. If false positives become an issue, the key can be tightened back by re-adding fields.
