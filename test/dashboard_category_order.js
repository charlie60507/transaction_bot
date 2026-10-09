'use strict';
/*
 * #65: META!D (種類清單) is the single source of truth for category order.
 *
 *   1. getCategories_ reads D in row order: trimmed, blanks skipped, case-insensitive dedupe; [] without
 *      the header, and one read of the column from the spreadsheet the caller passes.
 *   2. addCategory trims, rejects empty / over-length input, is idempotent on duplicates, and appends
 *      after the last non-blank D cell even when A:B run many rows further down.
 *   3. setCategoryOrder rewrites D for a valid permutation; a missing, extra or duplicated entry throws
 *      and leaves D unchanged.
 *   4. Shared-row safety: A:B and G hold values on D's rows; after an add and a reorder every non-D cell
 *      and the row count are unchanged.
 *   5. Client ordering: distinctCats / realCats give 未分類 first, then META!D's order, then the
 *      transaction categories missing from it in code-point order. The Settings list draws a drag handle
 *      per row, disabled while a save is in flight; a failed reorder re-renders from the last
 *      server-confirmed list.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction, loadFns } = require('./extract_panel');

const SERVER = path.resolve(__dirname, '..', 'sidebar', '程式碼.js');
const D = 3;   // 0-based index of column D

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
    this.sheet.writes.push({ row: this.row, col: this.col, numRows: this.numRows, numCols: this.numCols });
    for (let r = 0; r < this.numRows; r++) {
      assert.strictEqual(values[r].length, this.numCols, 'setValues width matches the range');
      while (this.sheet.rows.length < this.row + r) this.sheet.rows.push([]);
      for (let c = 0; c < this.numCols; c++) this.sheet.rows[this.row - 1 + r][this.col - 1 + c] = values[r][c];
    }
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
}

class Sheet {
  constructor(rows) { this.rows = rows.map(row => row.slice()); this.reads = []; this.writes = []; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((n, row) => Math.max(n, row.length), 0); }
  getRange(row, col, numRows, numCols) { return new Range(this, row, col, numRows, numCols); }
}

function loadServer(sheet) {
  const source = fs.readFileSync(SERVER, 'utf8');
  assert.ok(/META_CATEGORY_COL:\s*4,/.test(source), 'CFG.META_CATEGORY_COL is column D');
  assert.ok(/META_CATEGORY_HEADER:\s*'種類清單',/.test(source), 'CFG.META_CATEGORY_HEADER is 種類清單');
  let flushes = 0;
  const sandbox = {
    CFG: { META_SHEET: 'META', META_CATEGORY_COL: 4, META_CATEGORY_HEADER: '種類清單' },
    getSpreadsheet_: () => ({ getSheetByName: name => name === 'META' ? sheet : null }),
    SpreadsheetApp: { flush: () => { flushes++; } },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    ['getCategories_', 'lastCategoryRow_', 'addCategory', 'setCategoryOrder'].map(name => extractFunction(source, name)).join('\n'),
    sandbox
  );
  sandbox.flushes = () => flushes;
  return sandbox;
}

const list = v => Array.from(v);
const column = (sheet, idx) => sheet.rows.map(r => r[idx] == null ? '' : r[idx]);

/** A META like the live one: A:B keyword rules far deeper than D, D the categories, G the accounts. */
function metaSheet(categories, rulesDepth) {
  const rows = [['交易關鍵字', '種類', '', '種類清單', '', '', '帳戶清單']];
  const accounts = ['土銀', '玉山'];
  for (let i = 0; i < rulesDepth; i++) {
    rows.push(['kw' + i, 'cat' + (i % 5), '', categories[i] == null ? '' : categories[i], '', '', accounts[i] == null ? '' : accounts[i]]);
  }
  return new Sheet(rows);
}

// ---------------------------------------------------------------- 1. getCategories_
function testRead() {
  const sheet = new Sheet([
    ['交易關鍵字', '種類', '', '種類清單'],
    ['a', 'x', '', '  飲食 '],
    ['b', 'x', '', ''],
    ['c', 'x', '', '交通'],
    ['d', 'x', '', 'Food'],
    ['e', 'x', '', 'food'],
    ['f', 'x', '', '飲食'],
    ['g', 'x', '', '娛樂']
  ]);
  const server = loadServer(sheet);
  assert.deepStrictEqual(list(server.getCategories_()), ['飲食', '交通', 'Food', '娛樂'],
    '(1) row order, trimmed, blanks skipped, duplicates removed case-insensitively');

  sheet.reads = [];
  let opened = 0;
  server.getSpreadsheet_ = () => { opened++; return { getSheetByName: () => null }; };
  assert.deepStrictEqual(list(server.getCategories_({ getSheetByName: n => n === 'META' ? sheet : null })), ['飲食', '交通', 'Food', '娛樂'],
    '(1) the passed spreadsheet gives the same list');
  assert.strictEqual(opened, 0, '(1) nothing is opened again when a spreadsheet is passed');
  assert.deepStrictEqual(sheet.reads, [[1, 4, sheet.getLastRow(), 1]], '(1) header and names come from one read of column D');

  const other = new Sheet([['a', 'b', '', '別的'], ['', '', '', 'x']]);
  assert.deepStrictEqual(list(server.getCategories_({ getSheetByName: () => other })), [], '(1) another header in D is not a category list');
  assert.deepStrictEqual(list(server.getCategories_({ getSheetByName: () => new Sheet([['a'], ['b']]) })), [], '(1) a META narrower than D has none');
  assert.deepStrictEqual(list(server.getCategories_({ getSheetByName: () => null })), [], '(1) no META sheet, no categories');
}

// ---------------------------------------------------------------- 2. addCategory
function testAdd() {
  const sheet = metaSheet(['飲食', '交通', 'Cafe'], 40);
  const server = loadServer(sheet);
  const rowsBefore = sheet.getLastRow();

  assert.throws(() => server.addCategory('   '), /請輸入類別名稱/, '(2) empty input is rejected');
  assert.throws(() => server.addCategory('長'.repeat(21)), /類別名稱不可超過 20 字/, '(2) over 20 characters is rejected');
  assert.deepStrictEqual(sheet.writes, [], '(2) rejected input writes nothing');

  assert.deepStrictEqual(list(server.addCategory('  寵物  ')), ['飲食', '交通', 'Cafe', '寵物'], '(2) trimmed and appended');
  assert.strictEqual(sheet.rows[4][D], '寵物', '(2) written into the first D cell after the last non-blank one (row 5), not after A:B');
  assert.deepStrictEqual(sheet.writes, [{ row: 5, col: 4, numRows: 1, numCols: 1 }], '(2) exactly one D cell is written');
  assert.strictEqual(sheet.getLastRow(), rowsBefore, '(2) no row is added');
  assert.strictEqual(server.flushes(), 1, '(2) flushed once');

  sheet.writes = [];
  assert.deepStrictEqual(list(server.addCategory(' cafe ')), ['飲食', '交通', 'Cafe', '寵物'], '(2) a case-insensitive duplicate returns the current list');
  assert.deepStrictEqual(sheet.writes, [], '(2) and writes nothing');
  assert.ok(server.addCategory('長'.repeat(20)), '(2) exactly 20 characters is accepted');

  const wrong = new Sheet([['交易關鍵字', '種類', '', '別的']]);
  assert.throws(() => loadServer(wrong).addCategory('x'), /META!D/, '(2) another header in D1 is not overwritten');
  assert.deepStrictEqual(wrong.writes, [], '(2) and nothing is written');

  const blank = new Sheet([['交易關鍵字', '種類'], ['a', 'x'], ['b', 'y']]);
  assert.deepStrictEqual(list(loadServer(blank).addCategory('飲食')), ['飲食'], '(2) a blank D1 gets the header');
  assert.strictEqual(blank.rows[0][D], '種類清單');
  assert.strictEqual(blank.rows[1][D], '飲食');

  const none = { getSheetByName: () => null };
  const s2 = loadServer(new Sheet([]));
  s2.getSpreadsheet_ = () => none;
  assert.throws(() => s2.addCategory('x'), /找不到 META 工作表/, '(2) missing META throws');
}

// ---------------------------------------------------------------- 3. setCategoryOrder
function testReorder() {
  const cats = ['飲食', '交通', '娛樂', '購物'];
  const fresh = () => { const sheet = metaSheet(cats, 20); return { sheet, server: loadServer(sheet) }; };

  const { sheet, server } = fresh();
  assert.deepStrictEqual(list(server.setCategoryOrder(['交通', '飲食', '購物', '娛樂'])), ['交通', '飲食', '購物', '娛樂'],
    '(3) a valid permutation returns the new list');
  assert.deepStrictEqual(column(sheet, D).slice(0, 6), ['種類清單', '交通', '飲食', '購物', '娛樂', ''], '(3) D holds the new order');
  assert.deepStrictEqual(sheet.writes, [{ row: 2, col: 4, numRows: 4, numCols: 1 }], '(3) only D rows 2..last non-blank are written');

  const bad = {
    missing: ['飲食', '交通', '娛樂'],
    extra: ['飲食', '交通', '娛樂', '購物', '寵物'],
    duplicated: ['飲食', '交通', '娛樂', '飲食'],
    foreign: ['飲食', '交通', '娛樂', '寵物'],
    'case duplicate': ['飲食', '交通', '娛樂', ' 飲食 '],
    'not a list': '飲食'
  };
  Object.keys(bad).forEach(name => {
    const f = fresh();
    const before = f.sheet.rows.map(r => r.slice());
    assert.throws(() => f.server.setCategoryOrder(bad[name]), /類別清單已變更/, '(3) ' + name + ' entry throws in Traditional Chinese');
    assert.deepStrictEqual(f.sheet.rows, before, '(3) ' + name + ': the sheet is unchanged');
    assert.deepStrictEqual(f.sheet.writes, [], '(3) ' + name + ': nothing is written');
  });

  // Gaps and hand-entered duplicates in D are compacted; the stored spelling is kept.
  const gappy = new Sheet([
    ['交易關鍵字', '種類', '', '種類清單'],
    ['a', 'x', '', 'Food'],
    ['b', 'x', '', ''],
    ['c', 'x', '', '交通'],
    ['d', 'x', '', 'food'],
    ['e', 'x', '', ''],
    ['f', 'x', '', '']
  ]);
  const g = loadServer(gappy);
  assert.deepStrictEqual(list(g.setCategoryOrder(['交通', ' FOOD '])), ['交通', 'Food'], '(3) trimmed, matched case-insensitively, stored spelling kept');
  assert.deepStrictEqual(column(gappy, D), ['種類清單', '交通', 'Food', '', '', '', ''], '(3) gaps and duplicate copies compacted');
  assert.deepStrictEqual(gappy.writes, [{ row: 2, col: 4, numRows: 4, numCols: 1 }], '(3) rows 2..5: up to the old last non-blank D row only');

  const noHeader = new Sheet([['交易關鍵字', '種類', '', '']]);
  assert.throws(() => loadServer(noHeader).setCategoryOrder([]), /META!D/, '(3) no D header throws');
}

// ---------------------------------------------------------------- 4. shared-row safety
function testSharedRows() {
  const sheet = metaSheet(['飲食', '交通', '娛樂'], 348);
  const server = loadServer(sheet);
  const before = sheet.rows.map(r => r.slice());
  const rowCount = sheet.getLastRow();

  server.addCategory('寵物');
  server.setCategoryOrder(['寵物', '娛樂', '飲食', '交通']);

  assert.strictEqual(sheet.getLastRow(), rowCount, '(4) the row count is unchanged');
  sheet.rows.forEach((row, r) => {
    const width = Math.max(row.length, before[r].length);
    for (let c = 0; c < width; c++) {
      if (c === D) continue;
      assert.strictEqual(row[c] == null ? '' : row[c], before[r][c] == null ? '' : before[r][c],
        '(4) cell row ' + (r + 1) + ' col ' + (c + 1) + ' is unchanged');
    }
  });
  assert.ok(sheet.writes.every(w => w.col === 4 && w.numCols === 1), '(4) every write is confined to column D');
  assert.deepStrictEqual(column(sheet, D).slice(0, 6), ['種類清單', '寵物', '娛樂', '飲食', '交通', ''], '(4) D holds the result');
}

// ---------------------------------------------------------------- 5. client ordering
function testClient() {
  const fns = loadFns(['distinctCats', 'realCats'], {
    CATEGORY_LIST: ['飲食', '交通', '娛樂', '購物', '超市', '個人', '醫療', '家居', '旅遊', '投資', '其他', '汽車', '重機', '房屋', '結婚', '禮金'],
    TXNS: [{ cat: '交通' }, { cat: '飲食' }, { cat: '禮金' }, { cat: '' }, { cat: '未分類' }]
  });
  assert.deepStrictEqual(list(fns.distinctCats()),
    ['未分類', '飲食', '交通', '娛樂', '購物', '超市', '個人', '醫療', '家居', '旅遊', '投資', '其他', '汽車', '重機', '房屋', '結婚', '禮金'],
    '(5) 未分類 first, then META!D order; 投資 is offered with no row using it');

  fns.CATEGORY_LIST = ['交通', '未分類', '飲食'];
  fns.TXNS = [{ cat: '飲食' }, { cat: 'Zoo' }, { cat: '寵物' }, { cat: 'Apple' }, { cat: '交通' }];
  assert.deepStrictEqual(list(fns.distinctCats()), ['未分類', '交通', '飲食', 'Apple', 'Zoo', '寵物'],
    '(5) unknown transaction categories follow in code-point order; 未分類 is never repeated');
  assert.deepStrictEqual(list(fns.realCats()), ['交通', '飲食', 'Apple', 'Zoo', '寵物'], '(5) realCats drops only 未分類');

  fns.CATEGORY_LIST = [];
  fns.TXNS = [{ cat: '飲食' }, { cat: '交通' }];
  assert.deepStrictEqual(list(fns.distinctCats()), ['未分類', '交通', '飲食'], '(5) with no META!D list, the old derived order remains');

  // The Settings list: a drag handle per row, every handle disabled while a save is in flight.
  const el = { innerHTML: '', className: '' };
  const toasts = [], statuses = [];
  let failure = null, success = null, sent = null, renders = 0;
  const ui = loadFns(['settingsCategories', 'renderSettingsCategories', 'saveCategoryOrder', 'focusedCategory', 'focusCategory', 'categoryHandle'], {
    CATEGORY_LIST: ['飲食', '交通', '娛樂'],
    CATEGORY_SHOWN: null,
    CATEGORY_SAVE_PENDING: false,
    esc: s => String(s),
    document: { activeElement: null, getElementById: id => id === 'settings-category-list' ? el : null },
    setSettingsStatus: kind => statuses.push(kind),
    toast: (msg, bad) => toasts.push([msg, !!bad]),
    render: () => { renders++; },
    google: { script: { run: {
      withSuccessHandler(f) { success = f; return this; },
      withFailureHandler(f) { failure = f; return this; },
      setCategoryOrder(l) { sent = Array.from(l); }
    } } }
  });
  const handles = () => el.innerHTML.match(/<button [^>]*class="settings-handle"[^>]*>/g) || [];

  ui.renderSettingsCategories();
  assert.strictEqual(handles().length, 3, '(5) one handle per category');
  ['飲食', '交通', '娛樂'].forEach((name, i) => {
    assert.ok(new RegExp('<button type="button" class="settings-handle" data-cat-idx="' + i + '" aria-label="拖曳排序 ' + name + '，或按上下鍵移動">').test(el.innerHTML),
      '(5) ' + name + ' has a <button> handle labelled for drag and ↑/↓');
  });
  assert.ok(handles().every(h => !/ disabled/.test(h)), '(5) handles are enabled at rest');
  assert.ok(!/上移|下移|data-cat-move/.test(el.innerHTML), '(5) no ↑/↓ buttons remain');

  // With the icon helpers present each row gains a decorative tile between the handle and the
  // name. The handle stays the row's only focusable control.
  const iconEl = { innerHTML: '' };
  const iconUi = loadFns(['settingsCategories', 'renderSettingsCategories', 'catIcon', 'catTile'], {
    CATEGORY_LIST: ['飲食', '交通'], CATEGORY_SHOWN: null, CATEGORY_SAVE_PENDING: false,
    IC: { q: '<circle/>' }, CATEGORY_ICON: {},
    esc: s => String(s),
    document: { getElementById: id => id === 'settings-category-list' ? iconEl : null }
  });
  iconUi.renderSettingsCategories();
  ['飲食', '交通'].forEach((name, i) => {
    assert.ok(new RegExp('<button type="button" class="settings-handle" data-cat-idx="' + i + '" aria-label="拖曳排序 ' + name + '，或按上下鍵移動">[\\s\\S]*?</button><span class="ctile s30 neutral" aria-hidden="true">[\\s\\S]*?</span><span class="settings-name">' + name + '</span>').test(iconEl.innerHTML),
      '(5) ' + name + ': the handle keeps its markup and the tile sits before the name');
  });
  assert.strictEqual((iconEl.innerHTML.match(/<button /g) || []).length, 2, '(5) the tile adds no focusable control');
  assert.ok(!/tabindex/.test(iconEl.innerHTML), '(5) the tile is not focusable');

  ui.saveCategoryOrder(['交通', '飲食', '娛樂']);
  assert.deepStrictEqual(sent, ['交通', '飲食', '娛樂'], '(5) the full reordered list is sent');
  assert.ok(el.innerHTML.indexOf('交通') < el.innerHTML.indexOf('飲食'), '(5) the new order is drawn at once');
  assert.ok(handles().length === 3 && handles().every(h => / disabled>/.test(h)), '(5) every handle is disabled while the save is in flight');
  assert.deepStrictEqual(Array.from(ui.CATEGORY_LIST), ['飲食', '交通', '娛樂'], '(5) CATEGORY_LIST stays server-confirmed while in flight');
  failure({ message: '類別清單已變更，請重新整理後再排序' });
  assert.deepStrictEqual(toasts, [['類別清單已變更，請重新整理後再排序', true]], '(5) the server message is toasted');
  assert.deepStrictEqual(statuses, ['saving', 'err'], '(5) the status goes 儲存中… then 未儲存');
  assert.ok(el.innerHTML.indexOf('飲食') < el.innerHTML.indexOf('交通'), '(5) re-rendered from the last confirmed list');
  assert.strictEqual(ui.CATEGORY_SAVE_PENDING, false, '(5) the pending guard is cleared');
  assert.strictEqual(ui.CATEGORY_SHOWN, null, '(5) the optimistic order is dropped');
  assert.ok(handles().every(h => !/ disabled/.test(h)), '(5) handles are enabled again after the failure settles');
  assert.strictEqual(renders, 0, '(5) the pickers are not re-rendered on failure');

  ui.saveCategoryOrder(['娛樂', '飲食', '交通']);
  assert.ok(handles().every(h => / disabled>/.test(h)), '(5) disabled again for the next save');
  success(['娛樂', '飲食', '交通']);
  assert.deepStrictEqual(Array.from(ui.CATEGORY_LIST), ['娛樂', '飲食', '交通'], '(5) success adopts the server list');
  assert.strictEqual(renders, 1, '(5) success re-renders the pickers');
  assert.ok(handles().every(h => !/ disabled/.test(h)), '(5) handles are enabled again after the save settles');
  assert.strictEqual(statuses[statuses.length - 1], 'ok', '(5) the status ends on 已儲存');
}

const CASES = { testRead, testAdd, testReorder, testSharedRows, testClient };

function run() {
  Object.keys(CASES).forEach(n => CASES[n]());
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_category_order');
} else {
  module.exports = { run, CASES };
}
