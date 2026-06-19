// =================== ⚙️ 設定區域 ===================

const CFG = {
  DASHBOARD_SHEET: 'Dashboard',
  DATA_SHEET: 'Transactions',
  TZ: 'Asia/Taipei',

  // Pivot table layout (left side of Dashboard)
  PIVOT_YEAR_COL: 1,       // A: year
  PIVOT_MONTH_COL: 2,      // B: month
  PIVOT_CATEGORY_START: 3, // C: first category column
  PIVOT_HEADER_ROW: 1,     // Row 1 has category names
  PIVOT_DATA_START_ROW: 2, // Data starts row 2

  // Transactions column indices (0-based)
  IDX_BANK: 1,
  IDX_DATE: 2,
  IDX_LAST4: 3,
  IDX_AMOUNT: 4,
  IDX_MERCHANT: 5,
  IDX_CATEGORY_AUTO: 6,   // G: 類別 (auto-parsed from email)
  IDX_LINK: 7,
  IDX_CATEGORY_MANUAL: 10, // K: 種類(手動) — Dashboard pivot uses this
};

// =======================================================================

/** Register custom menu on spreadsheet open */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('交易工具')
    .addItem('查看明細', 'showDrilldownSidebar')
    .addItem('TAG 統計', 'showTagSummarySidebar')
    .addToUi();
}

/** Main entry: open the drilldown sidebar */
function showDrilldownSidebar() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== CFG.DASHBOARD_SHEET) {
    ui.alert('請先切換到 Dashboard 工作表，選取要查看的類別金額儲存格，再點「交易工具 → 查看明細」。');
    return;
  }

  const ctx = getDrilldownContext_(sheet);
  if (ctx.error) {
    const tpl = HtmlService.createTemplateFromFile('DrilldownSidebar');
    tpl.data = JSON.stringify({ error: ctx.error });
    ui.showSidebar(tpl.evaluate().setTitle('交易明細'));
    return;
  }

  const txns = filterTransactions_(ss, ctx.year, ctx.month, ctx.category);
  const stats = computeStats_(txns, ctx.year, ctx.month);

  const tpl = HtmlService.createTemplateFromFile('DrilldownSidebar');
  tpl.data = JSON.stringify({
    error: null,
    year: ctx.year,
    month: ctx.month,
    category: ctx.category,
    stats: stats,
    transactions: txns
  });
  ui.showSidebar(tpl.evaluate().setTitle('交易明細'));
}

/** Read active cell on Dashboard pivot, extract year/month/category */
function getDrilldownContext_(sheet) {
  const cell = sheet.getActiveCell();
  const row = cell.getRow();
  const col = cell.getColumn();

  if (row < CFG.PIVOT_DATA_START_ROW) {
    return { error: '請選取數據區域內的儲存格（非標題列）。' };
  }
  if (col < CFG.PIVOT_CATEGORY_START) {
    return { error: '請選取類別欄位的儲存格（從第 C 欄開始）。' };
  }

  const yearVal = sheet.getRange(row, CFG.PIVOT_YEAR_COL).getValue();
  const monthVal = sheet.getRange(row, CFG.PIVOT_MONTH_COL).getValue();
  const year = Number(yearVal);
  const month = Number(monthVal);

  if (!year || !month || month < 1 || month > 12) {
    return { error: '無法從選取的列讀取有效的年/月資訊。' };
  }

  const category = String(sheet.getRange(CFG.PIVOT_HEADER_ROW, col).getValue() || '').trim();
  if (!category || category === 'Total') {
    return { error: '請選取特定類別欄位（非 Total 欄）。' };
  }

  return { year, month, category };
}

/** Filter Transactions for matching month + category, sorted newest first */
function filterTransactions_(ss, year, month, category) {
  const sh = ss.getSheetByName(CFG.DATA_SHEET);
  if (!sh || sh.getLastRow() <= 1) return [];

  const data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const results = [];

  for (const row of data) {
    const dt = row[CFG.IDX_DATE] instanceof Date ? row[CFG.IDX_DATE] : new Date(row[CFG.IDX_DATE]);
    if (isNaN(dt.getTime())) continue;

    const dtYear = dt.getFullYear();
    const dtMonth = dt.getMonth() + 1;
    // Category: use column K (手動種類) as primary — matches Dashboard pivot; fallback to G (auto)
    const rowCatManual = String(row[CFG.IDX_CATEGORY_MANUAL] || '').trim();
    const rowCatAuto = String(row[CFG.IDX_CATEGORY_AUTO] || '').trim();
    const rowCategory = rowCatManual || rowCatAuto;

    if (dtYear === year && dtMonth === month && rowCategory === category) {
      results.push({
        date: Utilities.formatDate(dt, CFG.TZ, 'MM/dd HH:mm'),
        sortKey: dt.getTime(),
        bank: String(row[CFG.IDX_BANK] || ''),
        last4: String(row[CFG.IDX_LAST4] || ''),
        amount: Number(row[CFG.IDX_AMOUNT]) || 0,
        merchant: String(row[CFG.IDX_MERCHANT] || ''),
        link: String(row[CFG.IDX_LINK] || '')
      });
    }
  }

  results.sort((a, b) => b.sortKey - a.sortKey);
  return results.map(r => { delete r.sortKey; return r; });
}

/** Compute summary stats */
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

  return {
    total,
    count,
    dailyAvg,
    largest: { amount: largest.amount, merchant: largest.merchant }
  };
}

/* =========================
 *   TAG Summary (交易工具 → TAG 統計)
 * ========================= */

/** Open the TAG summary sidebar. Data is fetched client-side via google.script.run. */
function showTagSummarySidebar() {
  const tpl = HtmlService.createTemplateFromFile('TagSummarySidebar');
  SpreadsheetApp.getUi().showSidebar(tpl.evaluate().setTitle('TAG 統計'));
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

/** Per-TAG spend totals. scope: 'all' | 'month'.
 *  Returns { scope, items:[{tag,total,count}] desc, grandTotal } or { error }. (callable from google.script.run) */
function getTagSummary(scope) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.DATA_SHEET);
  if (!sh || sh.getLastRow() <= 1) return { scope: scope, items: [], grandTotal: 0 };

  const tagIdx = getTagColIndex_(sh);
  if (tagIdx === -1) return { error: '找不到 Transactions 的「TAG」欄位。' };

  const data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const useMonth = (scope === 'month');
  const ym = useMonth ? currentYearMonth_() : null;

  const map = {}; // tag -> { total, count }
  for (const row of data) {
    const tag = String(row[tagIdx] || '').trim();
    if (!tag) continue;

    if (useMonth) {
      const dt = row[CFG.IDX_DATE] instanceof Date ? row[CFG.IDX_DATE] : new Date(row[CFG.IDX_DATE]);
      if (isNaN(dt.getTime())) continue;
      if (dt.getFullYear() !== ym.year || (dt.getMonth() + 1) !== ym.month) continue;
    }

    const amount = Number(row[CFG.IDX_AMOUNT]) || 0;
    if (!map[tag]) map[tag] = { total: 0, count: 0 };
    map[tag].total += amount;
    map[tag].count += 1;
  }

  const items = Object.keys(map)
    .map(tag => ({ tag: tag, total: map[tag].total, count: map[tag].count }))
    .sort((a, b) => b.total - a.total);
  const grandTotal = items.reduce((s, it) => s + it.total, 0);
  return { scope: scope, items: items, grandTotal: grandTotal };
}

/** Transactions for one TAG. scope: 'all' | 'month'.
 *  Returns { tag, scope, stats, transactions } or { error }. (callable from google.script.run) */
function getTagTransactions(tag, scope) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.DATA_SHEET);
  const useMonth = (scope === 'month');
  const ym = useMonth ? currentYearMonth_() : currentYearMonth_();

  if (!sh || sh.getLastRow() <= 1) {
    return { tag: tag, scope: scope, stats: computeStats_([], ym.year, ym.month), transactions: [] };
  }

  const tagIdx = getTagColIndex_(sh);
  if (tagIdx === -1) return { error: '找不到 Transactions 的「TAG」欄位。' };

  const data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const results = [];
  for (const row of data) {
    if (String(row[tagIdx] || '').trim() !== tag) continue;

    const dt = row[CFG.IDX_DATE] instanceof Date ? row[CFG.IDX_DATE] : new Date(row[CFG.IDX_DATE]);
    if (isNaN(dt.getTime())) continue;
    if (useMonth && (dt.getFullYear() !== ym.year || (dt.getMonth() + 1) !== ym.month)) continue;

    results.push({
      date: Utilities.formatDate(dt, CFG.TZ, 'MM/dd HH:mm'),
      sortKey: dt.getTime(),
      bank: String(row[CFG.IDX_BANK] || ''),
      last4: String(row[CFG.IDX_LAST4] || ''),
      amount: Number(row[CFG.IDX_AMOUNT]) || 0,
      merchant: String(row[CFG.IDX_MERCHANT] || ''),
      link: String(row[CFG.IDX_LINK] || '')
    });
  }

  results.sort((a, b) => b.sortKey - a.sortKey);
  const txns = results.map(r => { delete r.sortKey; return r; });
  return { tag: tag, scope: scope, stats: computeStats_(txns, ym.year, ym.month), transactions: txns };
}
