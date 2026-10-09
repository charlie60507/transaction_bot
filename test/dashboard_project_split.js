'use strict';
/*
 * #80: daily (日常) vs project (專案) spending, decided by category only.
 *
 * Server (META H:J, sidebar/程式碼.js):
 *   1. readMetaSettings_ reads H 專案類別 / I 專案起始月 / J 日常比較對象 in one read; missing
 *      headers or a sheet narrower than H mean no projects; invalid months are ignored.
 *   2. setCategoryProject / setDailyBaseline write only their own H / I or J cells (A–G, E included,
 *      and the row count are unchanged), refuse a foreign header and a name not in 種類清單, and grow a
 *      sheet narrower than the column they write.
 *   3. getDashboardData carries `projects` and `baseline` in both payload shapes, before `categories`.
 *
 * Client (sidebar/ToolPanel.html), on synthetic rows only — never the real export:
 *   4. Computation: daily excludes project categories; refunds in a project category reduce daily;
 *      我的消費 and 代墊 behave as before; the baseline window for September is the 11 months from
 *      2025-10 with an even-count median averaging the middle pair; the running month is never in the
 *      window; toggling a category to daily moves its amounts into daily and the baseline; the
 *      estimate uses only daily rows and daily-category subscriptions.
 *   5. Rendering: month scope shows the chip and deltas, year / all show neither; the current month
 *      shows the 預估 chip and no per-category delta; the heat day header has the add button and no
 *      cell carries .hadd; a category edit to a project category re-groups the row after the save.
 *   6. History (#58): with a partial load starting 2025-10, the 旅遊 running total shows the wait
 *      text while the 2026-09 baseline is shown.
 *
 * NOT evidence of the live look, the tap targets or the save round trip: those need a rendered
 * build and the deployed dashboard.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction, extractInlineScript, PANEL } = require('./extract_panel');

const SERVER = path.resolve(__dirname, '..', 'sidebar', '程式碼.js');

// ---------------------------------------------------------------- fake META
class Range {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet; this.row = row; this.col = col;
    this.numRows = numRows == null ? 1 : numRows;
    this.numCols = numCols == null ? 1 : numCols;
  }
  getValues() {
    this.sheet.reads.push([this.row, this.col, this.numRows, this.numCols]);
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
    assert.strictEqual(values.length, this.numRows, 'setValues height matches the range');
    assert.ok(this.col + this.numCols - 1 <= this.sheet.maxCols, 'a write never lands past the sheet width (col ' + (this.col + this.numCols - 1) + ')');
    this.sheet.writes.push({ row: this.row, col: this.col, numRows: this.numRows, numCols: this.numCols });
    for (let r = 0; r < this.numRows; r++) {
      assert.strictEqual(values[r].length, this.numCols, 'setValues width matches the range');
      while (this.sheet.rows.length < this.row + r) this.sheet.rows.push([]);
      for (let c = 0; c < this.numCols; c++) this.sheet.rows[this.row - 1 + r][this.col - 1 + c] = values[r][c];
    }
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
  setNumberFormat(f) { this.sheet.formats.push([this.row, this.col, f]); return this; }
}

class Sheet {
  constructor(rows, maxCols) {
    this.rows = rows.map(row => row.slice());
    this.maxCols = maxCols || Math.max(1, ...this.rows.map(r => r.length));
    this.reads = []; this.writes = []; this.formats = []; this.inserted = [];
  }
  getLastRow() { return this.rows.length; }
  getLastColumn() {
    return this.rows.reduce((n, row) => {
      let last = 0;
      row.forEach((v, i) => { if (v !== '' && v != null) last = i + 1; });
      return Math.max(n, last);
    }, 0);
  }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(after, n) { this.inserted.push([after, n]); this.maxCols += n; }
  getRange(row, col, numRows, numCols) { return new Range(this, row, col, numRows, numCols); }
}

const SERVER_FNS = ['getCategories_', 'projectMonthText_', 'defaultMetaSettings_', 'readMetaSettings_', 'getProjects_',
  'getBaselineSetting_', 'ensureMetaWidth_', 'claimMetaHeader_', 'setCategoryProject', 'setDailyBaseline'];

function loadServer(sheet) {
  const source = fs.readFileSync(SERVER, 'utf8');
  [['META_PROJECT_COL', '8'], ['META_PROJECT_START_COL', '9'], ['META_BASELINE_COL', '10']].forEach(([k, v]) => {
    assert.ok(new RegExp(k + ':\\s*' + v + ',').test(source), 'CFG.' + k + ' is column ' + v);
  });
  assert.ok(/META_PROJECT_HEADER:\s*'專案類別',/.test(source) && /META_PROJECT_START_HEADER:\s*'專案起始月',/.test(source) &&
    /META_BASELINE_HEADER:\s*'日常比較對象',/.test(source), 'the H / I / J headers');
  let flushes = 0;
  const sandbox = {
    CFG: {
      META_SHEET: 'META', META_CATEGORY_COL: 4, META_CATEGORY_HEADER: '種類清單', TZ: 'Asia/Taipei',
      META_PROJECT_COL: 8, META_PROJECT_HEADER: '專案類別', META_PROJECT_START_COL: 9, META_PROJECT_START_HEADER: '專案起始月',
      META_BASELINE_COL: 10, META_BASELINE_HEADER: '日常比較對象'
    },
    getSpreadsheet_: () => ({ getSheetByName: name => name === 'META' ? sheet : null }),
    SpreadsheetApp: { flush: () => { flushes++; } },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: { formatDate: (d, tz, p) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) }
  };
  vm.createContext(sandbox);
  vm.runInContext(SERVER_FNS.map(name => extractFunction(source, name)).join('\n'), sandbox);
  sandbox.flushes = () => flushes;
  return sandbox;
}

const plain = v => JSON.parse(JSON.stringify(v));

/** A META like the live one: A:B rules deeper than everything else, D the categories, E empty,
 *  G the accounts; H:J as given. */
function metaSheet(extra, rulesDepth, maxCols) {
  const cats = ['飲食', '交通', '旅遊', '房屋', '汽車'];
  const rows = [['交易關鍵字', '種類', '', '種類清單', '', '', '帳戶清單'].concat(extra && extra[0] ? extra[0] : [])];
  for (let i = 0; i < (rulesDepth || 12); i++) {
    const base = ['kw' + i, 'cat' + (i % 5), '', cats[i] == null ? '' : cats[i], '', '', i < 2 ? ['土銀', '玉山'][i] : ''];
    rows.push(base.concat(extra && extra[i + 1] ? extra[i + 1] : []));
  }
  return new Sheet(rows, maxCols);
}

// ---------------------------------------------------------------- 1. read
function testRead() {
  // No H:J at all, and a sheet only seven columns wide (the live sheet on 2026-10-10).
  let sheet = metaSheet(null, 12, 7);
  let server = loadServer(sheet);
  assert.deepStrictEqual(plain(server.readMetaSettings_()), { projects: [], baseline: { mode: 'median', amount: null } },
    '(1) a sheet narrower than H: no projects, median baseline');
  assert.deepStrictEqual(sheet.reads, [], '(1) and nothing is read past G');

  sheet = metaSheet([
    ['專案類別', '專案起始月', '日常比較對象'],
    ['房屋', '2026-01', 'budget'],
    ['  汽車 ', new Date(2026, 5, 1), 60000],
    ['旅遊', '2025-9'],
    ['', '2026-02'],
    ['飲食', ''],
    ['房屋', '2025-01'],
    ['交通', '2026-13']
  ]);
  server = loadServer(sheet);
  const s = plain(server.readMetaSettings_());
  assert.deepStrictEqual(s.projects, [{ name: '房屋', start: '2026-01' }, { name: '汽車', start: '2026-06' }],
    '(1) row order, trimmed; a Date cell reads as its month; 2025-9, 2026-13, blank months and blank names are ignored; duplicates skipped');
  assert.deepStrictEqual(s.baseline, { mode: 'budget', amount: 60000 }, '(1) J2 budget with J3 a positive whole amount');
  assert.deepStrictEqual(sheet.reads, [[1, 8, sheet.getLastRow(), 3]], '(1) one read of H:J');

  // Missing or foreign headers.
  sheet = metaSheet([['專案', '專案起始月'], ['房屋', '2026-01']]);
  assert.deepStrictEqual(plain(loadServer(sheet).getProjects_()), [], '(1) a foreign H header means no projects');
  sheet = metaSheet([['專案類別'], ['房屋', '2026-01']]);
  assert.deepStrictEqual(plain(loadServer(sheet).getProjects_()), [], '(1) a missing I header means no projects');
  sheet = metaSheet([['專案類別', '專案起始月', '日常比較對象'], ['房屋', '2026-01', 'budget'], ['', '', -5]]);
  assert.deepStrictEqual(plain(loadServer(sheet).getBaselineSetting_()), { mode: 'median', amount: null },
    '(1) a budget without a valid amount falls back to the median');
  sheet = metaSheet([['專案類別', '專案起始月', '日常比較對象'], ['房屋', '2026-01', 'median'], ['', '', 45000]]);
  assert.deepStrictEqual(plain(loadServer(sheet).getBaselineSetting_()), { mode: 'median', amount: 45000 },
    '(1) the median keeps the stored budget, so switching back restores it');
  const none = loadServer(null);
  none.getSpreadsheet_ = () => ({ getSheetByName: () => null });
  assert.deepStrictEqual(plain(none.readMetaSettings_()), { projects: [], baseline: { mode: 'median', amount: null } }, '(1) no META at all');
}

// ---------------------------------------------------------------- 2. writers
function snapshot(sheet) { return sheet.rows.map(r => r.slice()); }
function assertOnlyCols(sheet, before, cols, what) {
  assert.strictEqual(sheet.rows.length, before.length, what + ': the row count is unchanged');
  sheet.rows.forEach((row, r) => {
    const width = Math.max(row.length, before[r].length);
    for (let c = 0; c < width; c++) {
      if (cols.indexOf(c + 1) >= 0) continue;
      const a = row[c] == null ? '' : row[c], b = before[r][c] == null ? '' : before[r][c];
      assert.strictEqual(a, b, what + ': cell row ' + (r + 1) + ' col ' + (c + 1) + ' is unchanged');
    }
  });
  assert.ok(sheet.writes.every(w => cols.indexOf(w.col) >= 0 && cols.indexOf(w.col + w.numCols - 1) >= 0),
    what + ': every write is confined to columns ' + cols.join('/'));
}

function testProjectWriter() {
  // A seven-column sheet: the first write grows it, writes the headers, then the row.
  const sheet = metaSheet(null, 12, 7);
  const before = snapshot(sheet);
  const server = loadServer(sheet);
  let list = server.setCategoryProject('房屋', '2026-01');
  assert.deepStrictEqual(sheet.inserted, [[7, 2]], '(2) the sheet grows to I before the first write');
  assert.deepStrictEqual(plain(list), [{ name: '房屋', start: '2026-01' }], '(2) the authoritative list comes back');
  assert.ok(sheet.formats.some(f => f[1] === 9 && f[2] === '@'), '(2) the start month is written as plain text');
  list = server.setCategoryProject('汽車', '2026-06');
  list = server.setCategoryProject('旅遊', '2025-09');
  assert.deepStrictEqual(plain(list).map(p => p.name), ['房屋', '汽車', '旅遊'], '(2) new projects append after the last H cell');
  assert.strictEqual(sheet.rows[1][7], '房屋', '(2) H2 even though A:B run to row ' + sheet.rows.length);
  list = server.setCategoryProject('汽車', '2026-05');
  assert.deepStrictEqual(plain(list)[1], { name: '汽車', start: '2026-05' }, '(2) an existing project only moves its month');
  list = server.setCategoryProject('汽車', null);
  assert.deepStrictEqual(plain(list).map(p => p.name), ['房屋', '旅遊'], '(2) null makes a category daily again');
  assert.deepStrictEqual([sheet.rows[2][7], sheet.rows[2][8]], ['', ''], '(2) and blanks its row');
  list = server.setCategoryProject('汽車', '2026-06');
  assert.strictEqual(sheet.rows[4][7], '汽車', '(2) a later project goes after the last non-blank H cell');
  assert.strictEqual(server.setCategoryProject('飲食', '').length, 3, '(2) a daily category turned daily writes nothing new');
  assertOnlyCols(sheet, before, [8, 9], '(2) setCategoryProject');
  assert.deepStrictEqual(sheet.rows.map(r => r[4] == null ? '' : r[4]), before.map(r => r[4] == null ? '' : r[4]), '(2) column E stays empty');

  assert.throws(() => server.setCategoryProject('寵物', '2026-01'), /種類清單沒有「寵物」/, '(2) a name not in 種類清單 is refused');
  assert.throws(() => server.setCategoryProject('房屋', '2026-1'), /YYYY-MM/, '(2) a malformed month is refused');
  assert.throws(() => server.setCategoryProject('', '2026-01'), /請選擇類別/);

  const foreign = metaSheet([['', '', ''], ['', '']], 4, 10);
  foreign.rows[0][7] = '備註';
  const fBefore = snapshot(foreign);
  assert.throws(() => loadServer(foreign).setCategoryProject('房屋', '2026-01'), /META!H 已有其他設定/, '(2) a foreign H header is refused');
  assert.deepStrictEqual(foreign.rows, fBefore, '(2) and nothing is written');

  // Case-insensitive name match stores 種類清單's spelling.
  const latin = metaSheet(null, 4, 9);
  latin.rows[1][3] = 'Car';
  assert.deepStrictEqual(plain(loadServer(latin).setCategoryProject('car', '2026-06')), [{ name: 'Car', start: '2026-06' }],
    '(2) the stored spelling is 種類清單\'s');
}

function testBaselineWriter() {
  const sheet = metaSheet([['專案類別', '專案起始月'], ['房屋', '2026-01']], 12, 9);
  const before = snapshot(sheet);
  const server = loadServer(sheet);
  let b = server.setDailyBaseline('budget', 60000);
  assert.deepStrictEqual(sheet.inserted, [[9, 1]], '(2) the sheet grows to J');
  assert.deepStrictEqual(plain(b), { mode: 'budget', amount: 60000 });
  assert.deepStrictEqual([sheet.rows[0][9], sheet.rows[1][9], sheet.rows[2][9]], ['日常比較對象', 'budget', 60000], '(2) J1 header, J2 mode, J3 amount');
  b = server.setDailyBaseline('median');
  assert.deepStrictEqual(plain(b), { mode: 'median', amount: 60000 }, '(2) back to the median keeps the budget');
  assertOnlyCols(sheet, before, [10], '(2) setDailyBaseline');
  assert.throws(() => server.setDailyBaseline('budget'), /請輸入每月預算/, '(2) a budget needs an amount');
  assert.throws(() => server.setDailyBaseline('budget', 12.5), /正整數/, '(2) a whole amount');
  assert.throws(() => server.setDailyBaseline('budget', -1), /正整數/);
  assert.throws(() => server.setDailyBaseline('mean'), /中位數或自訂預算/);
  const foreign = metaSheet(null, 3, 10);
  foreign.rows[0][9] = '其他';
  assert.throws(() => loadServer(foreign).setDailyBaseline('median'), /META!J 已有其他設定/, '(2) a foreign J header is refused');
}

// ---------------------------------------------------------------- 3. payload
function testPayload() {
  const source = fs.readFileSync(SERVER, 'utf8');
  const fn = extractFunction(source, 'getDashboardData');
  assert.strictEqual((fn.match(/projects: settings\.projects, baseline: settings\.baseline, categories: getCategories_\(ss\)/g) || []).length, 2,
    '(3) both payload shapes carry projects and baseline, right before categories');
  assert.ok(/readMetaSettings_\(ss\)/.test(fn), '(3) read from the handle the load already opened');
}

module.exports = { Sheet, loadServer, metaSheet };

const CASES = { testRead, testProjectWriter, testBaselineWriter, testPayload };

function run() {
  Object.keys(CASES).forEach(n => CASES[n]());
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_project_split');
} else {
  module.exports.run = run;
  module.exports.CASES = CASES;
}
