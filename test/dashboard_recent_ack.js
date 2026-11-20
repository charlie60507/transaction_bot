'use strict';
/*
 * The incremental acknowledgement (#57), and since #98 the read-only refresh built from the same
 * pieces. updateTxn(id, patch, 'recent', olderFp) still returns the rows dated in the last 14
 * days (CFG.TZ) plus the edited row for a tab opened before the deploy; the page itself now
 * writes through updateTxns (no list in the response) and then reads getRecentTxns(olderFp)
 * once its queue has drained, which returns the window rows when `olderFp` (the server's
 * fingerprint of the rows older than the window, as the page last received them) still matches
 * the sheet, and the whole list otherwise.
 *
 * The contract being pinned is the owner's: after an edit the page must show exactly what a full
 * reload would show — same rows, values and order — including rows the bot appended since the
 * page loaded, and older rows changed anywhere else. So every client case below runs the REAL
 * applyEdit against the REAL updateTxns and getRecentTxns on a fixture sheet, mutates the sheet
 * the way the case describes, and compares the merged TXNS with a fresh getDashboardData() on
 * the same sheet. Each case also pins WHICH shape the read came back in, so "small in the common
 * case" is checked too. The fingerprint is compared with the sheet AFTER the page's writes, so
 * the page's own edit or delete of a row older than the window costs one whole list (#98).
 *
 * NOT evidence about the deployed dashboard: that needs the live sheet.
 */
// The Apps Script project's timezone (appsscript.json). addTxn reads dates in it.
process.env.TZ = 'Asia/Taipei';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction, loadFns } = require('./extract_panel');
const { Sheet } = require('./dashboard_txn_read');

const SERVER = path.resolve(__dirname, '..', 'sidebar', '程式碼.js');
const HEADERS = [
  '已記帳', '銀行', '授權日期時間', '卡末四碼', '金額_NTD', '交易內容/商店', '類別',
  'Gmail連結', 'MessageId', '收支別', '種類(手動)', '我的消費', '交易 ID'
];
const CFG = {
  DATA_SHEET: 'Transactions', DELETED_SHEET: 'Deleted', TZ: 'Asia/Taipei', HDR_MINE: '我的消費', HDR_ROW_ID: '交易 ID',
  IDX_POSTED: 0, IDX_BANK: 1, IDX_DATE: 2, IDX_LAST4: 3, IDX_AMOUNT: 4, IDX_MERCHANT: 5,
  IDX_CATEGORY_AUTO: 6, IDX_LINK: 7, IDX_MESSAGEID: 8, IDX_INOUT: 9, IDX_CATEGORY_MANUAL: 10
};
// 11:00 on 2 Oct 2026 in Taipei, so the window starts on 18 Sep 2026 (today minus 14 days).
const NOW = new Date('2026-10-02T03:00:00Z');
const SINCE = { y: 2026, m: 9, d: 18 };

class EditableSheet extends Sheet {
  getRange(row, col, numRows, numCols) {
    const range = super.getRange(row, col, numRows, numCols);
    range.getValue = function () { return range.getValues()[0][0]; };
    range.setNumberFormat = function () { return range; };
    range.setDataValidation = function () { return range; };
    return range;
  }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  insertRowBefore(row) { this.rows.splice(row - 1, 0, []); }
}

// Honours the timezone argument, so a window decided in the wrong zone shows up as a wrong row.
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

const SERVER_FNS = ['txnKey_', 'asTxnKey_', 'isDisplayedTxn_', 'getRowIdColIndex_', 'ensureRowIdColIndex_',
  'findRowByKey_', 'getAllTxns', 'txnsFromRows_', 'txnFromRow_', 'nextOccurrence_', 'rowYmdt_', 'recentSince_', 'recentAck_',
  'txnSnapshot_', 'snapshotOfRows_', 'rowDays_', 'olderFingerprint_', 'fingerprintCell_', 'renumbersOlderSiblings_', 'getDashboardData', 'deleteTxn', 'getOrCreateDeleted_', 'locateRowById_', 'recentWindow_', 'getRecentTxns', 'writeTxnPatch_', 'updateTxns',
  'rowCategory_', 'rowMine_', 'getMineColIndex_', 'ensureMineColIndex_', 'headerRow_', 'rowHM_', 'hmFromHms_',
  'isAmountCorrectionType_', 'updateTxn', 'addTxn', 'insertPositionForDate_', 'lastDataRow_', 'cellDateTime_',
  'sheetHasRowId_', 'sheetHasBaseKey_', 'monthsBackStart_', 'recentSnapshot_', 'txnsOnSide_', 'loadedFingerprint_',
  'getTxnsBefore', 'rowIdColIndexIn_', 'mineColIndexIn_', 'readTxnSheet_', 'readTxnsForLoad_', 'backfillRowIds_',
  'ymdtFormatter_', 'tzOffsetAt_', 'ymdtOnSide_', 'daysFromYmdts_'];

function loadServer(sheet, opts) {
  opts = opts || {};
  const src = fs.readFileSync(SERVER, 'utf8');
  const calls = { formatDate: 0 };
  const utilities = {
    formatDate: (date, tz, pattern) => { calls.formatDate++; return formatDate(date, tz, pattern); }
  };
  let uuidSeq = 0;
  if (!opts.noUuid) utilities.getUuid = () => 'uuid-' + (++uuidSeq);
  // `new Date()` is the server's clock (`clock.now`, movable by a test); every other Date use
  // (instanceof, parsing, Date.UTC) goes straight through to the real constructor so composite
  // keys stay byte-identical.
  const clock = { now: NOW.getTime() };
  const FixedDate = new Proxy(Date, {
    construct(target, args) { return args.length ? new target(...args) : new target(clock.now); }
  });
  const sheets = { Transactions: sheet, Deleted: new EditableSheet([HEADERS]) };
  const sandbox = {
    console, Date: FixedDate, CFG, Utilities: utilities,
    getSpreadsheet_: () => ({ getSheetByName: name => sheets[name] || null }),
    getAccountSources_: () => [],
    getCategories_: () => [],
    SpreadsheetApp: {
      flush: () => {},
      newDataValidation: () => ({ requireCheckbox() { return this; }, build: () => ({}) })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }
  };
  sandbox.clock = clock;
  vm.createContext(sandbox);
  vm.runInContext(SERVER_FNS.map(n => extractFunction(src, n)).join('\n'), sandbox);
  sandbox.calls = calls;
  return sandbox;
}

function row(fields) {
  const r = new Array(HEADERS.length).fill('');
  r[CFG.IDX_POSTED] = false;
  Object.keys(fields).forEach(k => { r[Number(k)] = fields[k]; });
  return r;
}
function txnRow(rowId, date, messageId, amount, last4, merchant, extra) {
  return row(Object.assign({ 1: '國泰', 2: date, 3: last4, 4: amount, 5: merchant, 8: messageId, 9: '支出', 10: '飲食', 12: rowId }, extra || {}));
}

// Sorted the way the bot leaves it (ASC by date, then MessageId). Google Sheets sorts a
// hand-typed TEXT date after every real date, so `txt-old` sits at the bottom although it is
// older than the window: the window is NOT a suffix of this list.
function fixtureRows() {
  return [
    HEADERS.slice(),
    txnRow('old-1', new Date('2026-08-01T04:00:00Z'), 'a', 100, '1111', '舊一'),
    // Same-day duplicates older than the window: one base key, occurrences 0 and 1.
    txnRow('old-dup-0', new Date('2026-09-05T02:00:00Z'), 'grp', 88, '1234', '舊重複一'),
    txnRow('old-dup-1', new Date('2026-09-05T02:00:00Z'), 'grp', 88, '1234', '舊重複二'),
    // 17 Sep 23:59 in Taipei — the last minute before the window.
    txnRow('bound-out', new Date('2026-09-17T15:59:00Z'), 'b', 50, '2222', '邊界外'),
    row({ 1: '玉山', 2: '', 4: 51, 5: '空白日期', 8: 'blank' }),
    // 18 Sep 00:00 in Taipei (still 17 Sep in UTC) — the first minute of the window.
    txnRow('bound-in', new Date('2026-09-17T16:00:00Z'), 'c', 60, '3333', '邊界內'),
    // Same-day duplicates inside the window, with a different-amount row of the same message
    // in between: two base keys interleaved.
    txnRow('w-dup-0', new Date('2026-09-25T04:00:00Z'), 'cathay', 300, '5678', '彙整一'),
    txnRow('w-150', new Date('2026-09-25T04:00:00Z'), 'cathay', 150, '5678', '彙整二'),
    txnRow('w-dup-1', new Date('2026-09-25T04:00:00Z'), 'cathay', 300, '5678', '彙整三'),
    txnRow('w-dup-2', new Date('2026-09-25T04:00:00Z'), 'cathay', 300, '5678', '彙整四'),
    txnRow('w-1', new Date('2026-10-01T05:00:00Z'), 'd', 120, '4444', '最近'),
    txnRow('txt-old', '2026-07-04T01:00:00Z', 'e', 70, '5555', '文字日期'),
    [false]
  ];
}

function wire(x) { return JSON.parse(JSON.stringify(x)); }
function ymdKey(t) { return t.y * 10000 + t.m * 100 + t.d; }
const SINCE_KEY = ymdKey(SINCE);

// What the page holds right after boot: getDashboardData() as it crosses the wire. The server
// sends it as a JSON string and the page parses it (#62).
function boot(server) { return JSON.parse(server.getDashboardData()); }
function shape(res) { return res.recent ? 'recent' : (res.txns ? 'full' : 'none'); }

// ---------------------------------------------------------------- server
function testServerWindow() {
  const sheet = new EditableSheet(fixtureRows());
  const server = loadServer(sheet);
  const fp0 = boot(server).olderFp;
  server.calls.formatDate = 0;
  const res = wire(server.updateTxn('w-1', { cat: '交通' }, 'recent', fp0));
  const formatsForAck = server.calls.formatDate;
  const full = wire(server.getAllTxns());

  assert.deepStrictEqual(Object.keys(res).sort(), ['changed', 'ok', 'olderFp', 'recent'], 'recent mode returns the incremental shape');
  assert.strictEqual(res.txns, undefined, 'recent mode does not ship the full list');
  assert.deepStrictEqual(res.recent.since, SINCE, 'since = today minus 14 days in CFG.TZ');
  assert.deepStrictEqual(res.recent.txns.map(t => t.rowId),
    ['bound-in', 'w-dup-0', 'w-150', 'w-dup-1', 'w-dup-2', 'w-1'],
    'exactly the rows dated on or after since, decided in CFG.TZ (00:00 in, 23:59 the day before out)');
  assert.deepStrictEqual(res.recent.txns, full.filter(t => ymdKey(t) >= SINCE_KEY),
    'window rows are the getAllTxns objects themselves, every field, in sheet order');
  assert.deepStrictEqual(res.changed, full.find(t => t.rowId === 'w-1'), 'changed is the edited row as getAllTxns maps it');
  assert.strictEqual(res.changed.cat, '交通', 'changed reflects the write');
  const olderBefore = res.recent.txns.map(t => full.slice(0, full.findIndex(f => f.rowId === t.rowId))
    .filter(f => ymdKey(f) < SINCE_KEY).length);
  assert.deepStrictEqual(res.recent.olderBefore, olderBefore, 'olderBefore counts the older rows preceding each window row');
  assert.deepStrictEqual(res.recent.olderBefore, [4, 4, 4, 4, 4, 4], 'txt-old trails the window in the sheet');
  // A constant number of formatDate calls per ack, whatever the number of rows (#62): one for
  // `since` and two to confirm the CFG.TZ offset (at now and at the earliest row); every row
  // dated 1980 or later is then formatted arithmetically. (Before #62 this was one call per row
  // past the coarse bound, 1 + 7 here.)
  assert.strictEqual(formatsForAck, 1 + 2, 'a constant number of formatDate calls per ack, none per row');
  const bigger = new EditableSheet(fixtureRows().slice(0, -1).concat(
    Array.from({ length: 40 }, (_, i) => txnRow('extra-' + i, new Date(Date.UTC(2026, 8, 20 + (i % 10), i % 24)), 'x' + i, 10 + i, '0000', '多' + i)), [[false]]));
  const biggerServer = loadServer(bigger);
  const biggerFp = boot(biggerServer).olderFp;
  biggerServer.calls.formatDate = 0;
  biggerServer.updateTxn('w-1', { cat: '交通' }, 'recent', biggerFp);
  assert.strictEqual(biggerServer.calls.formatDate, formatsForAck, 'forty more window rows cost no more formatDate calls');
  assert.strictEqual(res.olderFp, fp0, 'an edit inside the window leaves the older fingerprint as it was');
  assert.strictEqual(res.olderFp, boot(server).olderFp, 'the returned fingerprint describes the sheet as it now stands');
  const reads = sheet.reads.length;
  server.updateTxn('w-1', { cat: '餐飲' }, 'recent', res.olderFp);
  assert.deepStrictEqual(sheet.reads.slice(reads).filter(r => r.numRows > 1 && r.numCols > 1).length, 1,
    'one full-width read per incremental edit: the pre-write read is reused, the edited row read back alone');

  // An edited row older than the window comes back as `changed`, not inside the window.
  const older = wire(server.updateTxn('old-dup-1', { cat: '交通' }, 'recent', boot(server).olderFp));
  const fullAfter = wire(server.getAllTxns());
  assert.strictEqual(shape(older), 'recent', 'this tab\'s own edit of an older row does not force the whole list');
  assert.deepStrictEqual(older.changed, fullAfter.find(t => t.rowId === 'old-dup-1'),
    'an older edited row is returned whole, as getAllTxns maps it');
  assert.ok(!older.recent.txns.some(t => t.rowId === 'old-dup-1'), 'and it is not reported as a window row');
  assert.deepStrictEqual(older.recent.txns, fullAfter.filter(t => ymdKey(t) >= SINCE_KEY), 'the window is unchanged');
  assert.strictEqual(older.olderFp, boot(server).olderFp, 'and the fingerprint moves to the post-write older rows');
  assert.notStrictEqual(older.olderFp, fp0, 'which differ from before the write');

  // No fingerprint (a tab served before it existed) or a stale one: the whole list, with a fresh one.
  [undefined, null, 'stale'].forEach(fp => {
    const fallback = wire(server.updateTxn('w-1', { posted: true }, 'recent', fp));
    assert.deepStrictEqual(fallback, { ok: true, txns: wire(server.getAllTxns()), olderFp: boot(server).olderFp },
      'fingerprint ' + fp + ': the whole list and the current fingerprint');
  });

  // `true` keeps meaning the whole list.
  const legacyMode = wire(server.updateTxn('w-1', { posted: true }, true));
  assert.deepStrictEqual(legacyMode, { ok: true, txns: wire(server.getAllTxns()) }, 'true still returns the full list');

  // A sheet without the 交易 ID column cannot locate `changed` by identity: full list instead.
  const noIdRows = fixtureRows().map(r => r.slice(0, 12));
  const legacySheet = new EditableSheet(noIdRows);
  const legacy = loadServer(legacySheet, { noUuid: true });
  const legacyKey = wire(legacy.getAllTxns())[0].id;
  const legacyRes = wire(legacy.updateTxn(legacyKey, { cat: '交通' }, 'recent'));
  assert.deepStrictEqual(legacyRes, { ok: true, txns: wire(legacy.getAllTxns()) },
    'without 交易 ID the recent mode falls back to the full list');
}

function testFingerprintCoverage() {
  // Every cell of an older row is covered, no cell of a window row is, and neither is a row that
  // is not displayed: the fingerprint guards exactly the rows the page keeps on its own.
  const base = loadServer(new EditableSheet(fixtureRows()));
  const fp0 = boot(base).olderFp;
  assert.strictEqual(boot(base).olderFp, fp0, 'the fingerprint is deterministic');
  const olderAt = fixtureRows().findIndex(r => r[12] === 'old-dup-0');
  HEADERS.forEach((h, c) => {
    const rows = fixtureRows();
    rows[olderAt][c] = c === 2 ? new Date('2026-09-05T02:00:01Z') : (c === 0 ? true : rows[olderAt][c] + 'x');
    assert.notStrictEqual(boot(loadServer(new EditableSheet(rows))).olderFp, fp0, 'an older row\'s ' + h + ' is covered');
  });
  const typed = fixtureRows();
  typed[olderAt][4] = '88';
  assert.notStrictEqual(boot(loadServer(new EditableSheet(typed))).olderFp, fp0, 'a cell\'s type is covered (88 vs \'88\')');
  const swapped = fixtureRows();
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  assert.notStrictEqual(boot(loadServer(new EditableSheet(swapped))).olderFp, fp0, 'the order of older rows is covered');
  const header = fixtureRows();
  header[0][11] = '我的消費(舊)';
  assert.notStrictEqual(boot(loadServer(new EditableSheet(header))).olderFp, fp0, 'the 我的消費 column position is covered');
  const windowEdit = fixtureRows();
  windowEdit[windowEdit.findIndex(r => r[12] === 'w-1')][5] = '別的商店';
  assert.strictEqual(boot(loadServer(new EditableSheet(windowEdit))).olderFp, fp0, 'window rows are not covered');
  const blank = fixtureRows();
  blank[blank.findIndex(r => r[8] === 'blank')][5] = '改了';
  assert.strictEqual(boot(loadServer(new EditableSheet(blank))).olderFp, fp0, 'rows that are not displayed are not covered');
  const tomorrow = loadServer(new EditableSheet(fixtureRows()));
  tomorrow.clock.now += 86400000;
  assert.notStrictEqual(boot(tomorrow).olderFp, fp0, 'since is covered: yesterday\'s fingerprint never matches today\'s');
}

function testCompositeIds() {
  // The base key includes the exact date cell, so same-key rows share a CFG.TZ day and window
  // numbering equals full-list numbering. Pinned literally on both duplicate groups.
  const sheet = new EditableSheet(fixtureRows());
  const server = loadServer(sheet);
  const full = wire(server.getAllTxns());
  const res = wire(server.updateTxn('w-dup-2', { cat: '交通' }, 'recent', boot(server).olderFp));
  const ids = {};
  res.recent.txns.forEach(t => { ids[t.rowId] = t.id; });
  full.filter(t => ymdKey(t) >= SINCE_KEY).forEach(t => assert.strictEqual(ids[t.rowId], t.id, t.rowId + ': window id equals full-list id'));
  assert.ok(ids['w-dup-0'].endsWith('|300|5678|0'), 'first 300 duplicate is occurrence 0');
  assert.ok(ids['w-150'].endsWith('|150|5678|0'), 'the 150 row has its own base key');
  assert.ok(ids['w-dup-1'].endsWith('|300|5678|1'), 'second 300 duplicate is occurrence 1');
  assert.ok(ids['w-dup-2'].endsWith('|300|5678|2'), 'third 300 duplicate is occurrence 2');
  assert.strictEqual(res.changed.id, ids['w-dup-2'], 'changed inside the window carries the same id');

  const older = wire(server.updateTxn('old-dup-1', { posted: true }, 'recent', res.olderFp));
  assert.strictEqual(older.changed.id, full.find(t => t.rowId === 'old-dup-1').id, 'older changed row id equals full-list id');
  assert.ok(older.changed.id.endsWith('|88|1234|1'), 'older duplicate keeps occurrence 1');

  // Deleting a duplicate renumbers its successors in the full list; the window must agree.
  sheet.rows.splice(sheet.rows.findIndex(r => r[12] === 'w-dup-0'), 1);
  const renumbered = wire(server.updateTxn('w-1', { posted: true }, 'recent', older.olderFp));
  assert.strictEqual(shape(renumbered), 'recent', 'a delete inside the window does not touch the older fingerprint');
  assert.deepStrictEqual(renumbered.recent.txns, wire(server.getAllTxns()).filter(t => ymdKey(t) >= SINCE_KEY),
    'after a duplicate is deleted, window ids are renumbered exactly like the full list');
  assert.ok(renumbered.recent.txns.find(t => t.rowId === 'w-dup-2').id.endsWith('|300|5678|1'), 'w-dup-2 moves to occurrence 1');
}

// ---------------------------------------------------------------- client
const PANEL_FNS = ['txnsSignature', 'adoptTxns', 'ackTxns', 'spliceAt', 'historyComplete', 'txnById', 'nextMutation', 'isStale', 'settle',
  'refreshTxns', 'focusKey', 'focusMatches', 'focusIndex', 'repaint', 'revertTxn', 'applyEdit',
  'ensureTextRowKey', 'textTxn', 'textRowKey', 'resolveTextRowId', 'rawDraftKey', 'draftKey',
  'textRowLineage', 'dropTextRowState', 'reconcileTextRowIds', 'preservePendingAddRows',
  'beginRowWrite', 'endRowWrite', 'enqueueRowWrite', 'enqueueRowWrites', 'rowWriteBlocked', 'pumpRowWrites',
  'finishRowWrite', 'sendRowDelete', 'sendRowPatches', 'maybeRefresh', 'resumeRowWrites', 'cancelRowWrites',
  'textDraft', 'draftValue', 'captureDraft', 'hasActiveComposition', 'textWriteQueue',
  'textInputMatches', 'syncTextCopies', 'nextTextRequestToken', 'normalizedTextValue',
  'issueTextSave', 'drainTextWrite', 'saveTextDraft', 'trySendRowCommit', 'commitRow',
  'trySendDelete', 'cancelDeleteIntent', 'closeDelModal', 'submitAdd', 'closeAddModal'];

// Just enough document for submitAdd's form and the modal close paths: every id resolves.
function formDocument(values) {
  const nodes = {};
  function node(v) { return { value: v === undefined ? '' : v, disabled: false, innerHTML: '', classList: { add() {}, remove() {} } }; }
  Object.keys(values || {}).forEach(id => { nodes[id] = node(values[id]); });
  return {
    nodes, activeElement: null, querySelector: () => null, querySelectorAll: () => [],
    getElementById(id) { if (!nodes[id]) nodes[id] = node(); return nodes[id]; }
  };
}

function client(payload) {
  const rec = { calls: [], reads: [], adds: [], deletes: [] };
  let pending = {};
  function take() { const p = pending; pending = {}; return p; }
  const run = {
    withSuccessHandler(f) { pending.success = f; return run; },
    withFailureHandler(f) { pending.failure = f; return run; },
    updateTxns(items) { rec.calls.push(Object.assign({ items }, take())); },
    getRecentTxns(fp) { rec.reads.push(Object.assign({ fp }, take())); },
    addTxn(fields) { rec.adds.push(Object.assign({ fields }, take())); },
    deleteTxn(arg) { rec.deletes.push(Object.assign({ arg }, take())); }
  };
  const fns = loadFns(PANEL_FNS, {
    TXNS: [], OLDER_FP: null,
    HISTORY: { complete: true, before: null, loadedFp: null, loading: false, failed: null },
    MUTATION_SEQ: 0, INFLIGHT: 0, STALE_DROPPED: false, REFRESHING: false,
    TEXT_DRAFTS: {}, TEXT_DRAFT_REVISIONS: {}, TEXT_REQUEST_TOKENS: {}, TEXT_WRITE_QUEUES: {},
    TEXT_CANCEL_BLURS: {}, ROW_COMMIT_INTENTS: {}, ACTIVE_COMPOSITIONS: {}, PENDING_REPAINT: false,
    COMPOSITION_FLUSH_SCHEDULED: false, TEXT_ROW_SERIAL: 0, TEXT_REMOVED_ROW_KEYS: {},
    PENDING_ADD_ROWS: {}, ROW_ACTIVE_WRITES: {}, ROW_DELETE_INTENTS: {}, ROW_WRITE_QUEUE: { active: null, items: [] },
    pendingDelId: null, pendingDelRowKey: null, delBusy: false, openSplit: null,
    addHeatDate: null, state: {}, openHeatDay: null,
    google: { script: { run } },
    render() {}, toast() {}, setTimeout(fn) { fn(); return 1; },
    document: formDocument(),
    window: { pageXOffset: 0, pageYOffset: 0, scrollTo() {} }
  });
  // Exactly what boot() does with getDashboardData().
  fns.adoptTxns(wire(payload.txns), payload.olderFp);
  fns.rec = rec;
  return fns;
}

// What a full reload would put in TXNS: getDashboardData() through the same adoptTxns.
function reloadSignature(server) {
  const fresh = client(boot(server));
  return { sig: fresh.txnsSignature(fresh.TXNS), rowIds: fresh.TXNS.map(t => t.rowId) };
}

function assertReload(page, server, label) {
  const reload = reloadSignature(server);
  assert.deepStrictEqual(wire(page.TXNS.map(t => t.rowId)), wire(reload.rowIds), label + ': same rows in the same order as a full reload');
  assert.strictEqual(page.txnsSignature(page.TXNS), reload.sig, label + ': every field equals a full reload');
  assert.strictEqual(page.OLDER_FP, boot(server).olderFp, label + ': the page\'s fingerprint is the sheet\'s');
}

/** The page's one post-drain read, answered by the real getRecentTxns. Asserts the shape that
 *  came back and that the page now equals a reload. */
function answerRead(page, server, label, readsBefore, expectShape) {
  assert.strictEqual(page.rec.reads.length, readsBefore + 1, label + ': exactly one read after the drain');
  const read = page.rec.reads[readsBefore];
  assert.strictEqual(read.fp, page.OLDER_FP, label + ': the read sends the fingerprint of the list it holds');
  const raw = server.getRecentTxns(read.fp);
  assert.strictEqual(typeof raw, 'string', label + ': the read crosses the wire as a JSON string');
  assert.strictEqual(shape(JSON.parse(raw)), expectShape, label + ': the server answers with the ' + expectShape + ' shape');
  read.success(raw);
  assertReload(page, server, label);
}

/** Answer one updateTxns call with the real server. A write carries no list. */
function answerWrite(page, server, label, call) {
  const res = wire(server.updateTxns(wire(call.items)));
  assert.deepStrictEqual(res.results.map(r => r.ok), wire(call.items).map(() => true), label + ': every item is written');
  assert.ok(!('txns' in res) && !('recent' in res), label + ': the write response carries no list');
  call.success(res);
}

/** One edit through the real applyEdit → updateTxns → getRecentTxns path, answered by the real
 *  server. Asserts the read's shape and that the page now equals a reload. */
function edit(page, server, label, e, expectShape) {
  const before = page.rec.calls.length;
  const readsBefore = page.rec.reads.length;
  page.applyEdit(e.rowId, e.field, e.value);
  assert.strictEqual(page.rec.calls.length, before + 1, label + ': one write call');
  answerWrite(page, server, label, page.rec.calls[before]);
  answerRead(page, server, label, readsBefore, expectShape);
}

/** Load the page on the fixture, change the sheet the way the case says, make one edit, and
 *  require a reload's result. */
function editCase(label, mutateSheet, e, expectShape) {
  const sheet = new EditableSheet(fixtureRows());
  const server = loadServer(sheet);
  const page = client(boot(server));
  mutateSheet(sheet, server);
  edit(page, server, label, e, expectShape);
  return page;
}

function insertSorted(sheet, newRow) {
  // The bot appends and then sorts ASC by date: the new row lands after every earlier real date
  // and before the text-date row Sheets keeps at the bottom.
  const t = newRow[2].getTime();
  let at = sheet.rows.length;
  for (let i = 1; i < sheet.rows.length; i++) {
    const c = sheet.rows[i][2];
    if (c === '' || c == null) continue;           // a blank-date row is not a transaction
    if (!(c instanceof Date) || c.getTime() > t) { at = i; break; }
  }
  sheet.rows.splice(at, 0, newRow);
}
const botRow = () => txnRow('bot-new', new Date('2026-09-30T01:00:00Z'), 'z', 499, '9999', '新的機器人列', { 10: '' });

function testClientMerge() {
  const appended = editCase('bot row appended inside window', sheet => insertSorted(sheet, botRow()),
    { rowId: 'w-1', field: 'posted', value: true }, 'recent');
  assert.ok(appended.TXNS.some(t => t.rowId === 'bot-new'), 'the bot row appears after the edit (dynamic refresh)');

  const deleted = editCase('row deleted inside window', sheet => {
    sheet.rows.splice(sheet.rows.findIndex(r => r[12] === 'w-dup-0'), 1);
  }, { rowId: 'w-1', field: 'cat', value: '交通' }, 'recent');
  assert.ok(!deleted.TXNS.some(t => t.rowId === 'w-dup-0'), 'the row deleted elsewhere is gone');

  // The page's own edit of a row older than the window changes the older fingerprint, so the
  // read after it is the whole list (correct, and only a larger payload).
  const olderEdit = editCase('edited row older than window', sheet => insertSorted(sheet, botRow()),
    { rowId: 'old-dup-1', field: 'amount', value: 95 }, 'full');
  const edited = olderEdit.TXNS.find(t => t.rowId === 'old-dup-1');
  assert.strictEqual(edited.charged, 95, 'the older edited row carries the server value');
  assert.ok(edited.id.indexOf('|95|') > 0, 'and its new composite id (amount is part of the key)');

  const insideEdit = editCase('edited row inside window', () => {},
    { rowId: 'w-dup-1', field: 'amount', value: 320 }, 'recent');
  assert.ok(insideEdit.TXNS.find(t => t.rowId === 'w-dup-2').id.endsWith('|300|5678|1'),
    'a sibling renumbered by the edit carries its new id');

  assert.ok(olderEdit.TXNS.some(t => t.rowId === 'bot-new'), 'and the bot row arrives with the whole list');

  // The merge itself, on its own: a full-list response is still adopted as-is, and an empty ack is null.
  const page = client({ txns: [], olderFp: null });
  const list = [{ y: 2026, m: 9, d: 1 }];
  assert.strictEqual(page.ackTxns([], { ok: true, txns: list }), list, 'a full-list ack (true mode) is used as-is');
  assert.strictEqual(page.ackTxns([], { ok: true }), null, 'an ack without data adopts nothing');
}

// Gap 1: older rows changed somewhere other than this page's own acknowledged edits.
function testOlderRowsChangedElsewhere() {
  const editedElsewhere = editCase('older row edited elsewhere', sheet => {
    sheet.rows[sheet.rows.findIndex(r => r[12] === 'old-1')][5] = '另一台裝置改的';
  }, { rowId: 'w-1', field: 'posted', value: true }, 'full');
  assert.strictEqual(editedElsewhere.TXNS.find(t => t.rowId === 'old-1').merchant, '另一台裝置改的', 'the other device\'s value is shown');

  const deletedElsewhere = editCase('older row deleted elsewhere', sheet => {
    sheet.rows.splice(sheet.rows.findIndex(r => r[12] === 'old-dup-0'), 1);
  }, { rowId: 'w-1', field: 'posted', value: true }, 'full');
  assert.ok(!deletedElsewhere.TXNS.some(t => t.rowId === 'old-dup-0'), 'the older row deleted elsewhere is gone');
  assert.ok(deletedElsewhere.TXNS.find(t => t.rowId === 'old-dup-1').id.endsWith('|88|1234|0'), 'and its sibling is renumbered');

  const addedElsewhere = editCase('older row added elsewhere', sheet => {
    insertSorted(sheet, txnRow('other-tab', new Date('2026-08-15T04:00:00Z'), 'manual-x', 42, '', '別的分頁新增'));
  }, { rowId: 'old-1', field: 'cat', value: '交通' }, 'full');
  assert.ok(addedElsewhere.TXNS.some(t => t.rowId === 'other-tab'), 'the older row added elsewhere appears');

  // The window moved forward a day: bound-in (18 Sep) is now older than the window, yet the page
  // last received it as a window row and no fingerprint ever covered it. It was deleted elsewhere.
  editCase('window moved forward a day', (sheet, server) => {
    server.clock.now += 86400000;
    sheet.rows.splice(sheet.rows.findIndex(r => r[12] === 'bound-in'), 1);
  }, { rowId: 'w-1', field: 'posted', value: true }, 'full');
}

// Gap 2: a manual add from this page dated before the window.
function testBackdatedManualAdd() {
  const sheet = new EditableSheet(fixtureRows());
  const server = loadServer(sheet);
  const page = client(boot(server));
  Object.assign(page.document.nodes, formDocument({
    'a-date': '2026-08-20', 'a-time': '12:30', 'a-amt': '77', 'a-type': '支出',
    'a-source': '現金', 'a-mer': '補記的舊帳', 'a-cat': '飲食'
  }).nodes);
  page.submitAdd();
  assert.strictEqual(page.rec.adds.length, 1, 'the add is sent');
  page.rec.adds[0].success(wire(server.addTxn(page.rec.adds[0].fields)));
  const added = page.TXNS.find(t => t.merchant === '補記的舊帳');
  assert.ok(added && added.rowId, 'the added row is on the page with its server identity');
  assert.notDeepStrictEqual(wire(page.TXNS.map(t => t.rowId)), wire(reloadSignature(server).rowIds),
    'precondition: before any edit the backdated row is not where a reload puts it');
  edit(page, server, 'edit after a backdated manual add', { rowId: 'w-1', field: 'posted', value: true }, 'full');
  edit(page, server, 'the edit after that', { rowId: 'w-1', field: 'cat', value: '交通' }, 'recent');

  // Dated inside the window, the same add needs no whole list: the window carries it.
  const sheet2 = new EditableSheet(fixtureRows());
  const server2 = loadServer(sheet2);
  const page2 = client(boot(server2));
  Object.assign(page2.document.nodes, formDocument({
    'a-date': '2026-09-20', 'a-time': '', 'a-amt': '66', 'a-type': '支出', 'a-source': '現金', 'a-mer': '最近的現金', 'a-cat': ''
  }).nodes);
  page2.submitAdd();
  page2.rec.adds[0].success(wire(server2.addTxn(page2.rec.adds[0].fields)));
  edit(page2, server2, 'edit after a manual add inside the window', { rowId: 'w-1', field: 'posted', value: true }, 'recent');
}

// This page's own writes: edits and deletes inside the window stay incremental; one that touches
// a row older than the window costs exactly one whole list, after which the page is current again.
function testOwnWritesStayIncremental() {
  const sheet = new EditableSheet(fixtureRows());
  const server = loadServer(sheet);
  const page = client(boot(server));
  const fp0 = page.OLDER_FP;
  edit(page, server, 'own older edit', { rowId: 'old-dup-1', field: 'amount', value: 95 }, 'full');
  assert.notStrictEqual(page.OLDER_FP, fp0, 'an older edit advances the page\'s fingerprint');
  edit(page, server, 'own window edit', { rowId: 'w-1', field: 'posted', value: true }, 'recent');
  edit(page, server, 'second own window edit', { rowId: 'w-dup-1', field: 'cat', value: '交通' }, 'recent');
  edit(page, server, 'own older edit again', { rowId: 'old-1', field: 'posted', value: true }, 'full');

  // A delete from this page carries no list; the read after it does.
  function del(rowId, label, expectShape) {
    const rowKey = page.textRowKey(rowId);
    const before = page.rec.deletes.length;
    const readsBefore = page.rec.reads.length;
    page.ROW_DELETE_INTENTS[rowKey] = { sent: false, button: null };
    page.trySendDelete(rowKey);
    assert.strictEqual(page.rec.deletes.length, before + 1, label + ': the delete is sent');
    const res = wire(server.deleteTxn(page.rec.deletes[before].arg));
    assert.deepStrictEqual(res, { ok: true }, label + ': the delete response carries no list');
    page.rec.deletes[before].success(res);
    answerRead(page, server, label, readsBefore, expectShape);
  }
  del('w-150', 'own window delete', 'recent');
  del('old-dup-0', 'own older delete', 'full');
  edit(page, server, 'own window edit after a delete', { rowId: 'w-1', field: 'cat', value: '交通' }, 'recent');

  // Two overlapping edits: the second waits for the first, and ONE read follows both.
  const callsBefore = page.rec.calls.length;
  const readsBefore = page.rec.reads.length;
  page.applyEdit('old-1', 'cat', '娛樂');
  page.applyEdit('w-1', 'posted', false);
  assert.strictEqual(page.rec.calls.length, callsBefore + 1, 'overlap: the second edit waits for the first');
  answerWrite(page, server, 'overlap first', page.rec.calls[callsBefore]);
  assert.strictEqual(page.rec.reads.length, readsBefore, 'overlap: no read while the second edit is out');
  assert.strictEqual(page.rec.calls.length, callsBefore + 2, 'overlap: the second edit goes out from the first one\'s handler');
  answerWrite(page, server, 'overlap second', page.rec.calls[callsBefore + 1]);
  answerRead(page, server, 'overlapping edits', readsBefore, 'full');
}

// An older edit that moves a row into or out of a same-day duplicate group renumbers the
// group's OTHER rows in a full reload (amount is part of the base key). Every own edit of an
// older row is followed by the whole list (the fingerprint is compared after the write), and
// each case still has to equal a reload, renumbered siblings included.
function testOlderDuplicateGroups() {
  function pageOn(rows) {
    const server = loadServer(new EditableSheet(rows));
    return { server, page: client(boot(server)) };
  }

  const leave = pageOn(fixtureRows());
  edit(leave.page, leave.server, 'amount edit on a non-last member of an older duplicate group',
    { rowId: 'old-dup-0', field: 'amount', value: 95 }, 'full');
  assert.ok(leave.page.TXNS.find(t => t.rowId === 'old-dup-1').id.endsWith('|88|1234|0'),
    'the sibling left behind is renumbered |1 → |0');

  // A singleton older row of the same message, date and card, sitting before the 88 group.
  const rows = fixtureRows();
  rows.splice(rows.findIndex(r => r[12] === 'old-dup-0'), 0,
    txnRow('old-solo', new Date('2026-09-05T02:00:00Z'), 'grp', 77, '1234', '舊單筆'));
  const join = pageOn(rows);
  edit(join.page, join.server, 'older row joins an existing older duplicate group',
    { rowId: 'old-solo', field: 'amount', value: 88 }, 'full');
  assert.deepStrictEqual(['old-solo', 'old-dup-0', 'old-dup-1'].map(id => join.page.TXNS.find(t => t.rowId === id).id.split('|').pop()),
    ['0', '1', '2'], 'the group it joined is renumbered around it');

  // Joining a group as its LAST member, or leaving it as its last member, renumbers no other
  // row (an occurrence counts only earlier rows).
  const tailRows = fixtureRows();
  tailRows.splice(tailRows.findIndex(r => r[12] === 'old-dup-1') + 1, 0,
    txnRow('old-solo', new Date('2026-09-05T02:00:00Z'), 'grp', 77, '1234', '舊單筆'));
  const tail = pageOn(tailRows);
  edit(tail.page, tail.server, 'older row joins a group as its last member', { rowId: 'old-solo', field: 'amount', value: 88 }, 'full');
  assert.ok(tail.page.TXNS.find(t => t.rowId === 'old-solo').id.endsWith('|88|1234|2'), 'it takes the next occurrence');
  edit(tail.page, tail.server, 'older row leaves a group as its last member', { rowId: 'old-solo', field: 'amount', value: 66 }, 'full');

  // No sibling under either base key: the id still changes.
  const solo = pageOn(fixtureRows());
  edit(solo.page, solo.server, 'amount edit on an older row with no sibling', { rowId: 'old-1', field: 'amount', value: 101 }, 'full');
  assert.ok(solo.page.TXNS.find(t => t.rowId === 'old-1').id.indexOf('|101|') > 0, 'its new id is adopted');
  edit(solo.page, solo.server, 'older non-amount edit inside a duplicate group', { rowId: 'old-dup-0', field: 'cat', value: '交通' }, 'full');
}

const CASES = { testServerWindow, testFingerprintCoverage, testCompositeIds, testClientMerge,
  testOlderRowsChangedElsewhere, testBackdatedManualAdd, testOwnWritesStayIncremental, testOlderDuplicateGroups };

function run() {
  Object.keys(CASES).forEach(name => CASES[name]());
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_recent_ack');
} else {
  // The fixture sheet and server loader are reused by the partial-history tests (#58).
  module.exports = { run, CASES, loadServer, EditableSheet, row, txnRow, HEADERS, CFG, NOW, wire, formDocument, fixtureRows };
}
