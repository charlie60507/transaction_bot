## MODIFIED Requirements

### Requirement: Loose dedup key composition
The loose dedup key SHALL be composed of `bank`, `datetime` (minute precision), and `amount` only. The key SHALL NOT include `last4` (card last-4 digits) or `messageId`.

#### Scenario: Loose key excludes last4
- **WHEN** `makeLooseDedupKey_` is called with `{ bank, dt, amount }`
- **THEN** the returned key SHALL be `bank | yyyy/MM/dd HH:mm | amount` with no `last4` component

#### Scenario: Same transaction with different card numbers is deduped
- **WHEN** two transactions share the same bank, same minute, and same amount but differ in `last4`
- **THEN** the second transaction SHALL be treated as a duplicate by loose dedup and skipped

#### Scenario: Same transaction with seconds-level difference is deduped
- **WHEN** two transactions share the same bank, same amount, and same `HH:mm` but differ at the seconds level
- **THEN** the second transaction SHALL be treated as a duplicate by loose dedup and skipped

### Requirement: Loose dedup key from existing row
The `makeLooseDedupKeyFromRow_` function SHALL build the loose key from row data using only `bank` (column B), `datetime` (column C, minute precision), and `amount` (column E). It SHALL NOT read the `last4` column (column D).

#### Scenario: Row-based loose key matches function-based loose key
- **WHEN** a row contains bank="富邦", datetime=2025/04/01 14:30:45, amount=500
- **THEN** `makeLooseDedupKeyFromRow_` SHALL return `富邦|2025/04/01 14:30|500`, identical to `makeLooseDedupKey_({ bank: '富邦', dt: <same datetime>, amount: 500 })`

### Requirement: All call sites pass correct arguments
All callers of `makeLooseDedupKey_` (Fubon, Cathay consumption, Cathay transfer) SHALL pass only `{ bank, dt, amount }` without `last4`.

#### Scenario: Fubon call site
- **WHEN** processing a Fubon transaction email
- **THEN** the call to `makeLooseDedupKey_` SHALL use `{ bank: '富邦', dt, amount }` with no `last4` parameter

#### Scenario: Cathay consumption call site
- **WHEN** processing a Cathay consumption notification
- **THEN** the call to `makeLooseDedupKey_` SHALL use `{ bank: '國泰', dt, amount }` with no `last4` parameter

#### Scenario: Cathay transfer call site
- **WHEN** processing a Cathay transfer notification
- **THEN** the call to `makeLooseDedupKey_` SHALL use `{ bank: '國泰', dt, amount }` with no `last4` parameter

### Requirement: Strict dedup unchanged
The strict dedup key (`makeDedupKey_`) SHALL remain unchanged: `bank | messageId | datetime(seconds) | last4 | amount`.

#### Scenario: Strict key still includes all fields
- **WHEN** `makeDedupKey_` is called
- **THEN** the returned key SHALL include `bank`, `messageId`, `datetime` (second precision), `last4`, and `amount`
