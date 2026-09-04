// =================== ⚙️ 設定區域 ===================

// Keep the project loadable before Script Properties are configured. Setup uses
// setScriptProperties(), which must be callable in a fresh Apps Script project.
// User-facing and mutating entry points call requireEnvironmentConfig_() before
// using these values.
const ENV_CONFIG = loadEnvironmentConfig_(true);
const CFG = {
  SPREADSHEET_ID: ENV_CONFIG.spreadsheetId,
  DATA_SHEET: ENV_CONFIG.sheetName,
  // Load-bearing, not an archive: the bot treats these rows as already-seen so a
  // deleted auto-record does not come back on the next 7-day scan. Deleting the
  // tab resurrects anything still inside that window.
  DELETED_SHEET: ENV_CONFIG.deletedSheetName,
  TZ: ENV_CONFIG.tz,
  ENVIRONMENT: ENV_CONFIG.environment,

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

/** Web App entry: serve the dashboard page (injects real NOW in sheet TZ + sheet URL). */
function doGet(e) {
  requireEnvironmentConfig_();
  const t = HtmlService.createTemplateFromFile('ToolPanel');
  t.now = nowYMD_();
  t.sheetUrl = getSpreadsheet_().getUrl();
  t.environmentName = ENV_CONFIG.environment;
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
 * Normalize a composite key as it arrives from google.script.run.
 *
 * The id is `messageId|timestamp|amount|last4|occurrence`. A single string
 * argument containing `|` can arrive as an Array (one element per segment);
 * `String(array)` then comma-joins, matching nothing and throwing 找不到.
 * updateTxn never hits this because it already passes (id, patch) — two
 * arguments. Reconstruct with `|` if we got an Array; unwrap `{id}` if the
 * page sent an object.
 */
function asTxnKey_(key) {
  if (Array.isArray(key)) return key.map(function (p) { return String(p); }).join('|');
  if (key && typeof key === 'object' && key.id != null) return asTxnKey_(key.id);
  return String(key == null ? '' : key);
}

/** Same skip getAllTxns uses: blank / unparseable dates are not transactions.
 *  findRowByKey_ must skip them too, or occurrence numbers disagree — this sheet
 *  has hundreds of trailing rows whose only content is an unchecked checkbox. */
function isDisplayedTxn_(row) {
  const raw = row[CFG.IDX_DATE];
  const dt = raw instanceof Date ? raw : new Date(raw);
  return !isNaN(dt.getTime());
}

/**
 * Row number for a key produced by txnKey_. Falls back to matching on message id alone when
 * given a bare id, so a page loaded before this change still works instead of erroring.
 * Returns -1 when nothing matches.
 */
function findRowByKey_(sh, key) {
  key = asTxnKey_(key);
  const last = sh.getLastRow();
  if (last <= 1) return -1;
  const rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const parts = key.split('|');
  if (parts.length < 5) {
    for (let i = 0; i < rows.length; i++) {
      if (!isDisplayedTxn_(rows[i])) continue;
      if (String(rows[i][CFG.IDX_MESSAGEID]) === key) return i + 2;
    }
    return -1;
  }
  const seen = {};
  for (let i = 0; i < rows.length; i++) {
    if (!isDisplayedTxn_(rows[i])) continue;
    const base = txnKey_(rows[i], 0).split('|').slice(0, 4).join('|');
    const n = seen[base] = (seen[base] === undefined ? 0 : seen[base] + 1);
    if (txnKey_(rows[i], n) === key) return i + 2;
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
      // Preformatted 'HH:mm' rather than a timestamp: the page holds no timezone knowledge
      // (its only clock is NOW, injected by doGet as already-localised numbers), and
      // lexicographic order on 'HH:mm' IS chronological order with '' sorting first — which
      // is exactly where a row with no known time belongs. See rowHM_ for what "no time" means.
      hm: rowHM_(dt),
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
 *   amount -> displayed amount: 我的消費 for split rows, 金額 for non-split rows
 *   posted -> A (已記帳 checkbox; boolean)
 * Returns { ok:true }; throws a clear error the frontend surfaces.
 */
function updateTxn(messageId, patch) {
  messageId = asTxnKey_(messageId);
  if (!messageId) throw new Error('缺少 MessageId');
  patch = patch || {};
  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  if (!sh) throw new Error('找不到 Transactions 工作表');
  const last = sh.getLastRow();
  if (last <= 1) throw new Error('沒有交易資料');

  const rowNum = findRowByKey_(sh, messageId);
  if (rowNum === -1) throw new Error('找不到該筆交易 (key=' + messageId + ')');

  if ('amount' in patch) {
    const amount = Number(patch.amount);
    if (!isFinite(amount) || amount <= 0) throw new Error('金額需大於 0');
    // Amount correction is intentionally scoped to expense rows. Income and transfer
    // rows retain their existing editor contract and must not gain a charged-amount write.
    const rowType = String(sh.getRange(rowNum, CFG.IDX_INOUT + 1).getValue() || '支出');
    if (rowType !== '支出') throw new Error('只有支出交易可以修正金額');
  }

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
  if ('amount' in patch) {
    // The dashboard's displayed amount is `我的消費` for split rows and `金額` for
    // ordinary rows. Keep the charged amount untouched when correcting only a split
    // row's displayed consumption.
    const mineIdx = getMineColIndex_(sh);
    const currentMine = mineIdx === -1 ? '' : sh.getRange(rowNum, mineIdx + 1).getValue();
    const amountIdx = mineIdx !== -1 && currentMine !== '' && currentMine !== null && currentMine !== undefined
      ? mineIdx : CFG.IDX_AMOUNT;
    sh.getRange(rowNum, amountIdx + 1).setValue(Number(patch.amount));
  }
  if ('mine' in patch) {
    const mineIdx = ensureMineColIndex_(sh);
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
 * fields: { date:'YYYY-MM-DD', time:'HH:mm'|'', amount, type, source, merchant, cat, tag }
 * `time` is optional — cash is often recorded without caring what time it was. Returns the
 * mapped txn (same shape as getAllTxns) for optimistic UI.
 */
function addTxn(fields) {
  fields = fields || {};
  if (!fields.date) throw new Error('缺少日期');
  const time = String(fields.time || '').trim();
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('時間格式需為 HH:mm');
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
  // No time given ⇒ midnight, which the dashboard reads back as "no time" (rowHM_) and which
  // sorts first in its day, exactly like the legacy date-only rows. This replaces a hardcoded
  // 12:00:00, a fabricated value that wedged every manual entry into the middle of the day's
  // chronological order. Defaulting to "now" would be worse still: cash is typically recorded
  // hours after the fact, so "now" is a plausible-looking lie and harder to spot than a blank.
  const dt = new Date(fields.date + 'T' + (time || '00:00') + ':00');

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
  // The format follows the value: a date-only row must not display 00:00:00 in the sheet —
  // that is the same lie the dashboard refuses to tell, told in the other app instead. Display
  // only; nothing ever reads this format back to decide whether a row has a time.
  sh.getRange(rowNum, CFG.IDX_DATE + 1)
    .setNumberFormat(time ? 'yyyy/mm/dd hh:mm:ss' : 'yyyy/mm/dd');
  sh.getRange(rowNum, CFG.IDX_POSTED + 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sh.getRange(rowNum, CFG.IDX_POSTED + 1).setValue(true);

  return {
    y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(),
    // Derived exactly as getAllTxns will derive it on the next load, so the optimistic row
    // sits in its final chronological position instead of jumping when the real row arrives.
    hm: rowHM_(dt),
    // A manually added row is never split on creation — 我的消費 is left blank, so
    // amount === charged and `mine` is null. Split it afterwards by tapping the amount.
    type: type, amount: amount, charged: amount, mine: null, cat: cat || '未分類',
    merchant: String(fields.merchant || ''), tag: String(fields.tag || ''),
    bank: source, last4: '', link: '',
    id: txnKey_(row, 0), posted: true
  };
}

/**
 * Deleted sheet: create on first use, copying Transactions headers. If it already
 * exists but is narrower than the source (Transactions later gained a column), copy
 * only the extra header cells so a human note on Deleted is not overwritten.
 */
function getOrCreateDeleted_(ss, src) {
  let del = ss.getSheetByName(CFG.DELETED_SHEET);
  const srcCols = Math.max(src.getLastColumn(), 1);
  if (!del) {
    del = ss.insertSheet(CFG.DELETED_SHEET);
    del.getRange(1, 1, 1, srcCols).setValues(src.getRange(1, 1, 1, srcCols).getValues());
    return del;
  }
  if (del.getLastRow() === 0) {
    del.getRange(1, 1, 1, srcCols).setValues(src.getRange(1, 1, 1, srcCols).getValues());
    return del;
  }
  const have = del.getLastColumn();
  if (have < srcCols) {
    del.getRange(1, have + 1, 1, srcCols - have)
      .setValues(src.getRange(1, have + 1, 1, srcCols - have).getValues());
  }
  return del;
}

/** Delete any row, located by the composite key. Moves it to Deleted first so the
 *  bot still treats the mail as already handled (the sheet is its only memory).
 *
 *  Returns `{ ok, txns }` so the page does not need a nested getAllTxns. Nesting
 *  google.script.run after a successful write was the false 找不到 toast: the
 *  row was already gone, then a second lookup (retry or refresh) failed. */
function deleteTxn(messageId) {
  messageId = asTxnKey_(messageId);
  const lock = LockService.getScriptLock();
  lock.waitLock(15 * 1000);
  try {
    const ss = getSpreadsheet_();
    const sh = ss.getSheetByName(CFG.DATA_SHEET);
    if (!sh) throw new Error('找不到 Transactions 工作表');
    const last = sh.getLastRow();
    if (last <= 1) throw new Error('沒有交易資料');
    const rowNum = findRowByKey_(sh, messageId);
    if (rowNum === -1) {
      // Already moved (double-tap / retry after a successful write). Do not
      // throw 找不到 — the sheet is in the state the owner asked for.
      const del = ss.getSheetByName(CFG.DELETED_SHEET);
      if (del && sheetHasBaseKey_(del, messageId)) {
        SpreadsheetApp.flush();
        return { ok: true, txns: getAllTxns() };
      }
      throw new Error('找不到該筆交易 (key=' + messageId + ')');
    }
    const cols = sh.getLastColumn();
    const row = sh.getRange(rowNum, 1, 1, cols).getValues()[0];
    const destSheet = getOrCreateDeleted_(ss, sh);
    const dest = Math.max(destSheet.getLastRow() + 1, 2);
    destSheet.getRange(dest, 1, 1, cols).setValues([row]);
    sh.deleteRow(rowNum);
    SpreadsheetApp.flush();
    return { ok: true, txns: getAllTxns() };
  } finally {
    lock.releaseLock();
  }
}

/** True if Deleted already holds a row with the same base key (id without occurrence). */
function sheetHasBaseKey_(sh, key) {
  if (!sh || sh.getLastRow() <= 1) return false;
  const parts = asTxnKey_(key).split('|');
  if (parts.length < 4) return false;
  const want = parts.slice(0, 4).join('|');
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (!isDisplayedTxn_(rows[i])) continue;
    const base = txnKey_(rows[i], 0).split('|').slice(0, 4).join('|');
    if (base === want) return true;
  }
  return false;
}

/** Web App URL for this project's configured deployment. */
function getWebAppUrl() {
  const config = requireEnvironmentConfig_();
  return 'https://script.google.com/macros/s/' + encodeURIComponent(config.deploymentId) + '/exec';
}

/**
 * Resolve the complete runtime boundary from Script Properties. Each Apps Script
 * project has its own copy of these properties; the script id check prevents a
 * copied configuration from silently targeting the other project.
 */
function loadEnvironmentConfig_(allowUnconfigured) {
  const props = PropertiesService.getScriptProperties().getProperties();
  try {
    return resolveEnvironmentConfig_(props, ScriptApp.getScriptId());
  } catch (err) {
    if (!allowUnconfigured) throw err;
    return {
      environment: 'UNCONFIGURED',
      spreadsheetId: '',
      scriptId: '',
      deploymentId: '',
      tz: 'Asia/Taipei',
      sheetName: 'Transactions',
      deletedSheetName: 'Deleted'
    };
  }
}

function requireEnvironmentConfig_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  return resolveEnvironmentConfig_(props, ScriptApp.getScriptId());
}

function resolveEnvironmentConfig_(props, actualScriptId) {
  props = props || {};
  const environment = String(props.ENVIRONMENT || '').trim().toUpperCase();
  const spreadsheetId = String(props.SPREADSHEET_ID || '').trim();
  const scriptId = String(props.SCRIPT_ID || '').trim();
  const deploymentId = String(props.DEPLOYMENT_ID || '').trim();
  if (!environment || ['STAGE', 'PRODUCTION'].indexOf(environment) === -1) {
    throw new Error('Missing or invalid required config: ENVIRONMENT (STAGE or PRODUCTION)');
  }
  if (!spreadsheetId || !scriptId || !deploymentId) {
    throw new Error('Missing required environment config: SCRIPT_ID, SPREADSHEET_ID, DEPLOYMENT_ID');
  }
  if (actualScriptId && scriptId !== String(actualScriptId)) {
    throw new Error('Environment SCRIPT_ID does not match this Apps Script project');
  }
  if (environment === 'STAGE') {
    const missingProductionFences = ['PRODUCTION_SCRIPT_ID', 'PRODUCTION_SPREADSHEET_ID', 'PRODUCTION_DEPLOYMENT_ID']
      .filter(function (key) { return !String(props[key] || '').trim(); });
    if (missingProductionFences.length > 0) {
      throw new Error('Stage requires Production fence properties: ' + missingProductionFences.join(', '));
    }
    if (props.PRODUCTION_SCRIPT_ID && scriptId === String(props.PRODUCTION_SCRIPT_ID).trim()) {
      throw new Error('Stage SCRIPT_ID must not be the Production Apps Script project');
    }
    if (props.PRODUCTION_SPREADSHEET_ID && spreadsheetId === String(props.PRODUCTION_SPREADSHEET_ID).trim()) {
      throw new Error('Stage SPREADSHEET_ID must not be the Production spreadsheet');
    }
    if (props.PRODUCTION_DEPLOYMENT_ID && deploymentId === String(props.PRODUCTION_DEPLOYMENT_ID).trim()) {
      throw new Error('Stage DEPLOYMENT_ID must not be the Production deployment');
    }
  }
  return {
    environment,
    spreadsheetId,
    scriptId,
    deploymentId,
    tz: String(props.TZ || 'Asia/Taipei'),
    sheetName: String(props.SHEET_NAME || 'Transactions'),
    deletedSheetName: String(props.DELETED_SHEET || 'Deleted')
  };
}

/** Safe, synthetic-only reset for the isolated Stage project. */
function resetStageData() {
  requireEnvironmentConfig_();
  if (ENV_CONFIG.environment !== 'STAGE') throw new Error('resetStageData is available only in STAGE');
  const ss = getSpreadsheet_();
  const transactionHeader = [
    '已記帳', '銀行', '授權日期時間', '卡末四碼', '金額_NTD',
    '交易內容/商店', '類別', 'Gmail連結', 'MessageId', '收支別', '種類(手動)'
  ];
  const data = getOrCreateStageSheet_(ss, CFG.DATA_SHEET, transactionHeader);
  const deleted = getOrCreateStageSheet_(ss, CFG.DELETED_SHEET, transactionHeader);
  clearStageRows_(data);
  clearStageRows_(deleted);
  const meta = getOrCreateStageSheet_(ss, 'META', ['Key', 'Value']);
  clearStageRows_(meta);
  meta.getRange(2, 1, 2, 2).setValues([
    ['ENVIRONMENT', 'STAGE'],
    ['SEEDED_BY', 'resetStageData']
  ]);
  data.getRange(2, 1, 1, 11).setValues([[
    false, 'TEST', new Date(2026, 0, 15, 12, 0, 0), '0000', 100,
    'Synthetic Stage fixture', '測試', '', 'stage-fixture-001', '支出', '測試'
  ]]);
  return getEnvironmentInfo();
}

function getOrCreateStageSheet_(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const current = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), header.length)).getValues()[0]
    : [];
  const normalized = current.slice(0, header.length);
  if (current.length !== header.length || normalized.some(function (value, index) {
    return String(value || '') !== String(header[index]);
  })) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  }
  return sh;
}

function clearStageRows_(sh) {
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getMaxColumns()).clearContent();
}

function getEnvironmentInfo() {
  const config = requireEnvironmentConfig_();
  return {
    environment: config.environment,
    spreadsheetId: config.spreadsheetId,
    spreadsheetUrl: getSpreadsheet_().getUrl(),
    scriptId: config.scriptId,
    deploymentId: config.deploymentId
  };
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
  return SpreadsheetApp.openById(requireEnvironmentConfig_().spreadsheetId);
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
 * Time of day of a column-C cell as 'HH:mm', or '' when the cell carries no time.
 *
 * '00:00:00' deliberately counts as NO time: a date-only cell and a midnight datetime come
 * back as the identical Date, so no value-based test can separate them. Consulting the
 * cell's number format instead was rejected — it is a display attribute (one careless
 * "format cells" over column C would make every legacy date-only row claim a time), and the
 * bot already sets 'yyyy/mm/dd hh:mm:ss' on every block it appends, including the rows whose
 * 授權時間 it could not parse and filled with 00:00:00. So the format is neither reliable nor
 * faithful. The accepted cost is a charge authorised at exactly 00:00 showing no time — about
 * one row every two and a half years, and it still sorts first, which is where midnight belongs.
 *
 * The midnight test goes through CFG.TZ, never dt.getHours(): the script's timezone and the
 * sheet's CFG.TZ are separate settings, so testing in one zone while formatting in the other
 * could classify a row as timeless while it displays 08:00. One formatted read decides both.
 */
function rowHM_(dt) {
  const hms = Utilities.formatDate(dt, CFG.TZ, 'HH:mm:ss');
  return hms === '00:00:00' ? '' : hms.slice(0, 5);
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
 * Index of the 我的消費 column, CREATING the header if it is not there yet.
 *
 * Asking the owner to add the header by hand was a mistake: it is a silent prerequisite that
 * fails much later, at write time, in a completely different part of the UI. Measured cost of
 * that design — two rounds of "寫入失敗" against a sheet whose row 1 ended at L[TAG] with no
 * 我的消費 anywhere.
 *
 * Creating it is safe and purely additive: the header goes one past the last column that holds
 * anything, so it cannot overwrite data and cannot shift the A–K positions that the fixed
 * column indices in CFG read by position. Only the WRITE path calls this — reads stay
 * non-mutating via getMineColIndex_, so merely opening the dashboard never changes the sheet.
 */
function ensureMineColIndex_(sh) {
  const idx = getMineColIndex_(sh);
  if (idx !== -1) return idx;
  const col = sh.getLastColumn() + 1;
  sh.getRange(1, col).setValue(CFG.HDR_MINE);
  return col - 1;
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
