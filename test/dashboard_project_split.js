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

// ---------------------------------------------------------------- client page
/** The whole inline script of ToolPanel.html against a stub document, as dashboard_history_split
 *  does; google.script.run calls are recorded for the test to answer. */
function page(now) {
  const html = fs.readFileSync(PANEL, 'utf8');
  const script = extractInlineScript(html)
    .replace('<?= now.year ?>', String(now.year)).replace('<?= now.month ?>', String(now.month))
    .replace('<?= now.day ?>', String(now.day)).replace('<?= sheetUrl ?>', 'https://example.invalid/sheet');
  const nodes = {};
  function node() {
    return { innerHTML: '', value: '', textContent: '', disabled: false, classList: { add() {}, remove() {}, contains: () => false },
      querySelectorAll: () => [], querySelector: () => null, focus() {}, select() {}, setAttribute() {}, getAttribute: () => null };
  }
  const document = {
    activeElement: null, querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
    getElementById(id) { return nodes[id] || (nodes[id] = node()); }
  };
  const calls = [];
  let pending = {};
  const run = new Proxy({}, {
    get(_, name) {
      if (name === 'withSuccessHandler') return f => { pending.success = f; return run; };
      if (name === 'withFailureHandler') return f => { pending.failure = f; return run; };
      return function () { calls.push({ fn: name, args: Array.from(arguments), success: pending.success, failure: pending.failure }); pending = {}; };
    }
  });
  const sandbox = { console, document, window: { pageXOffset: 0, pageYOffset: 0, scrollTo() {} },
    google: { script: { run } }, setTimeout: () => 0, clearTimeout() {} };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  sandbox.calls = calls;
  sandbox.nodes = nodes;
  return sandbox;
}

const NOW = { year: 2026, month: 10, day: 10 };
const WAIT = '載入完整歷史中…';
let seq = 0;
function txn(y, m, d, cat, amount, extra) {
  seq++;
  return Object.assign({ id: 'syn-' + seq + '|x|' + amount + '|0000|0', rowId: 'row-' + seq, y, m, d, hm: '', type: '支出',
    amount, charged: amount, mine: null, cat, merchant: '店' + seq, bank: '測試卡', last4: '0000', link: '', posted: true }, extra || {});
}
/** Synthetic rows. 飲食 is 1000 × (i+1) in month i from 2025-10 (so 2025-10..2026-08 is 1000..11000)
 *  and 20000 in 2026-09; a daily subscription (家居, 300) and a project one (汽車, 5000) run
 *  2026-05..2026-10; 房屋 and 旅遊 are projects; 2026-09 also has a refund and a 代墊 split. */
function rows() {
  seq = 0;
  const out = [];
  for (let i = 0; i < 11; i++) {
    const t = new Date(2025, 9 + i, 1);
    out.push(txn(t.getFullYear(), t.getMonth() + 1, 5, '飲食', 1000 * (i + 1)));
  }
  out.push(txn(2025, 9, 5, '飲食', 99999));                    // before BASE_FLOOR: never in a window
  out.push(txn(2026, 9, 5, '飲食', 20000));
  out.push(txn(2026, 9, 6, '購物', 300, { charged: 1000, mine: 300 }));   // 代墊 700
  out.push(txn(2026, 9, 7, '退款', 500, { type: '收入' }));
  out.push(txn(2026, 9, 8, '薪資', 60000, { type: '收入' }));
  for (let m = 5; m <= 10; m++) {
    out.push(txn(2026, m, 1, '家居', 300, { merchant: 'DailySub' }));
    out.push(txn(2026, m, 2, '汽車', 5000, { merchant: 'CarLoan' }));
  }
  out.push(txn(2026, 10, 3, '飲食', 2000));
  out.push(txn(2026, 1, 9, '房屋', 30000));
  out.push(txn(2026, 9, 9, '房屋', 50000));
  out.push(txn(2025, 9, 9, '旅遊', 7000));
  out.push(txn(2026, 3, 9, '旅遊', 50000));
  out.push(txn(2026, 9, 10, '旅遊', 3000));
  return out;
}
const PROJ = [{ name: '房屋', start: '2026-01' }, { name: '汽車', start: '2026-06' }, { name: '旅遊', start: '2025-09' }];

/** A page booted with `rows` and META settings; `partial` boots from 2025-10 on only (#58). */
function booted(opts) {
  opts = opts || {};
  const p = page(NOW);
  const all = rows();
  const list = opts.partial ? all.filter(t => t.y * 100 + t.m >= 202510) : all;
  const payload = Object.assign({ txns: list, olderFp: null, accounts: [] },
    opts.noSettings ? {} : { projects: opts.projects || PROJ, baseline: opts.baseline || { mode: 'median', amount: null } },
    { categories: ['飲食', '購物', '家居', '汽車', '房屋', '旅遊'] },
    opts.partial ? { complete: false, before: { y: 2025, m: 10 }, loadedFp: 'fp' } : {});
  const boot = p.calls.filter(c => c.fn === 'getDashboardData')[0];
  boot.success(JSON.stringify(payload));
  return p;
}
const scope = s => ({ month: { level: 'month', year: +s.split('-')[0], month: +s.split('-')[1] } }).month;
function view(p, state, extra) {
  Object.assign(p.state, { tab: 'analysis', q: '' }, state);
  Object.assign(p, { openRow: null, openHeatDay: null, openProject: null }, extra || {});
  p.render();
  return p.nodes.app.innerHTML;
}

// ---------------------------------------------------------------- 4. computation
function testComputation() {
  const p = booted();
  const sep = scope('2026-09');
  const d = p.dailyOf(sep);
  assert.strictEqual(d.gross, 20600, '(4) daily = the daily categories only (20000 + 300 我的消費 + 300 subscription), no 房屋 / 旅遊');
  assert.strictEqual(d.refunds, 500, '(4) refunds in scope');
  assert.strictEqual(d.total, 20100, '(4) and they are subtracted from daily, never from a project');
  assert.strictEqual(p.advIn(d.list), 700, '(4) 代墊 stays outside, as before');
  assert.strictEqual(p.projectOf('房屋', sep).total, 50000, '(4) project amount in the period');
  assert.strictEqual(p.projectOf('房屋', sep).total + p.projectOf('旅遊', sep).total + p.projectOf('汽車', sep).total, 58000,
    '(4) a refund never reduces a project');
  assert.strictEqual(p.projectRunning('房屋', sep), 80000, '(4) running total from the start month through the period');
  assert.strictEqual(p.projectRunning('旅遊', sep), 60000, '(4) 旅遊 from 2025-09');
  assert.strictEqual(p.projectRunning('汽車', sep), 20000, '(4) 汽車 from 2026-06: its May row is before the start');
  assert.strictEqual(p.projectRunning('房屋', scope('2025-12')), 0, '(4) a period before the start month has nothing yet');

  const w = Array.from(p.baselineWindow('2026-09'));
  assert.deepStrictEqual(w, ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
    '(4) September\'s window is the 11 months from 2025-10');
  assert.ok(Array.from(p.baselineWindow('2026-10')).indexOf('2026-10') < 0 && p.baselineWindow('2026-10').length === 12,
    '(4) the running month is never in a window, its own included');
  assert.ok(Array.from(p.baselineWindow('2026-11')).indexOf('2026-10') < 0, '(4) nor in a later month\'s');
  const mt = p.monthTotals();
  // Window values: 1000..7000, then 8000..11000 each + 300 (the daily subscription from 2026-05).
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p.dailyBaseline('2026-09', mt))), { ref: 6000, budget: false, months: 11 }, '(4) odd count: the middle month');
  assert.strictEqual(p.dailyBaseline('2026-08', mt).ref, 5500, '(4) even count: the mean of the middle pair (5000, 6000)');
  assert.strictEqual(p.dailyBaseline('2025-10', mt), null, '(4) nothing to compare 2025-10 with');
  const cm = p.catMedians('2026-09', mt);
  assert.strictEqual(cm.byCat['飲食'].ref, 6000, '(4) per-category median over the same window');
  assert.strictEqual(cm.byCat['家居'].ref, 0, '(4) a category in fewer than half the months has a median of 0');
  assert.ok(cm.byCat['家居'].any && !cm.byCat['購物'], '(4) …but did have spend; 購物 had none');

  // Turning 旅遊 into a daily category moves its 2026-03 trip into daily and the baseline rises.
  p.PROJECTS = PROJ.filter(x => x.name !== '旅遊');
  assert.strictEqual(p.dailyOf(sep).total, 23100, '(4) 旅遊 as daily: its 3000 joins September\'s daily');
  assert.strictEqual(p.dailyBaseline('2026-09', p.monthTotals()).ref, 7000, '(4) and the baseline rises (2026-03 is now 56000)');
  p.PROJECTS = PROJ;

  p.BASELINE = { mode: 'budget', amount: 45000 };
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p.dailyBaseline('2026-09', mt))), { ref: 45000, budget: true, months: 0 }, '(4) a budget replaces the median');
  p.BASELINE = { mode: 'median', amount: 45000 };

  // Estimate for 2026-10 (day 10 of 31): (2000 so far without the daily subscription) / 10 × 31 + 300.
  const oct = p.resolveScope('month');
  assert.deepStrictEqual(Array.from(p.dailySubs(), x => x.name), ['DailySub'], '(4) only the daily-category subscription counts; CarLoan is a project');
  assert.strictEqual(p.dailyEstimate(oct, p.dailyOf(oct)), 6500, '(4) the estimate uses daily rows and daily subscriptions only');

  const tm = p.threeMonth('2026-09', false, mt);
  assert.strictEqual(Math.round(tm.avg), Math.round((10300 + 11300 + 20100) / 3), '(4) 3-month average ends with the selected month');
  // META without the H/I headers: every category is daily.
  const none = booted({ noSettings: true });
  assert.strictEqual(none.PROJECTS.length, 0, '(9) no projects in the payload');
  assert.strictEqual(none.dailyOf(sep).total, 20100 + 50000 + 3000 + 5000, '(9) everything counts as daily');
  const h = view(none, { scope: '2026-09' });
  assert.ok(h.indexOf('class="panel hero"') >= 0 && h.indexOf('class="panel projects"') < 0, '(9) the page renders, with no projects card');
}

// ---------------------------------------------------------------- 5. rendering
function testRendering() {
  const p = booted();
  let h = view(p, { scope: '2026-09' });
  assert.ok(/<span class="chip (ok|good|warn|bad)">(高於|低於|接近)常態/.test(h), '(5) a past month shows the status chip');
  assert.ok(h.indexOf('預估') < 0, '(5) without 預估');
  assert.ok(h.indexOf('常態（11 個月中位數）$6,000') >= 0, '(5) and its baseline legend');
  assert.ok(/class="delta (up|down|flat|new)"/.test(h), '(5) per-category deltas on a past month');
  assert.ok(/<i class="rc-mark" style="left:/.test(h), '(5) with the normal-month marker on the bar');
  assert.ok(h.indexOf('刷卡 $20,000') < 0 && h.indexOf('代墊 $700 不計入') >= 0, '(5) 代墊 is shown as not counted');
  assert.ok(h.indexOf('class="panel projects"') >= 0 && h.indexOf('2026/01 起累計 $80,000') >= 0, '(5) projects card with the running total');
  assert.ok(h.indexOf('專案合計 <b>$58,000</b>') >= 0, '(5) 專案合計 for the month (房屋 50000 + 汽車 5000 + 旅遊 3000)');
  assert.ok(h.indexOf('hadd') < 0, '(5) no calendar cell carries an add button');
  h = view(p, { scope: '2026-09' }, { openHeatDay: '2026-9-5' });
  assert.ok(h.indexOf('data-dayadd="2026-09-05">＋ 在這天新增</button>') >= 0, '(5) the day detail header has the add button');

  h = view(p, { scope: 'month' });
  assert.ok(/<span class="chip [a-z]+">預估 /.test(h), '(5) the current month\'s chip compares the estimate');
  assert.ok(h.indexOf('預估月底 $6,500') >= 0, '(5) and the legend shows it');
  assert.ok(!/class="delta (up|down|flat|new)"/.test(h.split('日常類別')[1].split('class="panel projects"')[0]), '(5) no per-category delta in a running month');
  ['year', 'all', '2025'].forEach(s => {
    const y = view(p, { scope: s });
    assert.ok(y.indexOf('class="chip') < 0, '(5) ' + s + ': no baseline chip');
    assert.ok(!/class="delta (up|down|flat|new)"/.test(y.split('日常類別')[1].split('class="panel projects"')[0]), '(5) ' + s + ': no per-category deltas');
    assert.ok(y.indexOf('rc-mark') < 0 && y.indexOf('個月中位數') < 0, '(5) ' + s + ': no normal marker, no median');
    assert.ok(/平均每月 \$[\d,]+（\d+ 個完整月）/.test(y), '(5) ' + s + ': the average per complete month instead');
  });

  // A daily row re-categorised to a project moves to the projects card once the server answers.
  const moved = p.TXNS.find(t => t.cat === '飲食' && t.y === 2026 && t.m === 9);
  h = view(p, { scope: '2026-09' }, { openRow: '飲食' });
  assert.ok(h.indexOf('data-category-txn="' + moved.id + '"') >= 0, '(5) precondition: the row is listed under 飲食');
  p.applyEdit(moved.rowId, 'cat', '房屋');
  const c = p.calls.filter(x => x.fn === 'updateTxn').pop();
  const after = p.TXNS.map(t => Object.assign({}, t, t.rowId === moved.rowId ? { cat: '房屋' } : {}));
  c.success({ ok: true, txns: after, olderFp: null });
  h = view(p, { scope: '2026-09' }, { openProject: '房屋' });
  const proj = h.split('class="panel projects"')[1];
  assert.ok(proj.indexOf('data-category-txn="' + moved.id + '"') >= 0, '(5) after the save the row is in the 房屋 project');
  assert.ok(h.split('日常類別')[1].split('class="panel projects"')[0].indexOf('$20,000') < 0, '(5) and out of the daily categories');
  assert.strictEqual(p.dailyOf(scope('2026-09')).total, 100, '(5) daily drops by that row');
}

// ---------------------------------------------------------------- 6. history
function testHistory() {
  const p = booted({ partial: true });
  assert.strictEqual(p.HISTORY.complete, false, '(6) precondition: partial load from 2025-10');
  const h = view(p, { scope: '2026-09' });
  assert.ok(h.indexOf('2025/09 起累計 ' + WAIT) >= 0, '(6) 旅遊 started before the loaded months: its running total waits');
  assert.ok(h.indexOf('2026/01 起累計 $80,000') >= 0, '(6) 房屋 started inside them: shown');
  assert.ok(h.indexOf('常態（11 個月中位數）$6,000') >= 0, '(6) the 2026-09 baseline needs only loaded months and is shown');
  assert.ok(view(p, { scope: 'all' }).indexOf('class="panel hero"') < 0, '(6) 全部期間 still waits');
  // Settings: 日常 → 專案 needs the earliest row, so it waits for the whole history.
  assert.ok(/data-kind="project" data-kind-idx="0" aria-pressed="false" disabled title="載入完整歷史中…"/.test(p.categoryKind('飲食', 0)),
    '(6) the 專案 switch is disabled with the wait text until the history is complete');
}

// ---------------------------------------------------------------- Settings saves
function testSettingsSaves() {
  const p = booted();
  p.categoryKindClick({ target: { closest: () => ({ disabled: false, getAttribute: k => ({ 'data-kind-idx': '0', 'data-kind': 'project' })[k] }) } });
  const c = p.calls.filter(x => x.fn === 'setCategoryProject').pop();
  assert.deepStrictEqual(Array.from(c.args), ['飲食', '2025-09'], 'turning 飲食 into a project defaults to its earliest row\'s month');
  c.success(PROJ.concat([{ name: '飲食', start: '2025-09' }]));
  assert.ok(p.isProjectCat('飲食'), 'the server\'s list is adopted');
  assert.ok(view(p, { scope: '2026-09' }).indexOf('class="panel hero"') >= 0, 'and the page re-renders from it');
  p.saveDailyBaseline('budget', 60000);
  const b = p.calls.filter(x => x.fn === 'setDailyBaseline').pop();
  assert.deepStrictEqual(Array.from(b.args), ['budget', 60000]);
  b.success({ mode: 'budget', amount: 60000 });
  assert.ok(view(p, { scope: '2026-09' }).indexOf('自訂預算 $60,000') >= 0, 'the budget becomes the comparison');
}

module.exports = { Sheet, loadServer, metaSheet };

const CASES = { testRead, testProjectWriter, testBaselineWriter, testPayload, testComputation, testRendering, testHistory, testSettingsSaves };

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
