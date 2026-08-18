## ADDED Requirements

### Requirement: 來源 is a dropdown of every loaded 銀行

The manual-add dialog's 來源 field SHALL be a closed `<select>` whose options are the distinct non-empty `銀行` values already carried by the transactions loaded in the page. No account name MAY be written into the markup or into any constant. A source that appears in the data SHALL become an option without a code change, and a source that never appears SHALL never be offered.

#### Scenario: Used accounts are all pickable

- **WHEN** the loaded transactions name 國泰, 富邦, 現金 and 臺新
- **THEN** opening 新增交易 shows 來源 as a `<select>` whose options are exactly those names
- **AND** no name absent from the data — such as 悠遊卡 or 街口支付 — is offered

#### Scenario: A newly seen account needs no code change

- **WHEN** a transaction naming a previously unseen account reaches the sheet and the page reloads
- **THEN** that account appears as a 來源 option

#### Scenario: No transactions at all

- **WHEN** the page holds no transactions
- **THEN** the 來源 select has no options

### Requirement: The field is not free text

來源 SHALL NOT be a text input or a `<datalist>`. A value that is not among the derived options cannot be submitted from this dialog.

#### Scenario: Markup is a select, not a datalist input

- **WHEN** the add-transaction dialog is rendered
- **THEN** `#a-source` is a `<select>`
- **AND** the page has no `datalist#banklist`

### Requirement: Options keep the existing derived order and default

Options SHALL be ordered in two groups: sources previously entered manually, ranked by how often, followed by all remaining sources ranked by overall frequency. Ties SHALL keep first-seen order. The select SHALL be pre-selected to the first option. The ordering MUST be computed from the data, not asserted in code.

#### Scenario: Cash leads because cash is what gets typed

- **WHEN** every manually entered row so far names 現金, while 國泰 and 富邦 carry far more transactions overall
- **THEN** 現金 is the first option and is selected when the dialog opens
- **AND** 國泰 precedes 富邦, and both precede 臺新, by overall frequency

#### Scenario: Choosing another account saves that source

- **WHEN** the owner picks 國泰 (or 富邦, or 臺新) and saves
- **THEN** the new row's 銀行 is that picked name
