## 1. Menu + entry (sidebar/程式碼.js)

- [x] 1.1 In `onOpen` (:29), add `.addItem('TAG 統計', 'showTagSummarySidebar')` after the existing `查看明細` item.
- [x] 1.2 Add `showTagSummarySidebar()`: create the `TagSummarySidebar` HtmlService template and show it as a sidebar titled `TAG 統計` (no server-injected data — the HTML fetches on load).

## 2. Server query functions (sidebar/程式碼.js)

- [x] 2.1 Add helper `getTagColIndex_(sh)`: return the 0-based index of the `TAG` header, or -1.
- [x] 2.2 Add `getTagSummary(scope)` (no trailing underscore): read Transactions, locate TAG col; filter by scope (`'all'` / `'month'` using col C date vs current TZ year/month); group by TAG, sum col E, count; return `{ scope, items:[{tag,total,count}] sorted desc, grandTotal }`; skip blank-TAG rows; if TAG col missing return `{ error }`.
- [x] 2.3 Add `getTagTransactions(tag, scope)` (no trailing underscore): mirror `filterTransactions_` (:101) row→object mapping + newest-first sort, but match `TAG column === tag` (+ scope month); return `{ tag, scope, stats, transactions:[...] }` using `computeStats_` (:137).

## 3. Sidebar UI (sidebar/TagSummarySidebar.html)

- [x] 3.1 Create the file reusing `DrilldownSidebar.html` CSS (header / stat-box / card / badge / footer); include an esc()/fmt() helper as in the existing sidebar.
- [x] 3.2 Overview view: 全部/當月 toggle; one clickable row per TAG (name, total, count, relative proportion bar); empty + error states.
- [x] 3.3 On load call `google.script.run.withSuccessHandler(render).getTagSummary('all')`; toggle re-fetches the other scope.
- [x] 3.4 Detail view: clicking a TAG calls `google.script.run.getTagTransactions(tag, scope)` → render transaction cards + stats; a `← 返回` control returns to the overview in the same scope.

## 4. Deploy + verify

- [x] 4.1 Push the BOUND project via a temp `.clasp.json` (`rootDir:""`, scriptId `1P4l2…`) to avoid the nested-dir quirk.
- [ ] 4.2 Reopen the spreadsheet: `交易工具` menu shows `TAG 統計`; open it and confirm per-TAG totals (desc), 全部/當月 toggle correctness, click-through to a TAG's transactions + stats, `返回`, and empty/error states.
- [x] 4.3 Sync `sidebar/` back to git; commit + push.
