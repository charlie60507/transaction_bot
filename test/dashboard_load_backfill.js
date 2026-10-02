'use strict';
/*
 * #62: getDashboardData and getTxnsBefore no longer call ensureRowIdColIndex_ (two narrow column
 * reads, then the full read again). They read the sheet ONCE through getDataRange and backfill
 * missing 交易 IDs from that read (readTxnsForLoad_):
 *   (a) nothing missing → no write, no flush, exactly one full-width read and nothing narrower;
 *   (b) a displayed row missing its id → one write of that cell, one flush, both before the lock
 *       is released; the returned rowId is the written id, and the fingerprint getDashboardData
 *       hands out already covers it, so getTxnsBefore answers with the older-rows shape;
 *   (c) no 交易 ID header → ensureRowIdColIndex_ creates and backfills it, then the sheet is re-read;
 *   (d) no Utilities.getUuid (offline) → nothing written, rowIdIdx still from the header.
 */
process.env.TZ = 'Asia/Taipei';
const assert = require('assert');
const { loadServer, EditableSheet, wire } = require('./dashboard_recent_ack');
const { fixtureRows } = require('./dashboard_history_split');

const ID_COL = 13;   // 1-based column of 交易 ID in the fixtures

/** The server on `rows`, with flushes and lock releases recorded in one event log alongside the
 *  sheet's writes, so their ORDER can be asserted. */
function setup(rows, opts) {
  const sheet = new EditableSheet(rows);
  const server = loadServer(sheet, opts);
  const events = [];
  const setValues = sheet.getRange.bind(sheet);
  sheet.getRange = function (row, col, numRows, numCols) {
    const range = setValues(row, col, numRows, numCols);
    const write = range.setValues;
    range.setValues = function (values) { events.push('write'); return write.call(range, values); };
    range.setValue = function (value) { return range.setValues([[value]]); };
    return range;
  };
  server.SpreadsheetApp = Object.assign({}, server.SpreadsheetApp, { flush: () => events.push('flush') });
  server.LockService = { getScriptLock: () => ({ waitLock() { events.push('lock'); }, releaseLock() { events.push('release'); } }) };
  return { sheet, server, events };
}

const fullWidth = sheet => ({ row: 1, col: 1, numRows: sheet.getLastRow(), numCols: sheet.getLastColumn() });

function testNothingMissing() {
  const { sheet, server, events } = setup(fixtureRows('asc'));
  const first = JSON.parse(server.getDashboardData({ sinceMonths: 13 }));
  assert.deepStrictEqual(sheet.writes, [], '(a) getDashboardData writes nothing');
  assert.deepStrictEqual(sheet.reads, [fullWidth(sheet)], '(a) getDashboardData makes exactly one read: the whole sheet, header included');
  sheet.reads = [];
  const rest = JSON.parse(server.getTxnsBefore(first.before.y, first.before.m, first.loadedFp));
  assert.ok(rest.older, 'precondition: the older-rows shape');
  assert.deepStrictEqual(sheet.writes, [], '(a) getTxnsBefore writes nothing');
  assert.deepStrictEqual(sheet.reads, [fullWidth(sheet)], '(a) getTxnsBefore makes exactly one read: the whole sheet, header included');
  sheet.reads = [];
  JSON.parse(server.getDashboardData());
  assert.deepStrictEqual(sheet.reads, [fullWidth(sheet)], '(a) the whole-list boot makes exactly one read too');
  assert.strictEqual(events.filter(e => e === 'flush').length, 0, '(a) no flush');
}

function testOneMissing() {
  // A recent row (inside the 13 months) and, separately, an older row.
  [['cathay-new', 'recent'], ['nf-3', 'older']].forEach(([msg, side]) => {
    const rows = fixtureRows('asc');
    const at = rows.findIndex(r => r[8] === msg);
    rows[at][12] = '';
    const { sheet, server, events } = setup(rows);
    const first = JSON.parse(server.getDashboardData({ sinceMonths: 13 }));
    assert.deepStrictEqual(wire(sheet.writes), [{ row: at + 1, col: ID_COL, numRows: 1, numCols: 1, values: [['uuid-1']] }],
      '(b ' + side + ') exactly the missing cell is written, nothing else in the column');
    assert.deepStrictEqual(wire(events), ['lock', 'write', 'flush', 'release'], '(b ' + side + ') write, then flush, both inside the lock');
    assert.strictEqual(sheet.rows[at][12], 'uuid-1', '(b ' + side + ') the sheet holds the id');
    assert.strictEqual(sheet.reads.filter(r => r.numRows > 1).length, 1, '(b ' + side + ') still one data read');
    if (side === 'recent') {
      const t = first.txns.find(x => x.merchant === '彙整0' && x.id.indexOf('cathay-new|') === 0);
      assert.strictEqual(t.rowId, 'uuid-1', '(b) the returned rowId is the id that was written');
    } else {
      assert.ok(!first.txns.some(x => x.id.indexOf('nf-3|') === 0), 'precondition: the older row is not in the recent list');
    }
    // The fingerprint handed out was computed AFTER the id was patched in, so the next call matches.
    events.length = 0;
    const rest = JSON.parse(server.getTxnsBefore(first.before.y, first.before.m, first.loadedFp));
    assert.ok(rest.older && !rest.txns, '(b ' + side + ') getDashboardData\'s loadedFp matches getTxnsBefore: the older-rows shape, not the whole list');
    assert.strictEqual(sheet.writes.length, 1, '(b ' + side + ') nothing more to write');
    assert.ok(events.indexOf('flush') < 0, '(b ' + side + ') and no flush');
    if (side === 'older') {
      assert.strictEqual(rest.older.find(x => x.id.indexOf('nf-3|') === 0).rowId, 'uuid-1', '(b older) the older row carries the written id');
    }
  });

  // A run of adjacent missing rows is written as one range; a gap splits it.
  const rows = fixtureRows('asc');
  const run = rows.map((r, i) => r[8] === 'cathay-win' ? i : -1).filter(i => i >= 0);
  assert.deepStrictEqual(run.length, 2, 'precondition: two adjacent rows');
  assert.strictEqual(run[1], run[0] + 1, 'precondition: adjacent');
  run.forEach(i => { rows[i][12] = ''; });
  const lone = rows.findIndex(r => r[8] === 'nf-3');
  rows[lone][12] = '';
  const blank = rows.findIndex(r => r[8] === 'blank');
  const { sheet, server } = setup(rows);
  JSON.parse(server.getDashboardData());
  assert.deepStrictEqual(wire(sheet.writes), [
    { row: lone + 1, col: ID_COL, numRows: 1, numCols: 1, values: [['uuid-1']] },
    { row: run[0] + 1, col: ID_COL, numRows: 2, numCols: 1, values: [['uuid-2'], ['uuid-3']] }
  ], '(b) one write per run of missing cells, ids in sheet order');
  assert.strictEqual(sheet.rows[blank][12], '', '(b) a row that is not displayed gets no id');
}

function testMissingHeader() {
  const rows = fixtureRows('asc').map(r => r.slice(0, 12));
  const { sheet, server, events } = setup(rows);
  const first = JSON.parse(server.getDashboardData({ sinceMonths: 13 }));
  assert.deepStrictEqual(wire(sheet.writes[0]), { row: 1, col: ID_COL, numRows: 1, numCols: 1, values: [['交易 ID']] }, '(c) the header is created');
  assert.strictEqual(sheet.writes.length, 2, '(c) then the column is backfilled in one write');
  assert.ok(events.indexOf('flush') > 0 && events.indexOf('flush') < events.indexOf('release'), '(c) and flushed inside the lock');
  const wide = sheet.reads.filter(r => r.row === 1 && r.numRows > 1);
  assert.deepStrictEqual(wide.map(r => r.numCols), [12, 13], '(c) the sheet is read again after the column exists');
  assert.ok(first.txns.length && first.txns.every(t => /^uuid-\d+$/.test(t.rowId)), '(c) every returned row carries its new id');
  const rest = JSON.parse(server.getTxnsBefore(first.before.y, first.before.m, first.loadedFp));
  assert.ok(rest.older, '(c) and the next getTxnsBefore matches its fingerprint');
  assert.ok(rest.older.every(t => /^uuid-\d+$/.test(t.rowId)), '(c) the older rows were backfilled too');
}

function testNoUuid() {
  const rows = fixtureRows('asc');
  const at = rows.findIndex(r => r[8] === 'cathay-new');
  rows[at][12] = '';
  const { sheet, server, events } = setup(rows, { noUuid: true });
  const whole = JSON.parse(server.getDashboardData());
  assert.deepStrictEqual(sheet.writes, [], '(d) nothing written without getUuid');
  assert.ok(events.indexOf('flush') < 0, '(d) no flush');
  const missing = whole.txns.filter(t => t.rowId === '');
  assert.strictEqual(missing.length, 1, '(d) the row without an id keeps an empty rowId');
  assert.ok(whole.txns.filter(t => t.rowId).length === whole.txns.length - 1, '(d) every other row reads its id: rowIdIdx comes from the header');

  // And without the header: still nothing written, every rowId empty (the legacy composite path).
  const legacy = setup(fixtureRows('asc').map(r => r.slice(0, 12)), { noUuid: true });
  const legacyWhole = JSON.parse(legacy.server.getDashboardData());
  assert.deepStrictEqual(legacy.sheet.writes, [], '(d) no header, no getUuid: nothing written');
  assert.ok(legacyWhole.txns.every(t => t.rowId === ''), '(d) and no row has an id');
}

const CASES = { testNothingMissing, testOneMissing, testMissingHeader, testNoUuid };

function run() {
  Object.keys(CASES).forEach(n => CASES[n]());
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_load_backfill');
} else {
  module.exports = { run, CASES };
}
