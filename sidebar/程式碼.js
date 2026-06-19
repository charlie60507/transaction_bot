// =================== ⚙️ 設定區域 ===================

const CFG = {
  SPREADSHEET_ID: '1PZfUiqaMeUHHSBi8zqEPnEgBfFXqTxKwhnQUltCb8VU',
  DATA_SHEET: 'Transactions',
  TZ: 'Asia/Taipei',

  // Transactions column indices (0-based)
  IDX_BANK: 1,
  IDX_DATE: 2,
  IDX_LAST4: 3,
  IDX_AMOUNT: 4,
  IDX_MERCHANT: 5,
  IDX_CATEGORY_AUTO: 6,    // G: 類別 (auto-parsed from email)
  IDX_LINK: 7,
  IDX_CATEGORY_MANUAL: 10, // K: 種類(手動) — primary category
};

// =======================================================================
//   Menu + Web App entry
// =======================================================================

/** Register custom menu on spreadsheet open */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('交易工具')
    .addItem('開啟面板', 'showPanelLauncher')
    .addToUi();
}

/** Menu action: open the unified panel as a modal dialog inside the spreadsheet
 *  (runs as the account that has the sheet open — no Web App URL / account routing). */
function showPanelLauncher() {
  const html = HtmlService.createTemplateFromFile('ToolPanel').evaluate()
    .setWidth(820)
    .setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, '交易工具');
}

// =======================================================================
//   Shared helpers
// =======================================================================

/** The bound spreadsheet, opened by id (works in Web App context, which has no active spreadsheet) */
function getSpreadsheet_() {
  return SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
}

/** Read Transactions data rows (row 2..last). Returns { sh, rows }. */
function dataRows_() {
  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  if (!sh || sh.getLastRow() <= 1) return { sh: sh, rows: [] };
  return { sh: sh, rows: sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues() };
}

/** Parse the date cell; return the Date if valid AND in scope, else null. */
function inScope_(row, useMonth, ym) {
  const dt = row[CFG.IDX_DATE] instanceof Date ? row[CFG.IDX_DATE] : new Date(row[CFG.IDX_DATE]);
  if (isNaN(dt.getTime())) return null;
  if (useMonth && (dt.getFullYear() !== ym.year || (dt.getMonth() + 1) !== ym.month)) return null;
  return dt;
}

/** Map a Transactions row to a transaction-card object (sortKey stripped by caller). */
function mapTxn_(row, dt) {
  return {
    date: Utilities.formatDate(dt, CFG.TZ, 'MM/dd HH:mm'),
    sortKey: dt.getTime(),
    bank: String(row[CFG.IDX_BANK] || ''),
    last4: String(row[CFG.IDX_LAST4] || ''),
    amount: Number(row[CFG.IDX_AMOUNT]) || 0,
    merchant: String(row[CFG.IDX_MERCHANT] || ''),
    link: String(row[CFG.IDX_LINK] || '')
  };
}

/** Category value for a row: manual (K) first, fallback auto (G). */
function rowCategory_(row) {
  const m = String(row[CFG.IDX_CATEGORY_MANUAL] || '').trim();
  const a = String(row[CFG.IDX_CATEGORY_AUTO] || '').trim();
  return m || a;
}

/** 0-based index of the "TAG" header in Transactions, or -1 if absent */
function getTagColIndex_(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return headers.indexOf('TAG');
}

/** Current year/month in the configured timezone */
function currentYearMonth_() {
  const now = new Date();
  return {
    year: Number(Utilities.formatDate(now, CFG.TZ, 'yyyy')),
    month: Number(Utilities.formatDate(now, CFG.TZ, 'M'))
  };
}

/** Summary stats over a transaction list */
function computeStats_(txns, year, month) {
  if (txns.length === 0) {
    return { total: 0, count: 0, dailyAvg: 0, largest: null };
  }
  const total = txns.reduce((sum, t) => sum + t.amount, 0);
  const count = txns.length;
  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyAvg = Math.round(total / daysInMonth);
  let largest = txns[0];
  for (const t of txns) {
    if (t.amount > largest.amount) largest = t;
  }
  return { total, count, dailyAvg, largest: { amount: largest.amount, merchant: largest.merchant } };
}

// =======================================================================
//   Generic summary / drill-in (parameterised by a key extractor)
// =======================================================================

/** Group by keyFn(row), sum amount, count. scope: 'all' | 'month'.
 *  Returns { scope, items:[{name,total,count}] desc, grandTotal }. */
function summarize_(scope, keyFn) {
  const { rows } = dataRows_();
  const useMonth = (scope === 'month');
  const ym = useMonth ? currentYearMonth_() : null;

  const map = {};
  for (const row of rows) {
    if (!inScope_(row, useMonth, ym)) continue;
    const key = keyFn(row);
    if (!key) continue;
    if (!map[key]) map[key] = { total: 0, count: 0 };
    map[key].total += Number(row[CFG.IDX_AMOUNT]) || 0;
    map[key].count += 1;
  }

  const items = Object.keys(map)
    .map(k => ({ name: k, total: map[k].total, count: map[k].count }))
    .sort((a, b) => b.total - a.total);
  return { scope: scope, items: items, grandTotal: items.reduce((s, it) => s + it.total, 0) };
}

/** Transactions where matchFn(row) is true, in scope, newest-first, with stats.
 *  Returns { name, scope, stats, transactions }. */
function drill_(scope, matchFn, name) {
  const { rows } = dataRows_();
  const useMonth = (scope === 'month');
  const ym = currentYearMonth_();

  const results = [];
  for (const row of rows) {
    if (!matchFn(row)) continue;
    const dt = inScope_(row, useMonth, ym);
    if (!dt) continue;
    results.push(mapTxn_(row, dt));
  }
  results.sort((a, b) => b.sortKey - a.sortKey);
  const txns = results.map(r => { delete r.sortKey; return r; });
  return { name: name, scope: scope, stats: computeStats_(txns, ym.year, ym.month), transactions: txns };
}

// =======================================================================
//   Public query functions (callable from the panel via google.script.run)
// =======================================================================

/** Per-category spend totals. scope: 'all' | 'month'. */
function getCategorySummary(scope) {
  return summarize_(scope, rowCategory_);
}

/** Transactions for one category. */
function getCategoryTransactions(name, scope) {
  return drill_(scope, row => rowCategory_(row) === name, name);
}

/** Per-TAG spend totals. scope: 'all' | 'month'. */
function getTagSummary(scope) {
  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  if (!sh) return { scope: scope, items: [], grandTotal: 0 };
  const tagIdx = getTagColIndex_(sh);
  if (tagIdx === -1) return { error: '找不到 Transactions 的「TAG」欄位。' };
  return summarize_(scope, row => String(row[tagIdx] || '').trim());
}

/** Transactions for one TAG. */
function getTagTransactions(name, scope) {
  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  const ym = currentYearMonth_();
  if (!sh) return { name: name, scope: scope, stats: computeStats_([], ym.year, ym.month), transactions: [] };
  const tagIdx = getTagColIndex_(sh);
  if (tagIdx === -1) return { error: '找不到 Transactions 的「TAG」欄位。' };
  return drill_(scope, row => String(row[tagIdx] || '').trim() === name, name);
}
