'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction, loadFns } = require('./extract_panel');

const BOT = path.resolve(__dirname, '..', 'sidebar', 'cards_transaction_bot.js');
const SERVER = path.resolve(__dirname, '..', 'sidebar', '程式碼.js');
const HEADERS = [
  '已記帳', '銀行', '授權日期時間', '卡末四碼', '金額_NTD', '交易內容/商店', '類別',
  'Gmail連結', 'MessageId', '收支別', '種類(手動)', 'TAG', '我的消費'
];
const CFG = {
  SPREADSHEET_ID: 'fixture-sheet', DATA_SHEET: 'Transactions', DELETED_SHEET: 'Deleted',
  TZ: 'Asia/Taipei', IDX_POSTED: 0, IDX_BANK: 1, IDX_DATE: 2, IDX_LAST4: 3,
  IDX_AMOUNT: 4, IDX_MERCHANT: 5, IDX_CATEGORY_AUTO: 6, IDX_LINK: 7,
  IDX_MESSAGEID: 8, IDX_INOUT: 9, IDX_CATEGORY_MANUAL: 10, HDR_MINE: '我的消費'
};

function cloneRows(rows) { return rows.map(row => row.slice()); }

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
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
    assert.strictEqual(values.length, this.numRows, 'fixture row count matches setValues range');
    values.forEach((valuesRow, r) => {
      assert.strictEqual(valuesRow.length, this.numCols, 'fixture column count matches setValues range');
      const target = this.sheet.ensureRow(this.row - 1 + r);
      valuesRow.forEach((value, c) => { target[this.col - 1 + c] = value; });
    });
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
  setNumberFormat() { return this; }
  setDataValidation() { return this; }
  sort(specs) {
    const body = this.sheet.rows.splice(this.row - 1, this.numRows);
    body.sort((a, b) => {
      for (const spec of specs) {
        const av = a[spec.column - 1];
        const bv = b[spec.column - 1];
        const aa = av instanceof Date ? av.getTime() : String(av || '');
        const bb = bv instanceof Date ? bv.getTime() : String(bv || '');
        if (aa === bb) continue;
        return (aa < bb ? -1 : 1) * (spec.ascending ? 1 : -1);
      }
      return 0;
    });
    this.sheet.rows.splice(this.row - 1, 0, ...body);
    return this;
  }
}

class Sheet {
  constructor(name, rows) { this.name = name; this.rows = cloneRows(rows || []); this.parent = null; }
  ensureRow(index) { while (this.rows.length <= index) this.rows.push([]); return this.rows[index]; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((max, row) => Math.max(max, row.length), 0); }
  getRange(row, col, numRows, numCols) { return new Range(this, row, col, numRows, numCols); }
  getParent() { return this.parent; }
  setFrozenRows() { return this; }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  insertRowBefore(row) { this.rows.splice(row - 1, 0, []); }
}

class Spreadsheet {
  constructor(sheets) {
    this.sheets = {};
    sheets.forEach(sheet => { sheet.parent = this; this.sheets[sheet.name] = sheet; });
  }
  getSheetByName(name) { return this.sheets[name] || null; }
  insertSheet(name) { const sheet = new Sheet(name, []); sheet.parent = this; this.sheets[name] = sheet; return sheet; }
}

function message(id, subject, plain, html) {
  return {
    getId: () => id,
    getSubject: () => subject,
    getDate: () => new Date('2026-09-13T04:00:00Z'),
    getPlainBody: () => plain,
    getBody: () => html || plain
  };
}

function formatDate(date, format) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const parts = {
    yyyy: String(shifted.getUTCFullYear()), M: String(shifted.getUTCMonth() + 1),
    MM: String(shifted.getUTCMonth() + 1).padStart(2, '0'), d: String(shifted.getUTCDate()),
    dd: String(shifted.getUTCDate()).padStart(2, '0'),
    HH: String(shifted.getUTCHours()).padStart(2, '0'),
    mm: String(shifted.getUTCMinutes()).padStart(2, '0'),
    ss: String(shifted.getUTCSeconds()).padStart(2, '0')
  };
  return format.replace(/yyyy|MM|dd|HH|mm|ss|M|d/g, token => parts[token]);
}

function loadBot(spreadsheet, threads) {
  const props = {
    SPREADSHEET_ID: 'fixture-sheet', SORT_ORDER: 'NONE', TZ: 'Asia/Taipei',
    FUBON_TRANSFER_QUERY: 'fixture-fubon-transfer'
  };
  const sandbox = {
    console: { log: () => {} }, Logger: { log: () => {} }, Date,
    CFG, Set, Map,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => props[key] || null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {}, waitLock: () => true }) },
    SpreadsheetApp: {
      openById: () => spreadsheet,
      newDataValidation: () => ({ requireCheckbox() { return this; }, build: () => ({}) })
    },
    GmailApp: {
      search: query => {
        if (query.includes('fixture-fubon-transfer')) return [threads.fubon];
        if (query.includes('CUBE App轉帳通知')) return [threads.cathay];
        return [];
      }
    },
    Utilities: { formatDate: (date, tz, fmt) => formatDate(date, fmt) },
    UrlFetchApp: { fetch: () => { throw new Error('Gemini must not run in this fixture'); } }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(BOT, 'utf8'), sandbox, { filename: BOT });
  return sandbox;
}

function loadServer(spreadsheet) {
  const source = fs.readFileSync(SERVER, 'utf8');
  const names = [
    'txnKey_', 'asTxnKey_', 'isDisplayedTxn_', 'findRowByKey_', 'getAllTxns',
    'isAmountCorrectionType_', 'updateTxn', 'addTxn', 'getOrCreateDeleted_', 'deleteTxn',
    'sheetHasBaseKey_', 'getSpreadsheet_', 'rowCategory_', 'cellDateTime_', 'rowHM_',
    'lastDataRow_', 'insertPositionForDate_', 'getTagColIndex_', 'getMineColIndex_',
    'headerRow_', 'ensureMineColIndex_', 'rowMine_'
  ];
  const sandbox = {
    console, Date, CFG,
    SpreadsheetApp: {
      openById: () => spreadsheet, flush: () => {},
      newDataValidation: () => ({ requireCheckbox() { return this; }, build: () => ({}) })
    },
    LockService: { getScriptLock: () => ({ waitLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      formatDate: (date, tz, fmt) => formatDate(date, fmt),
      getUuid: () => 'fixture-manual-id'
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(names.map(name => extractFunction(source, name)).join('\n'), sandbox);
  return sandbox;
}

function run() {
  const historical = [false, '現金', new Date('2026-08-01T04:00:00Z'), '', 500, '歷史轉帳', '', '', 'historical-transfer', '轉帳', '其他', '', ''];
  const transactions = new Sheet('Transactions', [HEADERS, historical]);
  const deleted = new Sheet('Deleted', [HEADERS]);
  const spreadsheet = new Spreadsheet([transactions, deleted]);

  const cathay = message(
    'cathay-transfer-1', 'CUBE App轉帳通知',
    '您於2026/09/13 11:22:33\n轉帳金額 1,200\n轉入帳號 013-123456789012345\n備註 理髮'
  );
  const fubonInitiated = message(
    'fubon-transfer-init', '臺幣轉帳通知',
    '交易時間 2026/09/13 12:34:56\n轉帳金額 TWD 2,345\n轉入帳號 822(中國信託)-00009015****3057'
  );
  const fubonSuccess = message(
    'fubon-transfer-success', '臺幣轉帳成功通知',
    '交易時間 2026/09/13 12:34:56\n轉出金額 TWD 2,345\n轉入帳號 822(中國信託)-00009015****3057\n存摺留言(給對方) 租金\n手續費 0'
  );
  const threads = {
    cathay: { getMessages: () => [cathay] },
    fubon: { getMessages: () => [fubonInitiated, fubonSuccess] }
  };

  const bot = loadBot(spreadsheet, threads);
  const cathayParsed = bot.parseCathayTransfer_(cathay);
  assert.strictEqual(cathayParsed.merchant, '理髮');
  assert.strictEqual(cathayParsed.amount, 1200);
  assert.strictEqual(cathayParsed.last4, '2345');
  assert.strictEqual(cathayParsed.category, '轉帳');
  assert.strictEqual(cathayParsed.link, 'https://mail.google.com/mail/#all/cathay-transfer-1');

  const fubonParsed = bot.parseFubonTransfer_(fubonSuccess);
  assert.strictEqual(fubonParsed.merchant, '租金');
  assert.strictEqual(fubonParsed.amount, 2345);
  assert.strictEqual(fubonParsed.last4, '3057');
  assert.strictEqual(fubonParsed.category, '轉帳');
  assert.strictEqual(fubonParsed.link, 'https://mail.google.com/mail/#all/fubon-transfer-success');

  bot.appendLast7DaysToSheet();
  const imported = transactions.rows.filter(row => /transfer-(1|success)$/.test(String(row[8])));
  assert.strictEqual(imported.length, 2, 'both transfer paths append one row');
  const cathayRow = imported.find(row => row[8] === 'cathay-transfer-1');
  const fubonRow = imported.find(row => row[8] === 'fubon-transfer-success');
  assert.deepStrictEqual(cathayRow.slice(1, 10), ['國泰', cathayParsed.dt, '2345', 1200, '理髮', '轉帳', cathayParsed.link, 'cathay-transfer-1', '支出']);
  assert.deepStrictEqual(fubonRow.slice(1, 10), ['富邦', fubonParsed.dt, '3057', 2345, '租金', '轉帳', fubonParsed.link, 'fubon-transfer-success', '支出']);
  assert.ok(!transactions.rows.some(row => row[8] === 'fubon-transfer-init'), 'richer Fubon success notice remains preferred');

  const server = loadServer(spreadsheet);
  assert.strictEqual(server.getAllTxns().find(txn => txn.id.startsWith('historical-transfer|')).type, '轉帳', 'historical transfer remains unchanged');

  let retained = server.getAllTxns().find(txn => txn.id.startsWith('cathay-transfer-1|'));
  assert.strictEqual(retained.type, '支出');
  server.updateTxn(retained.id, { amount: 1500, cat: '個人' }, true);
  retained = server.getAllTxns().find(txn => txn.id.startsWith('cathay-transfer-1|'));
  assert.strictEqual(retained.amount, 1500, 'retained transfer uses the existing expense amount editor path');
  assert.strictEqual(retained.cat, '個人', 'retained transfer uses the existing expense category editor path');
  const totals = loadFns(['inScope', 'sumScope'], { TXNS: server.getAllTxns() });
  assert.strictEqual(totals.sumScope(txn => txn.type === '支出', { level: 'all' }), 3845,
    'production dashboard expense predicate includes retained imports');

  const manual = server.addTxn({ date: '2026-09-12', amount: 80, type: '轉帳', source: '現金', merchant: '手動轉帳' });
  assert.strictEqual(manual.type, '轉帳', 'manual creation still accepts transfer type');
  server.updateTxn(manual.id, { type: '轉帳' });
  assert.strictEqual(server.getAllTxns().find(txn => txn.id.startsWith('manual-fixture-manual-id|')).type, '轉帳',
    'manual editing still accepts transfer type');

  const deleting = server.getAllTxns().find(txn => txn.id.startsWith('fubon-transfer-success|'));
  const fubonRowNumber = transactions.rows.findIndex(row => row[8] === 'fubon-transfer-success') + 1;
  const completeFubonRow = transactions.getRange(fubonRowNumber, 1, 1, transactions.getLastColumn()).getValues()[0];
  server.deleteTxn(deleting.id);
  assert.deepStrictEqual(deleted.rows.find(row => row[8] === 'fubon-transfer-success'), completeFubonRow,
    'delete copies every source column before removing the transaction');
  assert.ok(!transactions.rows.some(row => row[8] === 'fubon-transfer-success'));

  bot.appendLast7DaysToSheet();
  assert.ok(!transactions.rows.some(row => row[8] === 'fubon-transfer-success'),
    'Deleted participates in import deduplication and prevents resurrection');
  assert.strictEqual(transactions.rows.filter(row => row[8] === 'cathay-transfer-1').length, 1,
    'retained imports also remain deduplicated');
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_transfer_expense');
} else {
  module.exports = { run };
}
