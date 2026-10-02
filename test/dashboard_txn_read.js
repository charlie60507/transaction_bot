'use strict';
// getAllTxns and ensureRowIdColIndex_ run on every dashboard open and every edit, so both
// were trimmed to do less work per row (#56). These checks pin that the trim changed
// nothing observable: the same txn objects, the same 交易 ID backfill, and no data read
// wider than one column for the backfill check.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./extract_panel');

const SERVER = path.resolve(__dirname, '..', 'sidebar', '程式碼.js');
const HEADERS = [
  '已記帳', '銀行', '授權日期時間', '卡末四碼', '金額_NTD', '交易內容/商店', '類別',
  'Gmail連結', 'MessageId', '收支別', '種類(手動)', '我的消費', '交易 ID'
];
const CFG = {
  DATA_SHEET: 'Transactions', TZ: 'Asia/Taipei', HDR_MINE: '我的消費', HDR_ROW_ID: '交易 ID',
  IDX_POSTED: 0, IDX_BANK: 1, IDX_DATE: 2, IDX_LAST4: 3, IDX_AMOUNT: 4, IDX_MERCHANT: 5,
  IDX_CATEGORY_AUTO: 6, IDX_LINK: 7, IDX_MESSAGEID: 8, IDX_INOUT: 9, IDX_CATEGORY_MANUAL: 10
};

class Sheet {
  constructor(rows) { this.rows = rows.map(r => r.slice()); this.reads = []; this.writes = []; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((max, r) => Math.max(max, r.length), 0); }
  getRange(row, col, numRows, numCols) {
    const sheet = this;
    numRows = numRows == null ? 1 : numRows;
    numCols = numCols == null ? 1 : numCols;
    return {
      getValues() {
        sheet.reads.push({ row, col, numRows, numCols });
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const src = sheet.rows[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(src[col - 1 + c] == null ? '' : src[col - 1 + c]);
          out.push(line);
        }
        return out;
      },
      setValues(values) {
        assert.strictEqual(values.length, numRows, 'setValues row count matches its range');
        sheet.writes.push({ row, col, numRows, numCols, values: values.map(v => Array.from(v)) });  // host-realm arrays for deepStrictEqual
        values.forEach((line, r) => {
          assert.strictEqual(line.length, numCols, 'setValues column count matches its range');
          while (sheet.rows.length <= row - 1 + r) sheet.rows.push([]);
          line.forEach((v, c) => { sheet.rows[row - 1 + r][col - 1 + c] = v; });
        });
      },
      setValue(value) { this.setValues([[value]]); }
    };
  }
}

// Honours the timezone argument, so a call that formats in the wrong zone shows up as a
// different y/m/d/hm rather than passing by accident.
function formatDate(date, tz, pattern) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).forEach(p => { parts[p.type] = p.value; });
  const tokens = {
    yyyy: parts.year, M: String(Number(parts.month)), d: String(Number(parts.day)),
    HH: parts.hour.padStart(2, '0'), mm: parts.minute.padStart(2, '0'), ss: parts.second.padStart(2, '0')
  };
  return pattern.replace(/yyyy|HH|mm|ss|M|d/g, t => tokens[t]);
}

function loadServer(sheet, opts) {
  opts = opts || {};
  const src = fs.readFileSync(SERVER, 'utf8');
  const names = ['txnKey_', 'isDisplayedTxn_', 'getRowIdColIndex_', 'ensureRowIdColIndex_', 'getAllTxns',
    'rowCategory_', 'rowMine_', 'getMineColIndex_', 'headerRow_', 'rowHM_', 'hmFromHms_'];
  let uuidSeq = 0;
  const calls = { formatDate: 0, flush: 0 };
  const utilities = {
    formatDate: (date, tz, pattern) => { calls.formatDate++; return formatDate(date, tz, pattern); }
  };
  if (!opts.noUuid) utilities.getUuid = () => 'uuid-' + (++uuidSeq);
  const sandbox = {
    console, Date, CFG, Utilities: utilities,
    getSpreadsheet_: () => ({ getSheetByName: () => sheet }),
    SpreadsheetApp: { flush: () => { calls.flush++; } }
  };
  vm.createContext(sandbox);
  vm.runInContext(names.map(n => extractFunction(src, n)).join('\n'), sandbox);
  sandbox.calls = calls;
  return sandbox;
}

function row(fields) {
  const r = new Array(HEADERS.length).fill('');
  r[CFG.IDX_POSTED] = false;
  Object.keys(fields).forEach(k => { r[Number(k)] = fields[k]; });
  return r;
}

// Rows with and without a time, exact midnight, a sub-minute after midnight, a year boundary
// that only lands right in CFG.TZ, string dates, blank and unparseable dates, the
// checkbox-only tail, and two rows sharing a composite key.
function txnFixtureRows() {
  return [
    HEADERS,
    row({ 0: true, 1: '富邦', 2: new Date('2026-09-13T04:30:15Z'), 3: '1234', 4: 120, 5: '星巴克', 8: 'm1', 9: '支出', 10: '飲食', 12: 'id-1' }),
    row({ 1: '國泰', 2: new Date('2026-09-12T16:00:00Z'), 3: '5678', 4: 300, 5: '日期無時間', 8: 'm2', 9: '支出', 10: '', 12: 'id-2' }),
    row({ 1: '國泰', 2: new Date('2026-09-12T16:00:30Z'), 3: '5678', 4: 301, 5: '午夜三十秒', 8: 'm3', 9: '收入', 10: '薪資', 11: 99 }),
    row({ 1: '玉山', 2: '', 4: 50, 5: '空白日期', 8: 'm4', 9: '支出' }),
    row({ 1: '玉山', 2: 'not a date', 4: 51, 5: '壞日期', 8: 'm5', 9: '支出' }),
    row({ 1: '台新', 2: '2026-09-10T02:05:00Z', 3: '9999', 4: 75, 5: '字串日期', 8: 'm6', 9: '轉帳', 10: '轉帳', 11: 10, 12: 'id-6' }),
    row({ 1: '富邦', 2: new Date('2026-09-11T03:00:00Z'), 3: '1234', 4: 88, 5: '重複一', 8: 'dup', 9: '支出', 10: '交通', 11: 40, 12: 'id-7' }),
    row({ 1: '富邦', 2: new Date('2026-09-11T03:00:00Z'), 3: '1234', 4: 88, 5: '重複二', 8: 'dup', 9: '支出', 10: '交通', 11: 'abc', 12: 'id-8' }),
    row({ 0: true, 1: '永豐', 2: new Date('2025-12-31T16:30:00Z'), 3: '0001', 4: 1000, 5: '跨年', 7: 'https://mail/x', 8: 'm9', 9: '', 10: '其他', 11: -5, 12: 'id-9' }),
    [false]
  ];
}

// Captured from getAllTxns as it stood before #56 (four formatDate calls per row), on
// txnFixtureRows() with the timezone-honouring formatDate above. Do not regenerate it
// from the current implementation: its whole value is that it predates the change.
const EXPECTED_TXNS = [
  { y: 2026, m: 9, d: 13, hm: '12:30', type: '支出', amount: 120, charged: 120, mine: null, cat: '飲食', merchant: '星巴克', bank: '富邦', last4: '1234', link: '', id: 'm1|1789273815000|120|1234|0', rowId: 'id-1', posted: true },
  { y: 2026, m: 9, d: 13, hm: '', type: '支出', amount: 300, charged: 300, mine: null, cat: '未分類', merchant: '日期無時間', bank: '國泰', last4: '5678', link: '', id: 'm2|1789228800000|300|5678|0', rowId: 'id-2', posted: false },
  { y: 2026, m: 9, d: 13, hm: '00:00', type: '收入', amount: 99, charged: 301, mine: 99, cat: '薪資', merchant: '午夜三十秒', bank: '國泰', last4: '5678', link: '', id: 'm3|1789228830000|301|5678|0', rowId: '', posted: false },
  { y: 2026, m: 9, d: 10, hm: '10:05', type: '轉帳', amount: 75, charged: 75, mine: null, cat: '轉帳', merchant: '字串日期', bank: '台新', last4: '9999', link: '', id: 'm6|2026-09-10T02:05:00Z|75|9999|0', rowId: 'id-6', posted: false },
  { y: 2026, m: 9, d: 11, hm: '11:00', type: '支出', amount: 40, charged: 88, mine: 40, cat: '交通', merchant: '重複一', bank: '富邦', last4: '1234', link: '', id: 'dup|1789095600000|88|1234|0', rowId: 'id-7', posted: false },
  { y: 2026, m: 9, d: 11, hm: '11:00', type: '支出', amount: 88, charged: 88, mine: null, cat: '交通', merchant: '重複二', bank: '富邦', last4: '1234', link: '', id: 'dup|1789095600000|88|1234|1', rowId: 'id-8', posted: false },
  { y: 2026, m: 1, d: 1, hm: '00:30', type: '支出', amount: 1000, charged: 1000, mine: -5, cat: '其他', merchant: '跨年', bank: '永豐', last4: '0001', link: 'https://mail/x', id: 'm9|1767198600000|1000|0001|0', rowId: 'id-9', posted: true }
];

function testGetAllTxns() {
  const sheet = new Sheet(txnFixtureRows());
  const server = loadServer(sheet);
  const txns = JSON.parse(JSON.stringify(server.getAllTxns()));
  assert.deepStrictEqual(txns, EXPECTED_TXNS, 'getAllTxns output is identical to the pre-change capture');
  // Key order is part of the payload contract the page and its tests hardcode.
  txns.forEach((t, i) => assert.deepStrictEqual(Object.keys(t), Object.keys(EXPECTED_TXNS[i]), 'row ' + i + ' key order is unchanged'));
  assert.strictEqual(server.calls.formatDate, EXPECTED_TXNS.length, 'exactly one formatDate per displayed row');
}

function backfillRows() {
  return [
    HEADERS,
    row({ 2: new Date('2026-09-13T04:00:00Z'), 8: 'a', 12: 'keep-1' }),
    row({ 2: new Date('2026-09-13T05:00:00Z'), 8: 'b' }),
    row({ 2: '', 8: 'blank' }),
    row({ 2: 'not a date', 8: 'bad' }),
    row({ 2: '2026-09-10T02:05:00Z', 8: 'string-date' }),
    [false],
    [false]
  ];
}

// Every read below the header must be one column wide; the header lookup is one row.
function assertNarrowReads(sheet, label) {
  sheet.reads.forEach(r => {
    if (r.row === 1 && r.numRows === 1) return;
    assert.strictEqual(r.numCols, 1, label + ': data read at row ' + r.row + ' col ' + r.col + ' is one column wide');
  });
}

function testEnsureRowId() {
  // Backfill: only displayed rows lacking an id get one; blank/unparseable/tail rows get none.
  let sheet = new Sheet(backfillRows());
  let server = loadServer(sheet);
  assert.strictEqual(server.ensureRowIdColIndex_(sheet), 12, 'returns the 交易 ID column index');
  assert.deepStrictEqual(sheet.writes, [{
    row: 2, col: 13, numRows: 7, numCols: 1,
    values: [['keep-1'], ['uuid-1'], [''], [''], ['uuid-2'], [''], ['']]
  }], 'one write-back over the same range, ids only on displayed rows that lacked one');
  assert.strictEqual(server.calls.flush, 1, 'the write-back is flushed');
  assertNarrowReads(sheet, 'backfill');
  assert.ok(sheet.reads.some(r => r.row === 2 && r.col === CFG.IDX_DATE + 1 && r.numRows === 7), 'reads the date column');
  assert.ok(sheet.reads.some(r => r.row === 2 && r.col === 13 && r.numRows === 7), 'reads the 交易 ID column');

  // Nothing missing: no write, no flush. Re-running on the backfilled sheet is that case.
  sheet.writes = []; sheet.reads = [];
  server.calls.flush = 0;
  assert.strictEqual(server.ensureRowIdColIndex_(sheet), 12, 'stable index on a second run');
  assert.deepStrictEqual(sheet.writes, [], 'nothing written when no displayed row lacks an id');
  assert.strictEqual(server.calls.flush, 0, 'no flush when nothing was written');
  assertNarrowReads(sheet, 'no-op');

  // Missing header: the column is created after the last one, then backfilled.
  const noHeader = backfillRows().map(r => r.slice(0, 12));
  noHeader[1][12] = undefined; noHeader[1].length = 12;
  sheet = new Sheet(noHeader);
  server = loadServer(sheet);
  assert.strictEqual(server.ensureRowIdColIndex_(sheet), 12, 'creates the column at the old last-column position');
  assert.deepStrictEqual(sheet.writes[0], { row: 1, col: 13, numRows: 1, numCols: 1, values: [['交易 ID']] }, 'writes the header');
  assert.deepStrictEqual(sheet.writes[1].values, [['uuid-1'], ['uuid-2'], [''], [''], ['uuid-3'], [''], ['']],
    'backfills every displayed row of a fresh column');
  assertNarrowReads(sheet, 'new column');

  // Offline fixtures without Utilities.getUuid keep the legacy composite path.
  sheet = new Sheet(backfillRows());
  server = loadServer(sheet, { noUuid: true });
  assert.strictEqual(server.ensureRowIdColIndex_(sheet), -1, 'no getUuid → -1');
  assert.deepStrictEqual(sheet.writes, [], 'no getUuid → nothing written');
}

function run() {
  testGetAllTxns();
  testEnsureRowId();
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_txn_read');
} else {
  module.exports = { run, loadServer, Sheet, txnFixtureRows };
}
