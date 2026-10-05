'use strict';
// The LINE facade (sidebar/line_ledger.js) must write and delete rows through the dashboard's
// own code, so a LINE row is indistinguishable from a manual row. These checks pin that:
//   - ledgerAdd produces the same cells, formats, checkbox and insert position as addTxn;
//   - ledgerAdd takes the script lock ONCE for N rows and validates before the first write;
//   - ledgerUndo follows deleteTxn (copy to Deleted, then delete) and reports
//     'deleted' / 'already-deleted' / 'missing' where the dashboard returns ok / ok / throws;
//   - the server-only `held` argument cannot be satisfied by anything the client can send;
//   - the account list, categories and the fail-closed parse behave as the note specifies.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./extract_panel');

const SERVER = path.resolve(__dirname, '..', 'sidebar', '程式碼.js');
const BOT = path.resolve(__dirname, '..', 'sidebar', 'cards_transaction_bot.js');
const FACADE = path.resolve(__dirname, '..', 'sidebar', 'line_ledger.js');
const HEADERS = [
  '已記帳', '銀行', '授權日期時間', '卡末四碼', '金額_NTD', '交易內容/商店', '類別',
  'Gmail連結', 'MessageId', '收支別', '種類(手動)', '我的消費', '交易 ID'
];
const CFG = {
  SPREADSHEET_ID: 'fixture-sheet', DATA_SHEET: 'Transactions', DELETED_SHEET: 'Deleted', META_SHEET: 'META',
  META_ACCOUNT_COL: 7, META_ACCOUNT_HEADER: '帳戶清單',
  TZ: 'Asia/Taipei', IDX_POSTED: 0, IDX_BANK: 1, IDX_DATE: 2, IDX_LAST4: 3,
  IDX_AMOUNT: 4, IDX_MERCHANT: 5, IDX_CATEGORY_AUTO: 6, IDX_LINK: 7,
  IDX_MESSAGEID: 8, IDX_INOUT: 9, IDX_CATEGORY_MANUAL: 10, HDR_MINE: '我的消費', HDR_ROW_ID: '交易 ID'
};

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet; this.row = row; this.col = col;
    this.numRows = numRows == null ? 1 : numRows;
    this.numCols = numCols == null ? 1 : numCols;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const source = this.sheet.rows[this.row - 1 + r] || [];
      const row = [];
      for (let c = 0; c < this.numCols; c++) row.push(source[this.col - 1 + c] == null ? '' : source[this.col - 1 + c]);
      out.push(row);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(values) {
    assert.strictEqual(values.length, this.numRows, 'setValues row count matches its range');
    values.forEach((line, r) => {
      assert.strictEqual(line.length, this.numCols, 'setValues column count matches its range');
      const target = this.sheet.ensureRow(this.row - 1 + r);
      line.forEach((v, c) => { target[this.col - 1 + c] = v; });
    });
    this.sheet.log.push(['setValues', this.row, this.col, this.numRows, this.numCols]);
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat(fmt) { this.sheet.log.push(['format', this.row, this.col, fmt]); return this; }
  setDataValidation() { this.sheet.log.push(['checkbox', this.row, this.col]); return this; }
}

class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows.map(r => r.slice()); this.log = []; }
  ensureRow(i) { while (this.rows.length <= i) this.rows.push([]); return this.rows[i]; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getRange(row, col, numRows, numCols) { return new Range(this, row, col, numRows, numCols); }
  insertRowBefore(row) { this.rows.splice(row - 1, 0, []); this.log.push(['insertBefore', row]); }
  deleteRow(row) { this.rows.splice(row - 1, 1); this.log.push(['delete', row]); }
}

class Spreadsheet {
  constructor(sheets) { this.sheets = {}; sheets.forEach(s => { this.sheets[s.name] = s; }); }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { const s = new Sheet(n, []); this.sheets[n] = s; return s; }
}

function formatDate(date, tz, fmt) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const parts = {
    yyyy: String(shifted.getUTCFullYear()), MM: String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    M: String(shifted.getUTCMonth() + 1), dd: String(shifted.getUTCDate()).padStart(2, '0'), d: String(shifted.getUTCDate()),
    HH: String(shifted.getUTCHours()).padStart(2, '0'), mm: String(shifted.getUTCMinutes()).padStart(2, '0'),
    ss: String(shifted.getUTCSeconds()).padStart(2, '0')
  };
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss|M|d/g, t => parts[t]);
}

const SERVER_FNS = [
  'txnKey_', 'asTxnKey_', 'isDisplayedTxn_', 'getRowIdColIndex_', 'ensureRowIdColIndex_', 'findRowByKey_',
  'getAllTxns', 'txnsFromRows_', 'txnFromRow_', 'nextOccurrence_', 'rowYmdt_', 'txnSnapshot_', 'snapshotOfRows_',
  'recentSince_', 'rowDays_', 'olderFingerprint_', 'fingerprintCell_', 'addTxn', 'getOrCreateDeleted_', 'deleteTxn',
  'sheetHasRowId_', 'sheetHasBaseKey_', 'getSpreadsheet_', 'rowCategory_', 'cellDateTime_', 'rowHM_', 'hmFromHms_',
  'lastDataRow_', 'insertPositionForDate_', 'getMineColIndex_', 'headerRow_', 'rowMine_', 'ymdtFormatter_',
  'tzOffsetAt_', 'ymdtOnSide_', 'rowIdColIndexIn_', 'mineColIndexIn_', 'getAccountSources_'
];
const BOT_FNS = ['loadCategoryRules_', 'loadValidCategories_', 'matchCategory_', 'classifyWithGemini_'];

function load(spreadsheet, opts) {
  opts = opts || {};
  let uuidSeq = 0;
  const locks = { wait: 0, release: 0 };
  const sandbox = {
    console: { log: m => (opts.logs || []).push(String(m)), error: m => (opts.logs || []).push(String(m)) },
    Date, CFG, Set, Map, Object, JSON, Array, String, Number,
    CONFIG: { geminiApiKey: opts.noKey ? '' : 'FIXTURE_GEMINI_KEY' },
    SpreadsheetApp: {
      openById: () => spreadsheet, flush: () => {},
      newDataValidation: () => ({ requireCheckbox() { return this; }, build: () => ({}) })
    },
    LockService: { getScriptLock: () => ({ waitLock: () => { locks.wait++; return true; }, releaseLock: () => { locks.release++; } }) },
    Utilities: { formatDate, getUuid: () => 'uuid-' + (++uuidSeq) },
    UrlFetchApp: { fetch: opts.fetch || (() => { throw new Error('no network in this fixture'); }) }
  };
  vm.createContext(sandbox);
  const server = fs.readFileSync(SERVER, 'utf8');
  const bot = fs.readFileSync(BOT, 'utf8');
  vm.runInContext(SERVER_FNS.map(n => extractFunction(server, n)).join('\n'), sandbox);
  vm.runInContext(BOT_FNS.map(n => extractFunction(bot, n)).join('\n'), sandbox);
  vm.runInContext(fs.readFileSync(FACADE, 'utf8'), sandbox, { filename: FACADE });
  sandbox.locks = locks;
  return sandbox;
}

const D = (iso) => new Date(iso);
function txnRows() {
  return [
    HEADERS,
    [true, '富邦', D('2026-10-01T02:00:00Z'), '1234', 300, '超市', '', '', 'mail-1', '支出', '超市', '', 'id-a'],
    [true, '現金', D('2026-10-03T04:00:00Z'), '', 80, '早餐', '', '', 'manual-x', '支出', '飲食', '', 'id-b'],
    [true, '國泰', D('2026-10-06T04:00:00Z'), '9999', 500, '晚餐', '', '', 'mail-2', '支出', '', '', 'id-c'],
    [false]   // the trailing checkbox-only rows the live sheet carries
  ];
}
function meta() {
  return new Sheet('META', [
    ['交易關鍵字', '種類', '收支', '種類清單', '', '', '帳戶清單'],
    ['拉麵', '飲食', '', '飲食', '', '', '中信'],
    ['計程', '交通', '', '交通', '', '', 'CASH'],
    ['拉麵店', '不在清單', '', '超市', '', '', '']
  ]);
}
function book() {
  return new Spreadsheet([new Sheet('Transactions', txnRows()), new Sheet('Deleted', [HEADERS]), meta()]);
}
function plain(x) { return JSON.parse(JSON.stringify(x)); }

function run() {
  // ---- addTxn / ledgerAdd parity -----------------------------------------
  [
    { date: '2026-10-05', time: '', amount: 180, type: '支出', merchant: '拉麵', cat: '飲食', account: '中信' },
    { date: '2026-10-05', time: '12:30', amount: 52000, type: '收入', merchant: '薪水', cat: '', account: '現金' },
    { date: '2026-10-09', time: '', amount: 250, type: '轉帳', merchant: '轉帳', cat: '', account: '富邦' }
  ].forEach(entry => {
    const a = book(), b = book();
    const dash = load(a), line = load(b);
    const r1 = dash.addTxn({ date: entry.date, time: entry.time, amount: entry.amount, type: entry.type,
      source: entry.account, merchant: entry.merchant, cat: entry.cat });
    const r2 = line.ledgerAdd([entry]);
    const ta = a.getSheetByName('Transactions'), tb = b.getSheetByName('Transactions');
    assert.deepStrictEqual(plain(tb.rows), plain(ta.rows), 'LINE row cells and position equal the dashboard row: ' + entry.merchant);
    assert.deepStrictEqual(tb.log, ta.log, 'same insert, number format, checkbox and write calls: ' + entry.merchant);
    assert.strictEqual(r2.length, 1);
    assert.strictEqual(r2[0].rowId, r1.rowId);
    assert.strictEqual(r2[0].bank, entry.account);
    assert.strictEqual(r2[0].cat, entry.cat || '未分類');
    const written = tb.rows.find(r => r[12] === r1.rowId);
    assert.ok(/^manual-/.test(written[8]), 'MessageId is manual-<uuid>');
    assert.strictEqual(written[0], true, '已記帳 ticked');
    assert.strictEqual(written[11], '', '我的消費 left empty');
    const fmt = tb.log.find(l => l[0] === 'format');
    assert.strictEqual(fmt[3], entry.time ? 'yyyy/mm/dd hh:mm:ss' : 'yyyy/mm/dd', 'no-time rows use the date-only format');
    assert.ok(tb.log.some(l => l[0] === 'checkbox' && l[1] === fmt[1]), 'checkbox validation on the new row');
    assert.strictEqual(dash.locks.wait, 1, 'addTxn takes the lock itself');
    assert.strictEqual(line.locks.wait, 1, 'ledgerAdd takes the lock once');
  });
  // The written row lands in date order (2026-10-05 sits between 10-03 and 10-06).
  {
    const b = book(); const line = load(b);
    line.ledgerAdd([{ date: '2026-10-05', time: '', amount: 180, type: '支出', merchant: '拉麵', cat: '飲食', account: '中信' }]);
    assert.strictEqual(b.getSheetByName('Transactions').rows[3][5], '拉麵', 'inserted ahead of the first later row');
  }

  // ---- N entries: one lock, all-or-nothing validation --------------------
  {
    const b = book(); const line = load(b);
    const out = line.ledgerAdd([
      { date: '2026-10-05', time: '', amount: 180, type: '支出', merchant: '午餐', cat: '', account: '現金' },
      { date: '2026-10-05', time: '', amount: 250, type: '支出', merchant: '晚餐', cat: '', account: '現金' }
    ]);
    assert.strictEqual(out.length, 2);
    assert.notStrictEqual(out[0].rowId, out[1].rowId);
    assert.strictEqual(line.locks.wait, 1, 'one lock for both rows');
    assert.strictEqual(line.locks.release, 1);
    const before = plain(b.getSheetByName('Transactions').rows);
    assert.throws(() => line.ledgerAdd([
      { date: '2026-10-05', time: '', amount: 1, type: '支出', merchant: 'ok', cat: '', account: '現金' },
      { date: '2026-10-05', time: '', amount: 0, type: '支出', merchant: 'bad', cat: '', account: '現金' }
    ]), /第 2 筆/);
    assert.throws(() => line.ledgerAdd([{ date: '10/5', amount: 1, account: '現金' }]), /日期/);
    assert.throws(() => line.ledgerAdd([{ date: '2026-10-05', amount: 1, type: '借貸', account: '現金' }]), /收支別/);
    assert.throws(() => line.ledgerAdd([{ date: '2026-10-05', amount: 1, account: '' }]), /帳戶/);
    assert.deepStrictEqual(plain(b.getSheetByName('Transactions').rows), before, 'a bad entry writes nothing');
  }

  // ---- held cannot come from the client ----------------------------------
  {
    const b = book(); const line = load(b);
    assert.throws(() => line.addTxn({ date: '2026-10-05', amount: 1 }, { sh: { any: 1 } }), /held/);
    assert.throws(() => line.deleteTxn('id-a', { ss: {}, sh: {} }), /held/);
    assert.strictEqual(line.locks.wait, 0, 'a rejected held never reaches the sheet');
  }

  // ---- deleteTxn / ledgerUndo parity -------------------------------------
  {
    const a = book(), b = book();
    const dash = load(a), line = load(b);
    const res = dash.deleteTxn('id-b');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(line.ledgerUndo('id-b'), 'deleted');
    assert.deepStrictEqual(plain(b.getSheetByName('Transactions').rows), plain(a.getSheetByName('Transactions').rows), 'same row removed');
    assert.deepStrictEqual(plain(b.getSheetByName('Deleted').rows), plain(a.getSheetByName('Deleted').rows), 'same row copied to Deleted');
    assert.strictEqual(b.getSheetByName('Deleted').rows[1][12], 'id-b');
    // already in Deleted: dashboard stays idempotent, LINE reports it.
    assert.strictEqual(dash.deleteTxn('id-b').ok, true);
    assert.strictEqual(line.ledgerUndo('id-b'), 'already-deleted');
    // never existed: dashboard throws as before, LINE reports missing.
    assert.throws(() => dash.deleteTxn('id-zzz'), /找不到該筆交易/);
    assert.strictEqual(line.ledgerUndo('id-zzz'), 'missing');
    assert.strictEqual(line.ledgerUndo(''), 'missing');
    assert.strictEqual(b.getSheetByName('Deleted').rows.length, 2, 'repeated undo copies nothing twice');
  }

  // ---- account list: META!G first, then the picker's distinctBanks order ---
  {
    const line = load(book());
    // Banks: 現金 has a manual row → first among banks; then 富邦/國泰 by count, tie → first seen.
    assert.deepStrictEqual(plain(line.ledgerContext().accounts), ['中信', 'CASH', '現金', '富邦', '國泰']);
    const b = book();
    b.getSheetByName('Transactions').rows.push([true, 'cash', D('2026-10-07T04:00:00Z'), '', 1, 'x', '', '', 'manual-y', '支出', '', '', 'id-d']);
    assert.ok(load(b).ledgerContext().accounts.indexOf('cash') === -1, 'case-insensitive de-duplication against META!G');
    const ctx = load(book()).ledgerContext();
    assert.deepStrictEqual(plain(ctx.categories), ['飲食', '交通', '超市']);
    assert.strictEqual(ctx.rules[0].keyword, '拉麵店', 'rules longest keyword first');
  }

  // ---- categories: rules first, then Gemini, restricted to META!D, no write-back
  {
    const b = book();
    const metaBefore = plain(b.getSheetByName('META').rows);
    const asked = [];
    const line = load(b, {
      fetch: (url, req) => {
        asked.push(JSON.parse(req.payload).contents[0].parts[0].text);
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"全聯": "超市", "神秘": "不存在"}' }] } }] }) };
      }
    });
    const cats = line.ledgerCategorize(['計程車', '拉麵店 本店', '全聯', '神秘']);
    // 拉麵店 matches the longest rule first, whose category is not in META!D → Gemini decides.
    assert.deepStrictEqual(plain(cats), ['交通', '', '超市', '']);
    assert.strictEqual(asked.length, 1, 'one Gemini call for everything the rules missed');
    assert.ok(!/計程車/.test(asked[0].split('商店列表')[1]), 'rule-matched merchants are not sent to Gemini');
    assert.deepStrictEqual(plain(b.getSheetByName('META').rows), metaBefore, 'nothing is written to META');
  }

  // ---- import classifier: fail open, key never in the URL or a log -------
  // classifyWithGemini_ is shared by the hourly Gmail import and ledgerCategorize. It must keep
  // failing OPEN (no classifications, no throw into the import) while never leaking the key.
  {
    const logs = [];
    const ok = load(book(), {
      logs,
      fetch: (url, req) => {
        assert.ok(url.indexOf('models/gemini-2.5-flash:generateContent') !== -1);
        assert.ok(url.indexOf('FIXTURE_GEMINI_KEY') === -1, 'classifier: the API key is not in the URL');
        assert.ok(url.indexOf('key=') === -1, 'classifier: no key query parameter');
        assert.strictEqual(req.headers['x-goog-api-key'], 'FIXTURE_GEMINI_KEY', 'classifier: the key is sent as a header');
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"全聯": "超市"}' }] } }] }) };
      }
    });
    assert.deepStrictEqual(plain(ok.classifyWithGemini_(['全聯'], ['超市', '交通'])), { '全聯': '超市' });

    const leakyFetches = [
      (url, req) => { throw new Error('Address unavailable: ' + url + '?key=' + req.headers['x-goog-api-key']); },
      (url, req) => ({ getResponseCode: () => 400, getContentText: () => 'bad key ' + req.headers['x-goog-api-key'] })
    ];
    leakyFetches.forEach((f, i) => {
      const s = load(book(), { logs, fetch: f });
      let out;
      assert.doesNotThrow(() => { out = s.classifyWithGemini_(['全聯'], ['超市']); }, 'classifier failure ' + i + ' does not throw');
      assert.deepStrictEqual(plain(out), {}, 'classifier failure ' + i + ' returns no classifications');
    });
    assert.ok(logs.length >= 2, 'classifier failures are logged');
    assert.ok(logs.every(l => l.indexOf('FIXTURE_GEMINI_KEY') === -1), 'classifier: the API key never reaches a log');
  }

  // ---- parse: fail closed, key never logged ------------------------------
  {
    const logs = [];
    const ok = load(book(), {
      logs,
      fetch: (url, req) => {
        assert.ok(url.indexOf('models/gemini-2.5-flash:generateContent') !== -1);
        assert.ok(url.indexOf('FIXTURE_GEMINI_KEY') === -1, 'the API key is not in the URL');
        assert.strictEqual(req.headers['x-goog-api-key'], 'FIXTURE_GEMINI_KEY', 'the API key is sent as a header');
        const prompt = JSON.parse(req.payload).contents[0].parts[0].text;
        assert.ok(prompt.indexOf('2026-10-05') !== -1, 'today is given for relative dates');
        assert.ok(prompt.indexOf('中信、CASH') !== -1, 'account hints are passed');
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text:
          '```json\n{"entries":[{"date":"2026-10-05","time":"","amount":180,"merchant":"拉麵","type":"支出","accountText":"中信"}]}\n```' }] } }] }) };
      }
    });
    const parsed = ok.ledgerParse('中信 午餐 拉麵 180', '2026-10-05', ['中信', 'CASH']);
    assert.deepStrictEqual(plain(parsed), { entries: [{ date: '2026-10-05', time: '', amount: 180, merchant: '拉麵', type: '支出', accountText: '中信' }] });

    const failing = [
      () => ({ getResponseCode: () => 500, getContentText: () => 'boom' }),
      () => ({ getResponseCode: () => 200, getContentText: () => 'not json' }),
      () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'sorry' }] } }] }) }),
      () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"entries": 3}' }] } }] }) }),
      () => { throw new Error('Timeout: request exceeded'); }
    ];
    failing.forEach((f, i) => {
      const s = load(book(), { fetch: f, logs });
      assert.throws(() => s.ledgerParse('午餐 180', '2026-10-05'), /Gemini|Timeout/, 'parse failure ' + i + ' throws');
    });
    // A transport failure whose message echoes the request (as UrlFetchApp's does) must not
    // surface the key: the rethrown error is generic, and that is what linebot/ logs.
    const leaky = load(book(), { logs, fetch: (url, req) => {
      throw new Error('Address unavailable: ' + url + ' key=' + req.headers['x-goog-api-key']);
    } });
    let thrown = null;
    try { leaky.ledgerParse('午餐 180', '2026-10-05'); } catch (e) { thrown = e; }
    assert.ok(thrown, 'a thrown fetch error still fails closed');
    assert.strictEqual(thrown.message, 'Gemini request failed', 'the rethrown error is generic');
    assert.ok(String(thrown.message + (thrown.stack || '')).indexOf('FIXTURE_GEMINI_KEY') === -1,
      'a thrown fetch error does not surface the key');
    logs.push('linebot: parse failed: ' + thrown.message);
    assert.throws(() => load(book(), { noKey: true }).ledgerParse('午餐 180', '2026-10-05'), /GEMINI_API_KEY/);
    assert.throws(() => ok.ledgerParse('午餐 180', '10/5'), /YYYY-MM-DD/);
    assert.ok(logs.every(l => l.indexOf('FIXTURE_GEMINI_KEY') === -1), 'the API key never reaches a log');
  }
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_ledger_core');
} else {
  module.exports = { run };
}
