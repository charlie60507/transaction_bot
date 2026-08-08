// =================== ⚙️ 設定區域 ===================

const CFG = {
  SPREADSHEET_ID: '1PZfUiqaMeUHHSBi8zqEPnEgBfFXqTxKwhnQUltCb8VU',
  DATA_SHEET: 'Transactions',
  TZ: 'Asia/Taipei',

  // Transactions column indices (0-based)
  IDX_POSTED: 0,           // A: 已記帳 (checkbox)
  IDX_BANK: 1,
  IDX_DATE: 2,
  IDX_LAST4: 3,
  IDX_AMOUNT: 4,
  IDX_MERCHANT: 5,
  IDX_CATEGORY_AUTO: 6,    // G: 類別 (auto-parsed from email)
  IDX_LINK: 7,
  IDX_MESSAGEID: 8,        // I: MessageId (stable per-row key)
  IDX_INOUT: 9,            // J: 收支別 ("收入"/"支出"/"轉帳"; blank ⇒ 支出)
  IDX_CATEGORY_MANUAL: 10, // K: 種類(手動) — primary category

  // 我的消費: how much of the charge was actually MY consumption; blank ⇒ all of it.
  // Located by HEADER NAME, never by a fixed index — TAG already lives somewhere past K
  // and hardcoding a position would collide with it. Absent header ⇒ the feature is
  // simply inert and every row reads as "all mine", i.e. exactly today's behaviour.
  HDR_MINE: '我的消費',
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

/**
 * Stable unique identifier for one Transactions row.
 *
 * MessageId alone is NOT unique: a Cathay 消費彙整通知 carries several transactions and the
 * bot stamps the SAME message id on every row it produces (measured: 389 of 1017 rows share
 * an id, 130 groups, the largest 12 rows). Locating a row by message id therefore always hit
 * the FIRST row of the group, so edits to any later row silently landed on the wrong
 * transaction — 259 rows were effectively uneditable.
 *
 * The key composes the fields the UI never edits — message id, timestamp, amount, card last4
 * — plus an occurrence index for rows that are identical even in those. So it survives both
 * an edit and the bot re-sorting the sheet.
 */
function txnKey_(row, occurrence) {
  const dt = row[CFG.IDX_DATE];
  const t = dt instanceof Date ? dt.getTime() : String(dt || '');
  return [String(row[CFG.IDX_MESSAGEID] || ''), t, String(row[CFG.IDX_AMOUNT] || ''),
          String(row[CFG.IDX_LAST4] || ''), String(occurrence || 0)].join('|');
}

/**
 * Row number for a key produced by txnKey_. Falls back to matching on message id alone when
 * given a bare id, so a page loaded before this change still works instead of erroring.
 * Returns -1 when nothing matches.
 */
function findRowByKey_(sh, key) {
  const last = sh.getLastRow();
  if (last <= 1) return -1;
  const rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const parts = String(key).split('|');
  if (parts.length < 5) {
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][CFG.IDX_MESSAGEID]) === String(key)) return i + 2;
    }
    return -1;
  }
  const seen = {};
  for (let i = 0; i < rows.length; i++) {
    const base = txnKey_(rows[i], 0).split('|').slice(0, 4).join('|');
    const n = seen[base] = (seen[base] === undefined ? 0 : seen[base] + 1);
    if (txnKey_(rows[i], n) === String(key)) return i + 2;
  }
  return -1;
}

/** Flat array of ALL transactions for the client-side dashboard.
 *  Fat-frontend: NO aggregation here — the v5 page does all of it. */
function getAllTxns() {
  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  if (!sh || sh.getLastRow() <= 1) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const tagIdx = getTagColIndex_(sh);            // -1 if no TAG header
  const mineIdx = getMineColIndex_(sh);          // -1 if no 我的消費 header
  const out = [];
  const seenKey = {};
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
      // `amount` is MY CONSUMPTION, already netted of anything fronted for other people.
      // Normalising here rather than in the page is deliberate: every one of the dashboard's
      // dozen aggregation sites sums t.amount, so doing it at the source makes them all
      // correct at once instead of relying on twelve edits none of which fail loudly.
      // `charged` keeps the real card amount for display; `mine` is the raw cell so the
      // editor knows whether the row is split at all (null ⇒ not split).
      amount: rowMine_(row, mineIdx),
      charged: Number(row[CFG.IDX_AMOUNT]) || 0,
      mine: (mineIdx === -1 || row[mineIdx] === '' || row[mineIdx] === null || row[mineIdx] === undefined)
        ? null : (isNaN(Number(row[mineIdx])) ? null : Number(row[mineIdx])),
      cat: rowCategory_(row) || '未分類',
      merchant: String(row[CFG.IDX_MERCHANT] || ''),
      tag: tagIdx === -1 ? '' : String(row[tagIdx] || '').trim(),
      bank: String(row[CFG.IDX_BANK] || ''),
      last4: String(row[CFG.IDX_LAST4] || ''),
      link: String(row[CFG.IDX_LINK] || ''),
      // `id` is the composite key, not the bare MessageId — see txnKey_. It still starts
      // with the message id, so the `manual-` prefix checks keep working unchanged.
      id: (function () {
        const base = txnKey_(row, 0).split('|').slice(0, 4).join('|');
        const n = seenKey[base] = (seenKey[base] === undefined ? 0 : seenKey[base] + 1);
        return txnKey_(row, n);
      })(),
      posted: row[CFG.IDX_POSTED] === true
    });
  }
  return out;
}

/**
 * Write edits back to one Transactions row, located by MessageId (col I) so it
 * is safe against the bot re-sorting rows. `patch` may contain any of:
 *   merchant -> F (交易內容/商店; the row title shown in the heatmap day list)
 *   cat    -> K (種類手動; leaves auto G untouched)
 *   type   -> J (收支別; must be 支出/收入/轉帳)
 *   tag    -> TAG column (by header)
 *   mine   -> 我的消費 column (by header); '' or null clears it (⇒ whole charge is mine)
 *   posted -> A (已記帳 checkbox; boolean)
 * Returns { ok:true }; throws a clear error the frontend surfaces.
 */
function updateTxn(messageId, patch) {
  messageId = String(messageId || '');
  if (!messageId) throw new Error('缺少 MessageId');
  patch = patch || {};
  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  if (!sh) throw new Error('找不到 Transactions 工作表');
  const last = sh.getLastRow();
  if (last <= 1) throw new Error('沒有交易資料');

  const rowNum = findRowByKey_(sh, messageId);
  if (rowNum === -1) throw new Error('找不到該筆交易 (key=' + messageId + ')');

  if ('merchant' in patch) {
    sh.getRange(rowNum, CFG.IDX_MERCHANT + 1).setValue(String(patch.merchant || ''));
  }
  if ('cat' in patch) {
    sh.getRange(rowNum, CFG.IDX_CATEGORY_MANUAL + 1).setValue(String(patch.cat || ''));
  }
  if ('type' in patch) {
    const t = String(patch.type || '');
    if (['支出', '收入', '轉帳'].indexOf(t) === -1) throw new Error('收支別不合法: ' + t);
    sh.getRange(rowNum, CFG.IDX_INOUT + 1).setValue(t);
  }
  if ('tag' in patch) {
    const tagIdx = getTagColIndex_(sh);
    if (tagIdx === -1) throw new Error('找不到 TAG 欄');
    sh.getRange(rowNum, tagIdx + 1).setValue(String(patch.tag || ''));
  }
  if ('mine' in patch) {
    const mineIdx = getMineColIndex_(sh);
    if (mineIdx === -1) {
      // Say WHAT was actually in row 1. "column not found" alone sends you hunting between
      // "I typed it wrong", "I put it on the wrong sheet" and "the code is broken", with no
      // way to tell them apart from the dashboard.
      const found = headerRow_(sh).map(function (h) { return '[' + String(h) + ']'; }).join('');
      throw new Error('在「' + CFG.DATA_SHEET + '」第 1 列找不到「' + CFG.HDR_MINE
        + '」欄。目前表頭為 ' + found + ' — 請在最右邊加一格，內容正好是 ' + CFG.HDR_MINE);
    }
    const raw = patch.mine;
    if (raw === '' || raw === null || raw === undefined) {
      sh.getRange(rowNum, mineIdx + 1).setValue('');   // clears the split
    } else {
      const v = Number(raw);
      if (isNaN(v) || v < 0) throw new Error('我的消費需為 0 以上的數字');
      // Deliberately NOT capped at the charge: someone else fronting part of my share
      // makes my consumption legitimately larger than what my card was charged.
      sh.getRange(rowNum, mineIdx + 1).setValue(v);
    }
  }
  if ('posted' in patch) {
    sh.getRange(rowNum, CFG.IDX_POSTED + 1).setValue(!!patch.posted);
  }
  return { ok: true };
}

/**
 * Append a manually-entered transaction (cash / non-email sources). Gets a
 * synthetic `manual-<uuid>` MessageId (col I) so it can be edited/deleted like
 * any row and never collides with the bot's dedup. 已記帳 (A) defaults to true.
 * fields: { date:'YYYY-MM-DD', amount, type, source, merchant, cat, tag }
 * Returns the mapped txn (same shape as getAllTxns) for optimistic UI.
 */
function addTxn(fields) {
  fields = fields || {};
  if (!fields.date) throw new Error('缺少日期');
  const amount = Number(fields.amount);
  if (!amount || amount <= 0) throw new Error('金額需大於 0');
  const type = String(fields.type || '支出');
  if (['支出', '收入', '轉帳'].indexOf(type) === -1) throw new Error('收支別不合法');

  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  if (!sh) throw new Error('找不到 Transactions 工作表');
  const tagIdx = getTagColIndex_(sh);
  const ncol = sh.getLastColumn();
  const id = 'manual-' + Utilities.getUuid();
  const source = String(fields.source || '現金');
  const cat = String(fields.cat || '');
  const dt = new Date(fields.date + 'T12:00:00');

  const row = new Array(ncol).fill('');
  row[CFG.IDX_POSTED] = true;
  row[CFG.IDX_BANK] = source;
  row[CFG.IDX_DATE] = dt;
  row[CFG.IDX_AMOUNT] = amount;
  row[CFG.IDX_MERCHANT] = String(fields.merchant || '');
  row[CFG.IDX_MESSAGEID] = id;
  row[CFG.IDX_INOUT] = type;
  row[CFG.IDX_CATEGORY_MANUAL] = cat;
  if (tagIdx !== -1) row[tagIdx] = String(fields.tag || '');

  // Insert into the date-ordered position rather than appending, so the sheet stays
  // sorted and the new row sits among its own time period.
  const pos = insertPositionForDate_(sh, dt);
  const rowNum = pos.row;
  if (!pos.appending) sh.insertRowBefore(rowNum);
  sh.getRange(rowNum, 1, 1, ncol).setValues([row]);
  sh.getRange(rowNum, CFG.IDX_DATE + 1).setNumberFormat('yyyy/mm/dd hh:mm:ss');
  sh.getRange(rowNum, CFG.IDX_POSTED + 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sh.getRange(rowNum, CFG.IDX_POSTED + 1).setValue(true);

  return {
    y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(),
    // A manually added row is never split on creation — 我的消費 is left blank, so
    // amount === charged and `mine` is null. Split it afterwards by tapping the amount.
    type: type, amount: amount, charged: amount, mine: null, cat: cat || '未分類',
    merchant: String(fields.merchant || ''), tag: String(fields.tag || ''),
    bank: source, last4: '', link: '',
    id: txnKey_(row, 0), posted: true
  };
}

/** Delete a MANUAL row only (id starts with "manual-"), located by MessageId. */
function deleteTxn(messageId) {
  messageId = String(messageId || '');
  if (messageId.indexOf('manual-') !== 0) throw new Error('只能刪除手動新增的交易');
  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  if (!sh) throw new Error('找不到 Transactions 工作表');
  const last = sh.getLastRow();
  if (last <= 1) throw new Error('沒有交易資料');
  const rowNum = findRowByKey_(sh, messageId);
  if (rowNum === -1) throw new Error('找不到該筆手動交易');
  sh.deleteRow(rowNum);
  return { ok: true };
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

/** Map a Transactions row to a transaction-card object (sortKey stripped by caller).
 *  `amount` is my consumption, matching getAllTxns; `charged` keeps the card amount. */
function mapTxn_(row, dt, mineIdx) {
  return {
    date: Utilities.formatDate(dt, CFG.TZ, 'MM/dd HH:mm'),
    sortKey: dt.getTime(),
    bank: String(row[CFG.IDX_BANK] || ''),
    last4: String(row[CFG.IDX_LAST4] || ''),
    amount: rowMine_(row, mineIdx === undefined ? -1 : mineIdx),
    charged: Number(row[CFG.IDX_AMOUNT]) || 0,
    merchant: String(row[CFG.IDX_MERCHANT] || ''),
    link: String(row[CFG.IDX_LINK] || '')
  };
}

/**
 * Category value for a row: 種類(手動) (K) ONLY.
 *
 * 類別 (G) is NOT a category, it is raw parse output from the email, and it deliberately does
 * not reach the display any more. Measured on 1019 live rows: 482 had both columns filled and
 * ZERO of them agreed, because G speaks the bank's vocabulary (超市∕量販, 交通∕運輸,
 * 家電∕３Ｃ通訊) while K speaks the owner's (超市, 交通, 個人) — two taxonomies on one axis.
 * G's single most common value was `註一`, a footnote marker, and five of its values were bare
 * amounts. Falling back to it meant 73 rows displayed bank vocabulary and the category picker
 * offered 24 options where only 10 were ever chosen.
 *
 * Rows with no manual category now read as 未分類, which is visible and fixable in the
 * 待記帳 queue, rather than silently mislabelled. G stays in the sheet as evidence and as the
 * source a future auto-fill suggestion could read.
 */
function rowCategory_(row) {
  return String(row[CFG.IDX_CATEGORY_MANUAL] || '').trim();
}

/** 0-based index of the "TAG" header in Transactions, or -1 if absent */
/**
 * Timestamp of a column-C cell, or NaN when it holds no usable date. Dates normally
 * arrive as Date objects, but a hand-typed cell can come back as a string — both must
 * count, and both callers below must agree on what counts, or the row that bounds the
 * data and the row that decides ordering can disagree about the same cell.
 */
function cellDateTime_(v) {
  if (v instanceof Date) return v.getTime();
  if (v === '' || v === null || v === undefined) return NaN;
  return new Date(v).getTime();
}

/**
 * Last row that holds an actual transaction, i.e. the last row with a real date in
 * column C. Returns 1 (the header) when there is no data.
 *
 * NOT the same as sh.getLastRow(): this sheet carries a long tail of rows whose only
 * content is an unchecked 已記帳 checkbox in column A. A `false` is real cell content,
 * so getLastRow() counts those rows — measured at 788 of them, putting getLastRow() at
 * 1804 while the last transaction sat at row 1016. Appending at getLastRow()+1 therefore
 * stranded a new row ~788 rows below the visible data, where nobody would find it.
 */
function lastDataRow_(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return 1;
  const dates = sh.getRange(2, CFG.IDX_DATE + 1, lastRow - 1, 1).getValues();
  for (let i = dates.length - 1; i >= 0; i--) {
    if (!isNaN(cellDateTime_(dates[i][0]))) return i + 2;
  }
  return 1;
}

/**
 * Where a transaction dated `dt` belongs so the sheet STAYS in the order it is already
 * in. Returns { row, appending }: when appending is false the caller must
 * insertRowBefore(row) to make space; when true, row is one past the last data row.
 *
 * The direction is detected from the data (first vs last date) instead of assuming ASC,
 * because the bot's order comes from the SORT_ORDER script property and may be DESC.
 * An empty or single-date sheet appends, which is correct under either direction.
 */
function insertPositionForDate_(sh, dt) {
  const last = lastDataRow_(sh);
  if (last <= 1) return { row: 2, appending: true };

  const times = sh.getRange(2, CFG.IDX_DATE + 1, last - 1, 1).getValues()
    .map(r => cellDateTime_(r[0]));
  const known = times.filter(t => !isNaN(t));
  if (!known.length) return { row: last + 1, appending: true };

  const descending = known[0] > known[known.length - 1];
  const target = dt.getTime();
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (isNaN(t)) continue;
    // First existing row that should sort AFTER the new one — insert ahead of it.
    if (descending ? t < target : t > target) return { row: i + 2, appending: false };
  }
  return { row: last + 1, appending: true };
}

function getTagColIndex_(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return headers.indexOf('TAG');
}

/**
 * 0-based index of the 我的消費 header in Transactions, or -1 if absent.
 *
 * Matches on the TRIMMED cell, unlike getTagColIndex_'s exact indexOf. This header is typed by
 * hand into the sheet rather than written by the bot, and a trailing space is invisible in the
 * cell but makes an exact match fail — which surfaces only as a write error much later, with
 * nothing on screen to explain it.
 */
function getMineColIndex_(sh) {
  const headers = headerRow_(sh);
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === CFG.HDR_MINE) return i;
  }
  return -1;
}

/** Row 1 of Transactions, as written. */
function headerRow_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

/**
 * How much of a row was MY OWN consumption — the number every statistic must sum.
 *
 * The card was charged 金額 (E); 我的消費 says how much of that was actually mine. A 7,000
 * dinner where 5,000 was fronted for other people is 2,000 of my spending, and counting the
 * full 7,000 is what this column exists to stop.
 *
 * The blank check MUST come before Number(): `Number('') === 0`, so reading the cell first
 * would turn every ordinary un-split row into "none of this was mine" and zero out the
 * entire dashboard. Blank means the whole charge is mine.
 *
 * Not capped at 金額 on purpose. The reverse case is real — someone else fronts part of my
 * share up front — and then my consumption legitimately exceeds what my own card was
 * charged. Only negatives and non-numbers fall back to the charge.
 */
function rowMine_(row, mineIdx) {
  const charged = Number(row[CFG.IDX_AMOUNT]) || 0;
  if (mineIdx === -1) return charged;
  const cell = row[mineIdx];
  if (cell === '' || cell === null || cell === undefined) return charged;
  const v = Number(cell);
  return (isNaN(v) || v < 0) ? charged : v;
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

/** Row-keep predicate: the row must have a value for the active dimension, or it drops out of
 *  every stat. This used to special-case `category` with its own read of 種類(K) because
 *  rowCategory_ fell back to 類別(G) and the two disagreed about which rows counted. Now that
 *  rowCategory_ is manual-only, one predicate covers both dimensions. */
function dimKeepFn_(dimension, k) {
  return function (row) { return k.keyFn(row) !== ''; };
}

/** Period KPIs over in-scope rows. `keep` (optional) filters which rows count.
 *  Totals are my consumption, not the card amount — see rowMine_. */
function periodSummary_(rows, r, keep, mineIdx) {
  let total = 0, count = 0, largest = null, minT = null, maxT = null;
  for (const row of rows) {
    if (keep && !keep(row)) continue;
    const dt = inScope_(row, r.useMonth, r.ym);
    if (!dt) continue;
    const amt = rowMine_(row, mineIdx === undefined ? -1 : mineIdx);
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
function monthlyTrend_(rows, n, keep, mineIdx) {
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
    if (key in totals) totals[key] += rowMine_(row, mineIdx === undefined ? -1 : mineIdx);
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

  const mineIdx = getMineColIndex_(sh);
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const map = {};
  for (const row of rows) {
    if (!keep(row)) continue;
    if (!inScope_(row, r.useMonth, r.ym)) continue;
    const key = k.keyFn(row);
    if (!key) continue;
    if (!map[key]) map[key] = { total: 0, count: 0 };
    map[key].total += rowMine_(row, mineIdx);
    map[key].count += 1;
  }
  const items = Object.keys(map)
    .map(function (x) { return { name: x, total: map[x].total, count: map[x].count }; })
    .sort(function (a, b) { return b.total - a.total; });

  return {
    dimension: dimension, scope: scope,
    items: items,
    grandTotal: items.reduce(function (s, it) { return s + it.total; }, 0),
    period: periodSummary_(rows, r, keep, mineIdx),
    trend: monthlyTrend_(rows, 6, keep, mineIdx)
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
  const mineIdx = getMineColIndex_(sh);
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const results = [];
  for (const row of rows) {
    if (!keep(row)) continue;
    if (k.keyFn(row) !== name) continue;
    const dt = inScope_(row, r.useMonth, r.ym);
    if (!dt) continue;
    results.push(mapTxn_(row, dt, mineIdx));
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
