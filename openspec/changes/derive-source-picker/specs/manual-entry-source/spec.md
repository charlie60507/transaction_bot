## ADDED Requirements

### Requirement: The 來源 options come from the transactions, never from a hardcoded list

The manual-add dialog's 來源 field SHALL offer the distinct `銀行` values carried by the transactions already loaded in the page. No account name may be written into the markup or into any constant. A source that appears in the data SHALL become offerable without a code change, and a source that never appears SHALL never be offered.

#### Scenario: The accounts that carry the spending are offerable

- **WHEN** the sheet's transactions name 國泰, 富邦, 現金 and 台新
- **THEN** the 來源 field offers exactly those four
- **AND** no name absent from the data — such as 悠遊卡 or 街口支付 — is offered

#### Scenario: A new account needs no code change

- **WHEN** a transaction naming a previously unseen account reaches the sheet
- **THEN** that account appears among the 來源 options on the next load

#### Scenario: No transactions at all

- **WHEN** the page holds no transactions
- **THEN** the 來源 field offers nothing and is empty, and a manual entry can still be saved by typing a source

### Requirement: A source outside the list can still be recorded

The 來源 field SHALL accept a value that is not among its options, because an account cannot appear in the data until a transaction carries it and manual entry may be the only way to create that transaction. The list SHALL suggest, never constrain.

#### Scenario: Recording a newly opened account

- **WHEN** the owner types an account name that no transaction carries yet
- **THEN** the value is saved to the 銀行 column exactly as typed, trimmed of surrounding whitespace

#### Scenario: An emptied field

- **WHEN** the 來源 field is submitted empty
- **THEN** the row is still recorded, with the server's existing 現金 default

### Requirement: The options are ordered by how the field is actually used

Options SHALL be ordered in two groups: sources that have previously been entered manually, ranked by how often, followed by all remaining sources ranked by overall frequency. The field SHALL be pre-filled with the first option. The ordering MUST be computed from the data, not asserted in code.

#### Scenario: Cash leads because cash is what gets typed

- **WHEN** every manually entered row so far names 現金, while 國泰 and 富邦 carry far more transactions overall
- **THEN** 現金 is offered first and pre-filled
- **AND** 國泰 precedes 富邦, and both precede 台新, by overall frequency

#### Scenario: The order follows a change in habit

- **WHEN** the owner begins entering another account manually more often than 現金
- **THEN** that account moves ahead of 現金 with no change to the code
