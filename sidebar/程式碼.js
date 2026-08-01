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
  IDX_INOUT: 9,            // J: 收支別 ("收入"/"支出"; blank ⇒ 支出)
  IDX_CATEGORY_MANUAL: 10, // K: 種類(手動) — primary category
};

// =======================================================================
//   Menu + Web App entry
// =======================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('交易工具')
    .addItem('開啟面板', 'showPanelLauncher')
    .addToUi();
}

/** Web App entry: serve the dashboard page (injects real NOW in sheet TZ) */
function doGet(e) {
  const t = HtmlService.createTemplateFromFile('ToolPanel');
  t.now = nowYMD_();
  return t.evaluate()
    .setTitle('交易工具')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Current Y/M/D in the configured timezone, for injecting into the page. */
function nowYMD_() {
  const now = new Date();
  return {
    year:  Number(Utilities.formatDate(now, CFG.TZ, 'yyyy')),
    month: Number(Utilities.formatDate(now, CFG.TZ, 'M')),
    day:   Number(Utilities.formatDate(now, CFG.TZ, 'd'))
  };
}

/** Flat array of ALL transactions for the client-side dashboard.
 *  Fat-frontend: NO aggregation here — the v5 page does all of it. */
function getAllTxns() {
  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  if (!sh || sh.getLastRow() <= 1) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const tagIdx = getTagColIndex_(sh);            // -1 if no TAG header
  const out = [];
  for (const row of rows) {
    const raw = row[CFG.IDX_DATE];
    const dt = raw instanceof Date ? raw : new Date(raw);
    if (isNaN(dt.getTime())) continue;           // skip blank / unparseable rows
    const inout = String(row[CFG.IDX_INOUT] || '').trim();
    // A transfer is money moved between the user's own accounts — identified
    // ONLY by the 收支別 (J) column reading '轉帳', never by the merchant
    // category. Anything else transferred out still counts as normal spend.
    out.push({
      y: Number(Utilities.formatDate(dt, CFG.TZ, 'yyyy')),
      m: Number(Utilities.formatDate(dt, CFG.TZ, 'M')),
      d: Number(Utilities.formatDate(dt, CFG.TZ, 'd')),
      type: inout === '轉帳' ? '轉帳' : (inout === '收入' ? '收入' : '支出'),
      amount: Number(row[CFG.IDX_AMOUNT]) || 0,
      cat: rowCategory_(row) || '未分類',
      merchant: String(row[CFG.IDX_MERCHANT] || ''),
      tag: tagIdx === -1 ? '' : String(row[tagIdx] || '').trim(),
      bank: String(row[CFG.IDX_BANK] || ''),
      last4: String(row[CFG.IDX_LAST4] || ''),
      link: String(row[CFG.IDX_LINK] || '')
    });
  }
  return out;
}

/** Web App URL of the user's live deployment.
 *  Hardcoded on purpose: ScriptApp.getService().getUrl() returns an
 *  unpredictable/stale deployment URL when the project has multiple
 *  deployments, which makes the menu open an invalid link (Drive's
 *  "can't open this file"). This is the deployment the user actually uses. */
function getWebAppUrl() {
  return 'https://script.google.com/macros/s/AKfycbyvVvKPI45Y5zooV9VbzYSN_54EWqQTqjsE6bJPTgBpfvcdJZ13YIynh3rBKdRM3bKaag/exec';
}

/** Menu action: dialog with a clickable link that opens the Web App in a new tab */
function showPanelLauncher() {
  const url = getWebAppUrl();
  let html;
  if (!url) {
    html = HtmlService.createHtmlOutput(
      '<p style="font-family:-apple-system,sans-serif;padding:16px;color:#333">' +
      '尚未部署為網頁應用程式。請先在編輯器：部署 → 新增部署 → 網頁應用程式。</p>'
    ).setWidth(380).setHeight(150);
  } else {
    html = HtmlService.createHtmlOutput(
      '<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:22px;text-align:center">' +
      '<p style="margin-bottom:16px;color:#333">在新分頁開啟交易工具面板：</p>' +
      '<a href="' + url + '" target="_blank" rel="noopener" ' +
      'style="display:inline-block;background:#1a73e8;color:#fff;text-decoration:none;padding:11px 24px;border-radius:10px;font-weight:600">開啟面板 ↗</a>' +
      '<p style="margin-top:14px;color:#999;font-size:12px">多帳號若開不了，請用無痕視窗只登入擁有者帳號。</p>' +
      '</div>'
    ).setWidth(400).setHeight(180);
  }
  SpreadsheetApp.getUi().showModalDialog(html, '交易工具');
}

// =======================================================================
//   Shared helpers
// =======================================================================

/** The target spreadsheet (Web App has no active spreadsheet → open by id). */
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

/** Summary stats over a transaction list (year/month used for daily average). */
function computeStats_(txns, year, month) {
  if (txns.length === 0) return { total: 0, count: 0, dailyAvg: 0, largest: null };
  const total = txns.reduce((sum, t) => sum + t.amount, 0);
  const count = txns.length;
  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyAvg = Math.round(total / daysInMonth);
  let largest = txns[0];
  for (const t of txns) if (t.amount > largest.amount) largest = t;
  return { total, count, dailyAvg, largest: { amount: largest.amount, merchant: largest.merchant } };
}

/** Resolve a scope string. 'all' → no filter; 'month' → current month; 'YYYY-MM' → that month. */
function resolveScope_(scope) {
  if (typeof scope === 'string' && /^\d{4}-\d{2}$/.test(scope)) {
    const p = scope.split('-');
    return { useMonth: true, ym: { year: Number(p[0]), month: Number(p[1]) } };
  }
  if (scope === 'month') return { useMonth: true, ym: currentYearMonth_() };
  return { useMonth: false, ym: currentYearMonth_() }; // 'all'
}

/** Key extractor for a dimension. tag needs the TAG column; returns { keyFn } or { error }. */
function dimKeyFn_(dimension, sh) {
  if (dimension === 'tag') {
    const idx = getTagColIndex_(sh);
    if (idx === -1) return { error: '找不到 Transactions 的「TAG」欄位。' };
    return { keyFn: function (row) { return String(row[idx] || '').trim(); } };
  }
  return { keyFn: rowCategory_ };
}

/** Row-keep predicate for a dimension. category → must have a manual 種類(K);
 *  tag → must have a TAG. Rows failing the test drop out of every stat. */
function dimKeepFn_(dimension, k) {
  if (dimension === 'category') {
    return function (row) { return String(row[CFG.IDX_CATEGORY_MANUAL] || '').trim() !== ''; };
  }
  return function (row) { return k.keyFn(row) !== ''; };
}

/** Period KPIs over in-scope rows. `keep` (optional) filters which rows count. */
function periodSummary_(rows, r, keep) {
  let total = 0, count = 0, largest = null, minT = null, maxT = null;
  for (const row of rows) {
    if (keep && !keep(row)) continue;
    const dt = inScope_(row, r.useMonth, r.ym);
    if (!dt) continue;
    const amt = Number(row[CFG.IDX_AMOUNT]) || 0;
    total += amt; count++;
    if (!largest || amt > largest.amount) largest = { amount: amt, merchant: String(row[CFG.IDX_MERCHANT] || '') };
    const t = dt.getTime();
    if (minT === null || t < minT) minT = t;
    if (maxT === null || t > maxT) maxT = t;
  }
  let days;
  if (r.useMonth) days = new Date(r.ym.year, r.ym.month, 0).getDate();
  else days = (minT === null) ? 1 : Math.max(1, Math.round((maxT - minT) / 86400000) + 1);
  return { total: total, count: count, dailyAvg: count ? Math.round(total / days) : 0, largest: largest };
}

/** Last n months of overall spend (oldest→newest). Each: { ym:'YYYY-MM', label:'M月', total }.
 *  `keep` (optional) filters which rows count. */
function monthlyTrend_(rows, n, keep) {
  const cur = currentYearMonth_();
  const months = [];
  let y = cur.year, m = cur.month;
  for (let i = 0; i < n; i++) { months.unshift({ year: y, month: m }); m--; if (m < 1) { m = 12; y--; } }
  const totals = {};
  months.forEach(function (mm) { totals[mm.year + '-' + mm.month] = 0; });
  for (const row of rows) {
    if (keep && !keep(row)) continue;
    const dt = row[CFG.IDX_DATE] instanceof Date ? row[CFG.IDX_DATE] : new Date(row[CFG.IDX_DATE]);
    if (isNaN(dt.getTime())) continue;
    const key = dt.getFullYear() + '-' + (dt.getMonth() + 1);
    if (key in totals) totals[key] += Number(row[CFG.IDX_AMOUNT]) || 0;
  }
  return months.map(function (mm) {
    const mm2 = (mm.month < 10 ? '0' : '') + mm.month;
    return { ym: mm.year + '-' + mm2, label: mm.month + '月', total: totals[mm.year + '-' + mm.month] };
  });
}

// =======================================================================
//   Public API (callable from the dashboard via google.script.run)
// =======================================================================

/** dimension: 'category' | 'tag'; scope: 'all' | 'month' | 'YYYY-MM'.
 *  Returns { dimension, scope, items, grandTotal, period, trend } or { error }. */
function getOverview(dimension, scope) {
  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  const r = resolveScope_(scope);
  if (!sh || sh.getLastRow() <= 1) {
    return { dimension: dimension, scope: scope, items: [], grandTotal: 0,
      period: { total: 0, count: 0, dailyAvg: 0, largest: null }, trend: monthlyTrend_([], 6) };
  }
  const k = dimKeyFn_(dimension, sh);
  if (k.error) return { error: k.error };

  // Rows with no value for the active dimension (empty 種類(手動) / empty TAG)
  // are dropped from every stat (KPIs, breakdown, trend) so cards match the sum.
  const keep = dimKeepFn_(dimension, k);

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const map = {};
  for (const row of rows) {
    if (!keep(row)) continue;
    if (!inScope_(row, r.useMonth, r.ym)) continue;
    const key = k.keyFn(row);
    if (!key) continue;
    if (!map[key]) map[key] = { total: 0, count: 0 };
    map[key].total += Number(row[CFG.IDX_AMOUNT]) || 0;
    map[key].count += 1;
  }
  const items = Object.keys(map)
    .map(function (x) { return { name: x, total: map[x].total, count: map[x].count }; })
    .sort(function (a, b) { return b.total - a.total; });

  return {
    dimension: dimension, scope: scope,
    items: items,
    grandTotal: items.reduce(function (s, it) { return s + it.total; }, 0),
    period: periodSummary_(rows, r, keep),
    trend: monthlyTrend_(rows, 6, keep)
  };
}

/** Transactions for one item. Returns { name, scope, stats, transactions } or { error }. */
function getTransactions(dimension, name, scope) {
  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  const r = resolveScope_(scope);
  if (!sh || sh.getLastRow() <= 1) {
    return { name: name, scope: scope, stats: computeStats_([], r.ym.year, r.ym.month), transactions: [] };
  }
  const k = dimKeyFn_(dimension, sh);
  if (k.error) return { error: k.error };

  const keep = dimKeepFn_(dimension, k);
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const results = [];
  for (const row of rows) {
    if (!keep(row)) continue;
    if (k.keyFn(row) !== name) continue;
    const dt = inScope_(row, r.useMonth, r.ym);
    if (!dt) continue;
    results.push(mapTxn_(row, dt));
  }
  results.sort(function (a, b) { return b.sortKey - a.sortKey; });
  const txns = results.map(function (x) { delete x.sortKey; return x; });
  return { name: name, scope: scope, stats: computeStats_(txns, r.ym.year, r.ym.month), transactions: txns };
}

/** Year bounds for the month selector: { minYear, maxYear, curYear, curMonth }. */
function getMonthSelectorRange() {
  const { rows } = dataRows_();
  const cur = currentYearMonth_();
  let minYear = cur.year, maxYear = cur.year;
  for (const row of rows) {
    const dt = row[CFG.IDX_DATE] instanceof Date ? row[CFG.IDX_DATE] : new Date(row[CFG.IDX_DATE]);
    if (isNaN(dt.getTime())) continue;
    const y = dt.getFullYear();
    if (y < minYear) minYear = y;
    if (y > maxYear) maxYear = y;
  }
  return { minYear: minYear, maxYear: maxYear, curYear: cur.year, curMonth: cur.month };
}
