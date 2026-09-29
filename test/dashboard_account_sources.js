'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./extract_panel');

const SERVER = path.resolve(__dirname, '..', 'sidebar', '程式碼.js');

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
  setValue(value) {
    while (this.sheet.rows.length < this.row) this.sheet.rows.push([]);
    this.sheet.rows[this.row - 1][this.col - 1] = value;
    return this;
  }
}

class Sheet {
  constructor(rows) { this.rows = rows.map(row => row.slice()); }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((n, row) => Math.max(n, row.length), 0); }
  getRange(row, col, numRows, numCols) { return new Range(this, row, col, numRows, numCols); }
}

function loadServer(sheet) {
  const source = fs.readFileSync(SERVER, 'utf8');
  const sandbox = {
    CFG: { META_SHEET: 'META', META_ACCOUNT_COL: 7, META_ACCOUNT_HEADER: '帳戶清單' },
    getSpreadsheet_: () => ({ getSheetByName: name => name === 'META' ? sheet : null }),
    SpreadsheetApp: { flush: () => {} },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    ['getAccountSources_', 'addAccountSource'].map(name => extractFunction(source, name)).join('\n'),
    sandbox
  );
  return sandbox;
}

function run() {
  const sheet = new Sheet([
    ['交易關鍵字', '種類', '', '種類清單', 'TAG清單'],
    ['理髮', '個人', '', '個人', '生活']
  ]);
  const server = loadServer(sheet);

  assert.strictEqual(server.getAccountSources_().join('|'), '', 'missing account header is an empty config');
  assert.strictEqual(server.addAccountSource('  中信  ').join('|'), '中信');
  assert.strictEqual(sheet.rows[0][6], '帳戶清單', 'account config uses META column G');
  assert.strictEqual(sheet.rows[1][6], '中信', 'adding an account does not create a transaction');

  assert.strictEqual(server.addAccountSource('中信').join('|'), '中信', 'duplicate add is idempotent');
  assert.strictEqual(server.addAccountSource('CASH').join('|'), '中信|CASH');
  assert.strictEqual(server.addAccountSource('cash').join('|'), '中信|CASH', 'Latin names dedupe case-insensitively');
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_account_sources');
} else {
  module.exports = { run };
}
