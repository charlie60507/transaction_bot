'use strict';
/*
 * Dashboard writes do only the write, ticks coalesce, and the list is read once afterwards (#98).
 *
 * Server half, against the fixture sheet of dashboard_recent_ack with the REAL server functions:
 *   - updateTxns(items) writes several rows in one call, one item's failure neither blocks nor
 *     rolls back the others, a failed item writes nothing of its own, and every field lands in the
 *     same cell with the same error message as updateTxn. It reads the header and the 交易 ID
 *     column only (recorded getRange widths), never flushes, and never touches the id backfill,
 *     the snapshot or the recent acknowledgement.
 *   - deleteTxn({ id }) (dashboard path) answers { ok: true } after a delete and on a retry, and
 *     still throws 找不到 for a row in neither sheet; deleteTxn(id, held) (LINE path) keeps its
 *     three statuses.
 *   - getRecentTxns(olderFp) is a JSON string: the recent window when the fingerprint matches,
 *     the whole list otherwise, a bot row appended after load included, and nothing written.
 *
 * Client half, against the real ToolPanel.html functions with a recording google.script.run:
 * six rapid ticks cost two updateTxns calls and then one getRecentTxns read, same-row patches
 * merge with the later field winning, a failed item reverts only its own row, a whole-call
 * failure reverts every row in it, a stale read is dropped and re-booked, a tick during 整天記帳
 * lands in the next call, and a delete is a barrier. Every case checks the screen after each
 * delivered response, not only at the end.
 *
 * NOT evidence of live timings (p50, delete time, processes list) or of the phone check: those
 * are verified on the deployed dashboard after merge.
 */
process.env.TZ = 'Asia/Taipei';
const assert = require('assert');
const { loadFns } = require('./extract_panel');
const { loadServer, EditableSheet, txnRow, fixtureRows, HEADERS, wire } = require('./dashboard_recent_ack');

const ID_COL = HEADERS.indexOf('交易 ID') + 1;            // 1-based, as getRange takes it

function cell(sheet, rowId, idx) {
  const r = sheet.rows.find(x => x[ID_COL - 1] === rowId);
  return r ? r[idx] : undefined;
}
function snapshot(sheet) { return JSON.stringify(sheet.rows.map(r => r.map(v => v instanceof Date ? v.getTime() : v))); }

/** A server whose expensive helpers fail loudly if a write path ever reaches them. */
function guarded(sheet) {
  const server = loadServer(sheet);
  const counts = { flush: 0 };
  server.SpreadsheetApp = Object.assign({}, server.SpreadsheetApp, { flush: () => { counts.flush++; } });
  ['ensureRowIdColIndex_', 'txnSnapshot_', 'recentAck_', 'getAllTxns', 'readTxnSheet_'].forEach(name => {
    server[name] = function () { throw new Error(name + ' must not run on this path'); };
  });
  server.counts = counts;
  return server;
}
/** No read spans several rows AND several columns (the shape of a whole-sheet read): only single
 *  rows (the header, a row being copied) and single columns (交易 ID, one cell). */
function assertNarrow(sheet, label) {
  sheet.reads.forEach(r => {
    assert.ok(r.numRows === 1 || r.numCols === 1, label + ': read ' + JSON.stringify(r) + ' is one row or one column');
  });
}

// ---------------------------------------------------------------- server: updateTxns
function testUpdateTxnsServer() {
  // Cross-row batch: three rows, three fields, one call.
  const sheet = new EditableSheet(fixtureRows());
  const server = guarded(sheet);
  const res = wire(server.updateTxns([
    { id: 'w-1', patch: { posted: true } },
    { id: 'old-1', patch: { cat: '交通', merchant: '改名' } },
    { id: 'w-dup-1', patch: { posted: true, amount: 310 } }
  ]));
  assert.deepStrictEqual(res, { ok: true, results: [{ id: 'w-1', ok: true }, { id: 'old-1', ok: true }, { id: 'w-dup-1', ok: true }] },
    'every item is reported in item order, with no list');
  assert.strictEqual(cell(sheet, 'w-1', 0), true, 'w-1 is posted');
  assert.strictEqual(cell(sheet, 'old-1', 10), '交通', 'old-1 category in K');
  assert.strictEqual(cell(sheet, 'old-1', 5), '改名', 'old-1 merchant in F');
  assert.strictEqual(cell(sheet, 'w-dup-1', 4), 310, 'w-dup-1 amount in E');
  assert.strictEqual(server.counts.flush, 0, 'no flush');
  assertNarrow(sheet, 'updateTxns');
  assert.ok(sheet.reads.every(r => r.row === 1 || r.numCols === 1), 'updateTxns: below the header it reads single columns only');
  assert.strictEqual(sheet.reads.filter(r => r.row === 1).length, 1, 'the header is read once per call');
  assert.strictEqual(sheet.reads.filter(r => r.col === ID_COL && r.numRows > 1).length, 1, 'the 交易 ID column is read once per call');

  // Partial failure: the bad item writes nothing; the items around it are written.
  const sheet2 = new EditableSheet(fixtureRows());
  const server2 = guarded(sheet2);
  const before = cell(sheet2, 'old-1', 5);
  const res2 = wire(server2.updateTxns([
    { id: 'w-1', patch: { posted: true } },
    { id: 'old-1', patch: { merchant: '不該寫入', type: '亂寫' } },
    { id: 'nope', patch: { posted: true } },
    { id: 'w-150', patch: { cat: '交通' } }
  ]));
  assert.deepStrictEqual(res2.results, [
    { id: 'w-1', ok: true },
    { id: 'old-1', ok: false, error: '收支別不合法: 亂寫' },
    { id: 'nope', ok: false, error: '找不到該筆交易 (key=nope)' },
    { id: 'w-150', ok: true }
  ], 'per-item results, with updateTxn\'s messages');
  assert.strictEqual(cell(sheet2, 'old-1', 5), before, 'a failed item writes none of its fields (validated before any write)');
  assert.strictEqual(cell(sheet2, 'w-1', 0), true, 'the item before it is written');
  assert.strictEqual(cell(sheet2, 'w-150', 10), '交通', 'the item after it is written');

  // A call-level problem still throws.
  assert.throws(() => server2.updateTxns('w-1'), /陣列/, 'a non-array argument is rejected');

  // Per field, the destination cell and the message equal updateTxn's, on twin sheets.
  const transfer = txnRow('t-1', new Date('2026-09-28T04:00:00Z'), 'tr', 500, '7777', '轉帳列', { 9: '轉帳' });
  const income = txnRow('i-1', new Date('2026-09-28T05:00:00Z'), 'in', 900, '7777', '收入列', { 9: '收入' });
  const split = txnRow('s-1', new Date('2026-09-28T06:00:00Z'), 'sp', 700, '7777', '拆分列', { 11: 200 });
  function twin() {
    const rows = fixtureRows();
    rows.splice(rows.length - 1, 0, transfer.slice(), income.slice(), split.slice());
    return new EditableSheet(rows);
  }
  const cases = [
    ['w-1', { merchant: '新名稱' }], ['w-1', { cat: '' }], ['w-1', { cat: '交通' }],
    ['w-1', { type: '收入' }], ['w-1', { type: 'x' }],
    ['w-1', { amount: 99 }], ['w-1', { amount: 0 }], ['w-1', { amount: -3 }], ['i-1', { amount: 5 }],
    ['t-1', { amount: 450 }], ['s-1', { amount: 180 }],
    ['w-1', { mine: 40 }], ['w-1', { mine: '' }], ['w-1', { mine: -1 }], ['w-1', { mine: 'abc' }], ['t-1', { mine: 10 }],
    ['w-1', { posted: true }], ['w-1', { posted: false }],
    ['w-1', { posted: true, cat: '娛樂', merchant: '多欄' }]
  ];
  cases.forEach(([id, patch]) => {
    const a = twin(), b = twin();
    const single = loadServer(a), batch = loadServer(b);
    let singleErr = null;
    try { single.updateTxn(id, patch); } catch (e) { singleErr = e.message; }
    const r = wire(batch.updateTxns([{ id, patch }])).results[0];
    const label = id + ' ' + JSON.stringify(patch);
    if (singleErr) {
      assert.deepStrictEqual(r, { id, ok: false, error: singleErr }, label + ': the same message as updateTxn');
      assert.strictEqual(snapshot(b), snapshot(new EditableSheet(twin().rows)), label + ': and nothing written');
    } else {
      assert.deepStrictEqual(r, { id, ok: true }, label + ': succeeds as updateTxn does');
      assert.strictEqual(snapshot(b), snapshot(a), label + ': and writes exactly the cells updateTxn writes');
    }
  });

  // A mine edit on a sheet without the 我的消費 column creates it once, and both items use it.
  const noMineRows = fixtureRows().map(r => r.slice(0, 11).concat([r[12] === undefined ? '' : r[12]]));
  noMineRows[0] = HEADERS.slice(0, 11).concat(['交易 ID']);
  const noMine = new EditableSheet(noMineRows);
  const nm = loadServer(noMine);
  const nmRes = wire(nm.updateTxns([{ id: 'w-1', patch: { mine: 30 } }, { id: 'w-150', patch: { mine: 40 } }]));
  assert.ok(nmRes.results.every(r => r.ok), 'mine edits succeed on a sheet without the column');
  assert.strictEqual(noMine.rows[0].filter(h => h === '我的消費').length, 1, 'the header is created once');
  const mineIdx = noMine.rows[0].indexOf('我的消費');
  assert.strictEqual(noMine.rows.find(r => r[11] === 'w-1')[mineIdx], 30, 'the first item writes there');
  assert.strictEqual(noMine.rows.find(r => r[11] === 'w-150')[mineIdx], 40, 'and so does the second');

  // A sheet without the 交易 ID column keeps the legacy composite locate, same results shape.
  const legacyRows = fixtureRows().map(r => r.slice(0, 12));
  const legacy = new EditableSheet(legacyRows);
  const ls = loadServer(legacy, { noUuid: true });
  const key = wire(ls.getAllTxns()).find(t => t.merchant === '最近').id;
  const lres = wire(ls.updateTxns([{ id: key, patch: { posted: true } }, { id: 'x|1|2|3|0', patch: { posted: true } }]));
  assert.deepStrictEqual(lres.results.map(r => r.ok), [true, false], 'the legacy slow path answers per item');
  assert.strictEqual(legacy.rows.find(r => r[5] === '最近')[0], true, 'and writes the located row');
}

// ---------------------------------------------------------------- server: deleteTxn
function testDeleteServer() {
  const sheet = new EditableSheet(fixtureRows());
  const server = guarded(sheet);
  const deleted = server.getSpreadsheet_().getSheetByName('Deleted');
  const row = sheet.rows.find(r => r[ID_COL - 1] === 'w-150').slice();
  assert.deepStrictEqual(wire(server.deleteTxn({ id: 'w-150' })), { ok: true }, 'a dashboard delete answers { ok: true } with no list');
  assert.strictEqual(cell(sheet, 'w-150', 0), undefined, 'the row is gone from Transactions');
  assert.deepStrictEqual(wire(deleted.rows[deleted.rows.length - 1]), wire(row), 'and copied whole to Deleted');
  assert.strictEqual(server.counts.flush, 0, 'no flush on the dashboard path');
  assertNarrow(sheet, 'dashboard delete locate');
  assert.deepStrictEqual(wire(server.deleteTxn({ id: 'w-150' })), { ok: true }, 'a retry after the delete is ok, never 找不到');
  assert.throws(() => server.deleteTxn({ id: 'never-existed' }), /找不到該筆交易/, 'a row in neither sheet still throws');

  // The LINE path keeps its three statuses.
  const sheet2 = new EditableSheet(fixtureRows());
  const line = loadServer(sheet2);
  const ss = line.getSpreadsheet_();
  const held = { ss, sh: sheet2 };
  assert.strictEqual(line.deleteTxn('w-1', held), 'deleted', 'LINE: deleted');
  assert.strictEqual(line.deleteTxn('w-1', held), 'already-deleted', 'LINE: already-deleted');
  assert.strictEqual(line.deleteTxn('ghost', held), 'missing', 'LINE: missing');
  const deleted2 = ss.getSheetByName('Deleted');
  assert.ok(deleted2.rows.some(r => r[ID_COL - 1] === 'w-1'), 'LINE: the row is copied to Deleted');
}

// ---------------------------------------------------------------- server: getRecentTxns
function testRecentServer() {
  const sheet = new EditableSheet(fixtureRows());
  const server = loadServer(sheet);
  const boot = JSON.parse(server.getDashboardData());
  const writesBefore = sheet.writes.length;
  const before = snapshot(sheet);

  const match = server.getRecentTxns(boot.olderFp);
  assert.strictEqual(typeof match, 'string', 'the answer is a JSON string');
  const m = JSON.parse(match);
  assert.ok(m.ok && m.recent && !m.txns, 'a matching fingerprint gets the recent shape');
  assert.strictEqual(m.olderFp, boot.olderFp, 'with the same fingerprint');
  assert.ok(!('changed' in m), 'and no edited row');
  const full = wire(server.getAllTxns());
  assert.deepStrictEqual(m.recent.txns, full.filter(t => t.y * 10000 + t.m * 100 + t.d >= 20260918),
    'the window rows are the full list\'s own objects, in sheet order');

  const miss = JSON.parse(server.getRecentTxns('stale'));
  assert.deepStrictEqual(miss, { ok: true, txns: full, olderFp: boot.olderFp }, 'a stale fingerprint gets the whole list');
  assert.deepStrictEqual(JSON.parse(server.getRecentTxns(null)).txns, full, 'and so does none');

  // A bot row appended after load appears in the window.
  sheet.rows.splice(sheet.rows.length - 2, 0, txnRow('bot-new', new Date('2026-09-30T01:00:00Z'), 'z', 499, '9999', '新的機器人列'));
  const withBot = JSON.parse(server.getRecentTxns(boot.olderFp));
  assert.ok(withBot.recent.txns.some(t => t.rowId === 'bot-new'), 'a row the bot appended after load is in recent.txns');

  sheet.rows.splice(sheet.rows.findIndex(r => r[ID_COL - 1] === 'bot-new'), 1);
  assert.strictEqual(sheet.writes.length, writesBefore, 'getRecentTxns writes nothing');
  assert.strictEqual(snapshot(sheet), before, 'the sheet is unchanged');
}

// ---------------------------------------------------------------- client
function row(id, overrides) {
  return Object.assign({
    id: id + '|1000|120|1234|0', rowId: id, y: 2026, m: 8, d: 12, hm: '09:00', type: '支出',
    amount: 120, charged: 120, mine: null, cat: '飲食', merchant: id, bank: '富邦', last4: '1234',
    link: '', posted: false
  }, overrides || {});
}
const ROWS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'].map(id => row(id));

const PANEL_FNS = ['txnsSignature', 'adoptTxns', 'ackTxns', 'spliceAt', 'historyComplete', 'txnById', 'nextMutation', 'isStale',
  'settle', 'maybeRefresh', 'refreshTxns', 'focusKey', 'focusMatches', 'focusIndex', 'repaint', 'revertTxn', 'applyEdit',
  'ensureTextRowKey', 'textTxn', 'textRowKey', 'resolveTextRowId', 'rawDraftKey', 'draftKey',
  'textRowLineage', 'dropTextRowState', 'reconcileTextRowIds', 'preservePendingAddRows',
  'beginRowWrite', 'endRowWrite', 'enqueueRowWrite', 'enqueueRowWrites', 'rowWriteBlocked', 'pumpRowWrites',
  'finishRowWrite', 'sendRowDelete', 'sendRowPatches', 'resumeRowWrites', 'cancelRowWrites',
  'textDraft', 'draftValue', 'captureDraft', 'hasActiveComposition',
  'textWriteQueue', 'textInputMatches', 'syncTextCopies', 'nextTextRequestToken',
  'normalizedTextValue', 'issueTextSave', 'drainTextWrite', 'saveTextDraft', 'trySendRowCommit', 'commitRow',
  'applySplit', 'bulkPost', 'openDelModal', 'confirmDelete', 'cancelDeleteIntent', 'trySendDelete', 'closeDelModal',
  'chargedOf', 'isSplitTxn', 'fmt'];

function harness(initial) {
  const rec = { calls: [], deletes: [], reads: [] };
  const toasts = [];
  let pending = {};
  function take() { const p = pending; pending = {}; return p; }
  const run = {
    withSuccessHandler(f) { pending.success = f; return run; },
    withFailureHandler(f) { pending.failure = f; return run; },
    updateTxns(items) {
      const p = take();
      rec.calls.push({ items: wire(items), ids: Array.from(items, i => i.id), success: p.success, failure: p.failure });
    },
    deleteTxn(arg) { const p = take(); rec.deletes.push({ arg, success: p.success, failure: p.failure }); },
    getRecentTxns(fp) { const p = take(); rec.reads.push({ fp, success: p.success, failure: p.failure }); }
  };
  const node = () => ({ value: '', textContent: '', disabled: false, classList: { add() {}, remove() {} } });
  const nodes = {};
  const fns = loadFns(PANEL_FNS, {
    TXNS: initial.map(t => Object.assign({}, t)),
    MUTATION_SEQ: 0, INFLIGHT: 0, STALE_DROPPED: false, REFRESHING: false, OLDER_FP: null,
    HISTORY: { complete: true, before: null, loadedFp: null, loading: false, failed: null },
    TEXT_DRAFTS: {}, TEXT_DRAFT_REVISIONS: {}, TEXT_REQUEST_TOKENS: {}, TEXT_WRITE_QUEUES: {},
    TEXT_CANCEL_BLURS: {}, ROW_COMMIT_INTENTS: {}, ACTIVE_COMPOSITIONS: {}, PENDING_REPAINT: false,
    COMPOSITION_FLUSH_SCHEDULED: false, TEXT_ROW_SERIAL: 0, TEXT_REMOVED_ROW_KEYS: {},
    PENDING_ADD_ROWS: {}, ROW_ACTIVE_WRITES: {}, ROW_DELETE_INTENTS: {}, ROW_WRITE_QUEUE: { active: null, items: [] },
    pendingDelId: null, pendingDelRowKey: null, openSplit: null,
    google: { script: { run } },
    render() {}, toast(msg, isErr) { toasts.push({ msg, err: !!isErr }); }, setTimeout() { return 0; },
    document: { activeElement: null, querySelector: () => null, querySelectorAll: () => [],
      getElementById(id) { return nodes[id] || (nodes[id] = node()); } },
    window: { pageXOffset: 0, pageYOffset: 0, scrollTo() {} }
  });
  fns.rec = rec;
  fns.toasts = toasts;
  fns.get = id => fns.TXNS.find(t => t.rowId === id) || null;
  return fns;
}
function okAll(call) { call.success({ ok: true, results: call.items.map(i => ({ id: i.id, ok: true })) }); }
function sheetWith(changes) {
  return ROWS.map(t => Object.assign({}, t, changes[t.rowId] || {}));
}
function read(h, i, list) { h.rec.reads[i].success(JSON.stringify({ ok: true, txns: list, olderFp: 'fp' })); }
function quiet(h, label) {
  assert.strictEqual(h.INFLIGHT, 0, label + ': INFLIGHT returns to 0');
  assert.strictEqual(h.ROW_WRITE_QUEUE.active, null, label + ': nothing active');
  assert.strictEqual(h.ROW_WRITE_QUEUE.items.length, 0, label + ': nothing queued');
}
function posted(h, ids, label) { ids.forEach(id => assert.strictEqual(h.get(id).posted, true, label + ': ' + id + ' posted')); }

function testSixTicks() {
  const h = harness(ROWS);
  const six = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
  six.forEach(id => h.commitRow(id, true));
  posted(h, six, 'six ticks at tap time');
  assert.strictEqual(h.rec.calls.length, 1, 'six ticks: the first goes out alone');
  assert.deepStrictEqual(h.rec.calls[0].ids, ['r1'], 'six ticks: it is r1');
  okAll(h.rec.calls[0]);
  posted(h, six, 'six ticks after the first ack');
  assert.strictEqual(h.rec.calls.length, 2, 'six ticks: the other five leave together');
  assert.deepStrictEqual(h.rec.calls[1].ids, ['r2', 'r3', 'r4', 'r5', 'r6'], 'six ticks: in tap order');
  assert.strictEqual(h.rec.reads.length, 0, 'six ticks: no read while a write is out');
  okAll(h.rec.calls[1]);
  posted(h, six, 'six ticks after the second ack');
  assert.strictEqual(h.rec.calls.length, 2, 'six ticks: exactly 2 updateTxns calls');
  assert.strictEqual(h.rec.reads.length, 1, 'six ticks: then exactly 1 getRecentTxns');
  read(h, 0, sheetWith({ r1: { posted: true }, r2: { posted: true }, r3: { posted: true }, r4: { posted: true }, r5: { posted: true }, r6: { posted: true } }));
  posted(h, six, 'six ticks after the read');
  quiet(h, 'six ticks');
}

function testSameRowMerge() {
  const h = harness(ROWS);
  h.commitRow('r1', true);                                   // in flight
  h.applyEdit('r2', 'cat', '交通');
  h.applyEdit('r2', 'posted', true);
  h.applyEdit('r2', 'cat', '娛樂');                          // later field wins
  h.applyEdit('r3', 'posted', true);
  okAll(h.rec.calls[0]);
  const call = h.rec.calls[1];
  assert.deepStrictEqual(call.ids, ['r2', 'r3'], 'merge: one item per row, in first-queued order');
  assert.deepStrictEqual(call.items[0].patch, { cat: '娛樂', posted: true }, 'merge: same-row patches merge, later fields winning');
  okAll(call);
  assert.strictEqual(h.get('r2').cat, '娛樂', 'merge: the screen keeps the last value');
  assert.strictEqual(h.rec.reads.length, 1, 'merge: one read');
  read(h, 0, sheetWith({ r1: { posted: true }, r2: { cat: '娛樂', posted: true }, r3: { posted: true } }));
  quiet(h, 'merge');
}

function testPartialFailure() {
  const h = harness(ROWS);
  h.commitRow('r1', true);
  h.commitRow('r2', true);
  h.applyEdit('r3', 'cat', '交通');
  h.commitRow('r4', true);
  okAll(h.rec.calls[0]);
  const call = h.rec.calls[1];
  call.success({ ok: true, results: [{ id: 'r2', ok: true }, { id: 'r3', ok: false, error: '找不到該筆交易 (key=r3)' }, { id: 'r4', ok: true }] });
  assert.strictEqual(h.get('r3').cat, '飲食', 'partial: the failed row reverts');
  posted(h, ['r1', 'r2', 'r4'], 'partial: the rows that succeeded stay');
  assert.deepStrictEqual(h.toasts.filter(t => t.err).map(t => t.msg), ['寫入失敗:找不到該筆交易 (key=r3)'], 'partial: one failure toast, for that row');
  assert.strictEqual(h.rec.reads.length, 1, 'partial: one read');
  read(h, 0, sheetWith({ r1: { posted: true }, r2: { posted: true }, r4: { posted: true } }));
  posted(h, ['r1', 'r2', 'r4'], 'partial: after the read');
  quiet(h, 'partial');

  // A result whose id does not match the item is a failure, not a silent success.
  const m = harness(ROWS);
  m.commitRow('r1', true);
  m.rec.calls[0].success({ ok: true, results: [{ id: 'other', ok: true }] });
  assert.strictEqual(m.get('r1').posted, false, 'a mismatched result reverts its row');
}

function testWholeCallFailure() {
  const h = harness(ROWS);
  h.commitRow('r1', true);
  h.commitRow('r2', true);
  h.applySplit('r3', '50');
  okAll(h.rec.calls[0]);
  h.rec.calls[1].failure(new Error('逾時'));
  assert.strictEqual(h.get('r1').posted, true, 'whole-call: the earlier call stays');
  assert.strictEqual(h.get('r2').posted, false, 'whole-call: r2 reverts');
  assert.strictEqual(h.get('r3').mine, null, 'whole-call: r3 reverts');
  assert.strictEqual(h.get('r3').amount, 120, 'whole-call: r3 amount reverts');
  assert.strictEqual(h.rec.reads.length, 1, 'whole-call: one read');
  read(h, 0, sheetWith({ r1: { posted: true } }));
  quiet(h, 'whole-call');
}

function testStaleRead() {
  const h = harness(ROWS);
  h.commitRow('r1', true);
  okAll(h.rec.calls[0]);
  assert.strictEqual(h.rec.reads.length, 1, 'stale: the read goes out');
  h.commitRow('r2', true);
  read(h, 0, sheetWith({ r1: { posted: true } }));        // predates r2's write
  posted(h, ['r1', 'r2'], 'stale: a superseded read is dropped');
  assert.strictEqual(h.STALE_DROPPED, true, 'stale: and re-booked');
  assert.strictEqual(h.rec.reads.length, 1, 'stale: not re-issued while r2 is out');
  okAll(h.rec.calls[1]);
  assert.strictEqual(h.rec.reads.length, 2, 'stale: re-issued once r2 lands');
  read(h, 1, sheetWith({ r1: { posted: true }, r2: { posted: true } }));
  posted(h, ['r1', 'r2'], 'stale: converged');
  assert.strictEqual(h.STALE_DROPPED, false, 'stale: no debt left');
  quiet(h, 'stale');
}

function testTickDuringBulk() {
  const h = harness(ROWS);
  h.bulkPost(['r1|1000|120|1234|0', 'r2|1000|120|1234|0', 'r3|1000|120|1234|0']);
  assert.strictEqual(h.rec.calls.length, 1, 'bulk: one call');
  assert.deepStrictEqual(h.rec.calls[0].ids, ['r1', 'r2', 'r3'], 'bulk: holding every row');
  h.commitRow('r4', true);
  posted(h, ['r1', 'r2', 'r3', 'r4'], 'bulk: at tap time');
  h.rec.calls[0].success({ ok: true, results: [{ id: 'r1', ok: true }, { id: 'r2', ok: false, error: 'x' }, { id: 'r3', ok: true }] });
  assert.strictEqual(h.get('r2').posted, false, 'bulk: the failed row reverts');
  posted(h, ['r1', 'r3', 'r4'], 'bulk: after the bulk ack');
  assert.deepStrictEqual(h.toasts.slice(-1)[0], { msg: '完成 2/3 · 1 筆寫入失敗', err: true }, 'bulk: the summary counts per-item results');
  assert.strictEqual(h.rec.calls.length, 2, 'bulk: the tick goes in the next call');
  assert.deepStrictEqual(h.rec.calls[1].ids, ['r4'], 'bulk: it is r4');
  okAll(h.rec.calls[1]);
  posted(h, ['r1', 'r3', 'r4'], 'bulk: after the tick ack');
  assert.strictEqual(h.rec.reads.length, 1, 'bulk: one read after both');
  read(h, 0, sheetWith({ r1: { posted: true }, r3: { posted: true }, r4: { posted: true } }));
  posted(h, ['r1', 'r3', 'r4'], 'bulk: after the read');
  quiet(h, 'bulk');
}

function testDeleteBarrier() {
  const h = harness(ROWS);
  h.commitRow('r1', true);                                   // in flight
  h.commitRow('r2', true);                                   // queued
  h.openDelModal('r5'); h.confirmDelete();                   // queued after r2
  h.commitRow('r3', true);                                   // queued after the delete
  okAll(h.rec.calls[0]);
  assert.deepStrictEqual(h.rec.calls[1].ids, ['r2'], 'barrier: the patch before the delete leaves alone');
  assert.strictEqual(h.rec.deletes.length, 0, 'barrier: the delete waits');
  okAll(h.rec.calls[1]);
  assert.strictEqual(h.rec.deletes.length, 1, 'barrier: then the delete');
  assert.strictEqual(h.rec.deletes[0].arg.id, 'r5', 'barrier: under the row id');
  assert.strictEqual(h.rec.calls.length, 2, 'barrier: the patch after it waits');
  h.rec.deletes[0].success({ ok: true });
  assert.strictEqual(h.get('r5'), null, 'barrier: the row leaves');
  assert.deepStrictEqual(h.rec.calls[2].ids, ['r3'], 'barrier: then the patch after it');
  assert.strictEqual(h.rec.reads.length, 0, 'barrier: no read while r3 is out');
  okAll(h.rec.calls[2]);
  assert.strictEqual(h.rec.reads.length, 1, 'barrier: one read at the end');
  read(h, 0, sheetWith({ r1: { posted: true }, r2: { posted: true }, r3: { posted: true } }).filter(t => t.rowId !== 'r5'));
  posted(h, ['r1', 'r2', 'r3'], 'barrier: converged');
  assert.strictEqual(h.get('r5'), null, 'barrier: the deleted row does not return');
  quiet(h, 'barrier');
}

function run() {
  testUpdateTxnsServer();
  testDeleteServer();
  testRecentServer();
  testSixTicks();
  testSameRowMerge();
  testPartialFailure();
  testWholeCallFailure();
  testStaleRead();
  testTickDuringBulk();
  testDeleteBarrier();
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_write_batch');
} else {
  module.exports = { run };
}
