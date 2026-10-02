'use strict';
/*
 * The incremental edit acknowledgement (#57): updateTxn(id, patch, 'recent') returns the rows
 * dated in the last 14 days (CFG.TZ) plus the edited row, and the page merges that into TXNS.
 *
 * The contract being pinned is the owner's: after an edit the page must show exactly what a full
 * reload would show — same rows, values and order — including rows the bot appended since the
 * page loaded. So every client case below runs the REAL applyEdit against the REAL updateTxn on
 * a fixture sheet, mutates the sheet the way the case describes, and compares the merged TXNS
 * with getAllTxns() on the same sheet afterwards.
 *
 * NOT evidence about the deployed dashboard: that needs the live sheet.
 */
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
  DATA_SHEET: 'Transactions', TZ: 'Asia/Taipei', HDR_MINE: '我的消費', HDR_ROW_ID: '交易 ID',
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
    return range;
  }
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
  'findRowByKey_', 'getAllTxns', 'txnFromRow_', 'nextOccurrence_', 'rowYmdt_', 'recentSince_', 'recentAck_',
  'rowCategory_', 'rowMine_', 'getMineColIndex_', 'ensureMineColIndex_', 'headerRow_', 'rowHM_', 'hmFromHms_',
  'isAmountCorrectionType_', 'updateTxn'];

function loadServer(sheet, opts) {
  opts = opts || {};
  const src = fs.readFileSync(SERVER, 'utf8');
  const calls = { formatDate: 0 };
  const utilities = {
    formatDate: (date, tz, pattern) => { calls.formatDate++; return formatDate(date, tz, pattern); }
  };
  let uuidSeq = 0;
  if (!opts.noUuid) utilities.getUuid = () => 'uuid-' + (++uuidSeq);
  // `new Date()` is the server's clock; every other Date use (instanceof, parsing, Date.UTC)
  // goes straight through to the real constructor so composite keys stay byte-identical.
  const FixedDate = new Proxy(Date, {
    construct(target, args) { return args.length ? new target(...args) : new target(NOW.getTime()); }
  });
  const sandbox = {
    console, Date: FixedDate, CFG, Utilities: utilities,
    getSpreadsheet_: () => ({ getSheetByName: () => sheet }),
    SpreadsheetApp: { flush: () => {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }
  };
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
    HEADERS,
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

// ---------------------------------------------------------------- server
function testServerWindow() {
  const sheet = new EditableSheet(fixtureRows());
  const server = loadServer(sheet);
  server.calls.formatDate = 0;
  const res = wire(server.updateTxn('w-1', { cat: '交通' }, 'recent'));
  const formatsForAck = server.calls.formatDate;
  const full = wire(server.getAllTxns());

  assert.deepStrictEqual(Object.keys(res).sort(), ['changed', 'ok', 'recent'], 'recent mode returns the incremental shape');
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
  // One formatDate for `since`, one per row past the coarse bound (bound-out + the six window
  // rows); none for the rows clearly older than the window.
  assert.strictEqual(formatsForAck, 1 + 7, 'rows clearly older than the window are never formatted');

  // An edited row older than the window comes back as `changed`, not inside the window.
  const older = wire(server.updateTxn('old-dup-1', { cat: '交通' }, 'recent'));
  const fullAfter = wire(server.getAllTxns());
  assert.deepStrictEqual(older.changed, fullAfter.find(t => t.rowId === 'old-dup-1'),
    'an older edited row is returned whole, as getAllTxns maps it');
  assert.ok(!older.recent.txns.some(t => t.rowId === 'old-dup-1'), 'and it is not reported as a window row');
  assert.deepStrictEqual(older.recent.txns, fullAfter.filter(t => ymdKey(t) >= SINCE_KEY), 'the window is unchanged');

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

function testCompositeIds() {
  // The base key includes the exact date cell, so same-key rows share a CFG.TZ day and window
  // numbering equals full-list numbering. Pinned literally on both duplicate groups.
  const sheet = new EditableSheet(fixtureRows());
  const server = loadServer(sheet);
  const full = wire(server.getAllTxns());
  const res = wire(server.updateTxn('w-dup-2', { cat: '交通' }, 'recent'));
  const ids = {};
  res.recent.txns.forEach(t => { ids[t.rowId] = t.id; });
  full.filter(t => ymdKey(t) >= SINCE_KEY).forEach(t => assert.strictEqual(ids[t.rowId], t.id, t.rowId + ': window id equals full-list id'));
  assert.ok(ids['w-dup-0'].endsWith('|300|5678|0'), 'first 300 duplicate is occurrence 0');
  assert.ok(ids['w-150'].endsWith('|150|5678|0'), 'the 150 row has its own base key');
  assert.ok(ids['w-dup-1'].endsWith('|300|5678|1'), 'second 300 duplicate is occurrence 1');
  assert.ok(ids['w-dup-2'].endsWith('|300|5678|2'), 'third 300 duplicate is occurrence 2');
  assert.strictEqual(res.changed.id, ids['w-dup-2'], 'changed inside the window carries the same id');

  const older = wire(server.updateTxn('old-dup-1', { posted: true }, 'recent'));
  assert.strictEqual(older.changed.id, full.find(t => t.rowId === 'old-dup-1').id, 'older changed row id equals full-list id');
  assert.ok(older.changed.id.endsWith('|88|1234|1'), 'older duplicate keeps occurrence 1');

  // Deleting a duplicate renumbers its successors in the full list; the window must agree.
  sheet.rows.splice(sheet.rows.findIndex(r => r[12] === 'w-dup-0'), 1);
  const renumbered = wire(server.updateTxn('w-1', { posted: true }, 'recent'));
  assert.deepStrictEqual(renumbered.recent.txns, wire(server.getAllTxns()).filter(t => ymdKey(t) >= SINCE_KEY),
    'after a duplicate is deleted, window ids are renumbered exactly like the full list');
  assert.ok(renumbered.recent.txns.find(t => t.rowId === 'w-dup-2').id.endsWith('|300|5678|1'), 'w-dup-2 moves to occurrence 1');
}

// ---------------------------------------------------------------- client
const PANEL_FNS = ['txnsSignature', 'adoptTxns', 'ackTxns', 'txnById', 'nextMutation', 'isStale', 'settle',
  'refreshTxns', 'focusKey', 'focusMatches', 'focusIndex', 'repaint', 'revertTxn', 'applyEdit',
  'ensureTextRowKey', 'textTxn', 'textRowKey', 'resolveTextRowId', 'rawDraftKey', 'draftKey',
  'textRowLineage', 'dropTextRowState', 'reconcileTextRowIds', 'preservePendingAddRows',
  'beginRowWrite', 'endRowWrite', 'enqueueRowWrite', 'resumeRowWrites', 'cancelRowWrites',
  'textDraft', 'draftValue', 'captureDraft', 'hasActiveComposition', 'textWriteQueue',
  'textInputMatches', 'syncTextCopies', 'nextTextRequestToken', 'normalizedTextValue',
  'issueTextSave', 'drainTextWrite', 'saveTextDraft', 'trySendRowCommit', 'commitRow',
  'trySendDelete', 'cancelDeleteIntent'];

function client(initialList) {
  const rec = { calls: [], reads: [] };
  let pending = {};
  const run = {
    withSuccessHandler(f) { pending.success = f; return run; },
    withFailureHandler(f) { pending.failure = f; return run; },
    updateTxn(id, patch, wantTxns) { rec.calls.push(Object.assign({ id, patch, wantTxns }, pending)); pending = {}; },
    getAllTxns() { rec.reads.push(pending); pending = {}; },
    deleteTxn() { throw new Error('unexpected delete'); }
  };
  const fns = loadFns(PANEL_FNS, {
    TXNS: [],
    MUTATION_SEQ: 0, INFLIGHT: 0, STALE_DROPPED: false, REFRESHING: false,
    TEXT_DRAFTS: {}, TEXT_DRAFT_REVISIONS: {}, TEXT_REQUEST_TOKENS: {}, TEXT_WRITE_QUEUES: {},
    TEXT_CANCEL_BLURS: {}, ROW_COMMIT_INTENTS: {}, ACTIVE_COMPOSITIONS: {}, PENDING_REPAINT: false,
    COMPOSITION_FLUSH_SCHEDULED: false, TEXT_ROW_SERIAL: 0, TEXT_REMOVED_ROW_KEYS: {},
    PENDING_ADD_ROWS: {}, ROW_ACTIVE_WRITES: {}, ROW_DELETE_INTENTS: {}, ROW_WRITE_FIFOS: {},
    pendingDelId: null, pendingDelRowKey: null, delBusy: false, openSplit: null,
    google: { script: { run } },
    render() {}, toast() {}, setTimeout(fn) { fn(); return 1; },
    document: { activeElement: null, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    window: { pageXOffset: 0, pageYOffset: 0, scrollTo() {} }
  });
  fns.adoptTxns(wire(initialList));    // exactly what boot() does with getDashboardData().txns
  fns.rec = rec;
  return fns;
}

// What a full reload would put in TXNS: getAllTxns() through the same adoptTxns.
function reloadSignature(server) {
  const fresh = client(server.getAllTxns());
  return { sig: fresh.txnsSignature(fresh.TXNS), rowIds: fresh.TXNS.map(t => t.rowId) };
}

/** Load the page on the fixture, change the sheet the way the case says, make one edit through
 *  the real applyEdit → updateTxn path, and return the page and the reload it must equal. */
function editCase(label, mutateSheet, edit) {
  const sheet = new EditableSheet(fixtureRows());
  const server = loadServer(sheet);
  const page = client(server.getAllTxns());
  mutateSheet(sheet);
  page.applyEdit(edit.rowId, edit.field, edit.value);
  assert.strictEqual(page.rec.calls.length, 1, label + ': one server call');
  const call = page.rec.calls[0];
  assert.strictEqual(call.wantTxns, 'recent', label + ': the edit asks for the recent acknowledgement');
  call.success(wire(server.updateTxn(call.id, call.patch, call.wantTxns)));
  assert.strictEqual(page.rec.reads.length, 0, label + ': no extra full read');
  const reload = reloadSignature(server);
  assert.deepStrictEqual(wire(page.TXNS.map(t => t.rowId)), wire(reload.rowIds), label + ': same rows in the same order as a full reload');
  assert.strictEqual(page.txnsSignature(page.TXNS), reload.sig, label + ': every field equals a full reload');
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

function testClientMerge() {
  const botRow = () => txnRow('bot-new', new Date('2026-09-30T01:00:00Z'), 'z', 499, '9999', '新的機器人列', { 10: '' });

  const appended = editCase('bot row appended inside window', sheet => insertSorted(sheet, botRow()),
    { rowId: 'w-1', field: 'posted', value: true });
  assert.ok(appended.TXNS.some(t => t.rowId === 'bot-new'), 'the bot row appears after the edit (dynamic refresh)');

  const deleted = editCase('row deleted inside window', sheet => {
    sheet.rows.splice(sheet.rows.findIndex(r => r[12] === 'w-dup-0'), 1);
  }, { rowId: 'w-1', field: 'cat', value: '交通' });
  assert.ok(!deleted.TXNS.some(t => t.rowId === 'w-dup-0'), 'the row deleted elsewhere is gone');

  const olderEdit = editCase('edited row older than window', sheet => insertSorted(sheet, botRow()),
    { rowId: 'old-dup-1', field: 'amount', value: 95 });
  const edited = olderEdit.TXNS.find(t => t.rowId === 'old-dup-1');
  assert.strictEqual(edited.charged, 95, 'the older edited row carries the server value');
  assert.ok(edited.id.indexOf('|95|') > 0, 'and its new composite id (amount is part of the key)');

  const insideEdit = editCase('edited row inside window', () => {},
    { rowId: 'w-dup-1', field: 'amount', value: 320 });
  assert.ok(insideEdit.TXNS.find(t => t.rowId === 'w-dup-2').id.endsWith('|300|5678|1'),
    'a sibling renumbered by the edit carries its new id');

  // The merge itself, on its own: a full-list response is still adopted as-is, and an empty ack is null.
  const page = client([]);
  const list = [{ y: 2026, m: 9, d: 1 }];
  assert.strictEqual(page.ackTxns([], { ok: true, txns: list }), list, 'a full-list ack (true mode) is used as-is');
  assert.strictEqual(page.ackTxns([], { ok: true }), null, 'an ack without data adopts nothing');
}

function run() {
  testServerWindow();
  testCompositeIds();
  testClientMerge();
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_recent_ack');
} else {
  module.exports = { run };
}
