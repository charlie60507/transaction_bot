'use strict';
/*
 * Subscription-change detection (sidebar/subscriptions.js) and everything wired to it:
 *
 *   1. subscriptionKey: trailing digits / whitespace / #*- stripped, first 20 characters, case kept,
 *      and the short-key guard (X12345 stays X12345; two X… codes never merge).
 *   2. subscriptionDetect / subscriptionWeekEvents on synthetic rows: a stable monthly charge, a
 *      stopped one, a price change, a new subscription, a resumed one, the irregular negatives, the
 *      ±5% and 26–35-day boundaries, a dismissed key, rows before 2025-10-01 and non-consumption rows.
 *   3. Parity: ToolPanel.html's port is textually identical to the server copy and returns the
 *      same list for every case and for a day-by-day as-of sweep.
 *   4. META 訂閱忽略: readSubscriptionIgnores_ and ledgerDismissSubscription (header by name, K
 *      claimed on the first write, foreign K refused, append after the column's last cell, E never
 *      read or written, idempotent, under the script lock).
 *   5. getDashboardData carries `subscriptionIgnores` right before `projects` in both shapes.
 *   6. ledgerWeeklyCfo fills `verifiedSubscriptions` from the detector (dismissals applied), and the
 *      events stay out of Gemini's prompt and out of the numbers Gemini may quote.
 *
 * Synthetic rows only: never the real export (this repository is public).
 */
process.env.TZ = 'Asia/Taipei';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction, extractInlineScript, loadFns, PANEL } = require('./extract_panel');
const { Sheet } = require('./dashboard_project_split');
const recentAck = require('./dashboard_recent_ack');

const SIDEBAR = path.resolve(__dirname, '..', 'sidebar');
const SUBS = path.join(SIDEBAR, 'subscriptions.js');
const SERVER = path.join(SIDEBAR, '程式碼.js');
const FACADE = path.join(SIDEBAR, 'line_ledger.js');
const WCFO = path.join(SIDEBAR, 'weekly_cfo.js');

/** Functions and constants the page carries a copy of. */
const SHARED_VARS = ['SUB_FLOOR', 'SUB_KEY_LEN', 'SUB_TOLERANCE_PCT', 'SUB_GAP_MIN', 'SUB_GAP_MAX', 'SUB_GRACE_DAYS', 'SUB_WINDOW'];
const SHARED_FNS = ['subscriptionKey', 'subDay_', 'subYmd_', 'subIsConsumption_', 'subNear_', 'subCharges_', 'subTriple_',
  'subStateAt_', 'subscriptionDetect'];

const plain = v => JSON.parse(JSON.stringify(v));

function loadServerSubs() {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SUBS, 'utf8'), sandbox, { filename: 'subscriptions.js' });
  return sandbox;
}

function varDecl(src, name) {
  const m = new RegExp('var\\s+' + name + '\\s*=\\s*[^;]+;').exec(src);
  if (!m) throw new Error('var ' + name + ' not found');
  return m[0];
}

function loadPageSubs() {
  const script = extractInlineScript(fs.readFileSync(PANEL, 'utf8'));
  const consts = {};
  vm.createContext(consts);
  vm.runInContext(SHARED_VARS.map(n => varDecl(script, n)).join('\n'), consts);
  const extras = {};
  SHARED_VARS.forEach(n => { extras[n] = consts[n]; });
  return loadFns(SHARED_FNS, extras);
}

// ---------------------------------------------------------------- synthetic rows
let seq = 0;
function txn(date, amount, merchant, extra) {
  seq++;
  const p = date.split('-').map(Number);
  return Object.assign({ y: p[0], m: p[1], d: p[2], hm: '', type: '支出', amount, cat: '娛樂', merchant,
    rowId: 'r' + String(seq).padStart(4, '0'), id: 'id-' + seq }, extra || {});
}
function addDays(ymd, n) {
  const p = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.toISOString().slice(0, 10);
}
/** Mon–Sun week containing `ymd`. */
function weekOf(ymd) {
  const p = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() || 7;
  const start = addDays(ymd, 1 - dow);
  return { weekStart: start, weekEnd: addDays(start, 6) };
}
/** Charges on the given dates with the given amounts (one amount repeats for every date). */
function series(merchant, dates, amounts, extra) {
  return dates.map((d, i) => txn(d, Array.isArray(amounts) ? amounts[i] : amounts, merchant, extra));
}

function detect(s, rows, asOf, dismissed) {
  return plain(s.subscriptionDetect({ transactions: rows, asOf, dismissed: dismissed || [] }).subscriptions);
}
function events(s, rows, ymd, dismissed) {
  return plain(s.subscriptionWeekEvents(Object.assign({ transactions: rows, dismissed: dismissed || [] }, weekOf(ymd))));
}
function types(s, rows, ymd, dismissed) { return events(s, rows, ymd, dismissed).map(e => e.type + ':' + e.key); }

const MONTHLY = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05'];

/** Named cases: rows plus the as-of dates their expectations use. Parity runs over all of them. */
function cases() {
  seq = 0;
  return {
    stable: series('WORLDGYM 0012', MONTHLY.slice(0, 3), 1288),
    stopped: series('NETFLIX.COM 12', MONTHLY.slice(0, 4), 390),
    price: series('健身工廠', MONTHLY, [1000, 1000, 1000, 1200, 1200, 1200]),
    variable: series('台電', MONTHLY.slice(0, 4), [1000, 1500, 1000, 1400]),
    irregular: series('理髮店', ['2026-01-05', '2026-01-25', '2026-02-14', '2026-03-06'], 400)
      .concat(series('醫院', ['2026-01-05', '2026-02-15', '2026-03-28'], 300)),
    shortKey: series('X12345', MONTHLY.slice(0, 3), 500).concat(series('X67890', MONTHLY.slice(0, 3), 800)),
    resumed: series('電信', MONTHLY.slice(0, 3), 599).concat(series('電信', ['2026-09-10', '2026-10-10', '2026-11-10'], 599)),
    floor: series('舊訂閱', ['2025-08-05', '2025-09-05', '2025-10-05'], 200),
    nonConsumption: series('薪水入帳', MONTHLY.slice(0, 3), 300, { type: '收入' })
      .concat(series('轉帳未分類', MONTHLY.slice(0, 3), 300, { type: '轉帳', cat: '未分類' }))
      .concat(series('轉帳有分類', MONTHLY.slice(0, 3), 300, { type: '轉帳', cat: '家居' })),
    boundaries: series('邊界五趴', ['2026-01-05', '2026-01-31', '2026-03-07'], [100, 105, 100])
      .concat(series('超過五趴', ['2026-01-05', '2026-02-05', '2026-03-05'], [100, 106, 100]))
      .concat(series('間隔太短', ['2026-01-05', '2026-01-30', '2026-03-01'], 100))
      .concat(series('間隔太長', ['2026-01-05', '2026-02-10', '2026-03-12'], 100))
  };
}

// ---------------------------------------------------------------- 1. key
function testKey() {
  const s = loadServerSubs();
  assert.strictEqual(s.subscriptionKey('WORLDGYM 0012'), 'WORLDGYM');
  assert.strictEqual(s.subscriptionKey('  NETFLIX.COM 12 '), 'NETFLIX.COM', 'trimmed, trailing digits stripped, case kept');
  assert.strictEqual(s.subscriptionKey('Spotify #1234-*'), 'Spotify', 'trailing #*- run stripped');
  assert.strictEqual(s.subscriptionKey('X12345'), 'X12345', 'short-key guard: never X');
  assert.strictEqual(s.subscriptionKey('X67890'), 'X67890');
  assert.strictEqual(s.subscriptionKey('12345'), '12345', 'all digits: the trimmed original');
  assert.strictEqual(s.subscriptionKey('一二三四五六七八九十一二三四五六七八九十多出來'), '一二三四五六七八九十一二三四五六七八九十', 'first 20 characters');
  assert.strictEqual(s.subscriptionKey(''), '');
  assert.strictEqual(s.subscriptionKey(null), '');
}

// ---------------------------------------------------------------- 2. detection and events
function testDetection() {
  const s = loadServerSubs();
  const c = cases();

  // Stable monthly charge: new in the week of its third charge, active, quiet afterwards.
  assert.deepStrictEqual(types(s, c.stable, '2026-02-05'), [], 'two charges are not a subscription');
  assert.deepStrictEqual(events(s, c.stable, '2026-03-05'),
    [{ type: 'new', key: 'WORLDGYM', name: 'WORLDGYM 0012', amount: 1288, reference: 1288, date: '2026-03-05' }], 'new on the third charge');
  assert.deepStrictEqual(types(s, c.stable, '2026-03-16'), [], 'a quiet week emits nothing');
  assert.deepStrictEqual(detect(s, c.stable, '2026-03-20'),
    [{ key: 'WORLDGYM', name: 'WORLDGYM 0012', amount: 1288, reference: 1288, lastDate: '2026-03-05' }]);

  // Stopped charge: deadline = 04-05 + 31 + 7 = 05-13; inactive from 05-14.
  assert.strictEqual(detect(s, c.stopped, '2026-05-13').length, 1, 'active through the deadline');
  assert.strictEqual(detect(s, c.stopped, '2026-05-14').length, 0, 'absent from the list after it');
  assert.deepStrictEqual(events(s, c.stopped, '2026-05-14'),
    [{ type: 'missed', key: 'NETFLIX.COM', name: 'NETFLIX.COM 12', amount: 390, reference: 390, date: '2026-04-05' }], 'missed in the deadline week');
  assert.deepStrictEqual(types(s, c.stopped, '2026-05-21'), [], 'silent the week after');
  assert.deepStrictEqual(types(s, c.stopped, '2026-05-07'), [], 'nothing before the deadline week');

  // Price change: fires once on the first new-price charge; the reference moves after the third.
  assert.deepStrictEqual(events(s, c.price, '2026-04-05'),
    [{ type: 'price', key: '健身工廠', name: '健身工廠', amount: 1200, reference: 1000, date: '2026-04-05' }], 'price on the first new-price charge');
  assert.deepStrictEqual(detect(s, c.price, '2026-04-10').map(x => [x.amount, x.reference]), [[1200, 1000]],
    'the list shows the newest amount, the reference stays');
  assert.deepStrictEqual(types(s, c.price, '2026-05-05'), [], 'not again on the second');
  assert.deepStrictEqual(types(s, c.price, '2026-06-05'), [], 'nor on the third');
  assert.deepStrictEqual(detect(s, c.price, '2026-06-10').map(x => x.reference), [1200], 'the reference moves after three');
  assert.deepStrictEqual(types(s, c.price, '2026-03-05'), ['new:健身工廠']);

  // Irregular negatives.
  ['variable', 'irregular'].forEach(name => {
    for (let d = '2026-01-01'; d <= '2026-07-31'; d = addDays(d, 7)) {
      assert.deepStrictEqual(types(s, c[name], d), [], name + ': no event in the week of ' + d);
      assert.deepStrictEqual(detect(s, c[name], d), [], name + ': nothing detected as of ' + d);
    }
  });

  // Short-key guard: two reference codes stay two subscriptions.
  assert.deepStrictEqual(detect(s, c.shortKey, '2026-03-10').map(x => x.key), ['X67890', 'X12345'], 'largest first, never merged into X');

  // Resumed: missed once, silent while stopped, new again when the charges come back.
  assert.deepStrictEqual(types(s, c.resumed, '2026-04-12'), ['missed:電信'], 'deadline 04-09 (03-05 + 28 + 7): inactive from 04-10, in the week 04-06..04-12');
  assert.deepStrictEqual(detect(s, c.resumed, '2026-08-01'), [], 'stopped meanwhile');
  assert.deepStrictEqual(types(s, c.resumed, '2026-09-10'), ['new:電信'], 'reported as new when it resumes');

  // Dismissed: in neither the list nor the events.
  assert.deepStrictEqual(detect(s, c.stable, '2026-03-20', [' WORLDGYM ']), [], 'dismissed (trimmed) key is not a subscription');
  assert.deepStrictEqual(types(s, c.stable, '2026-03-05', ['WORLDGYM']), [], 'and emits no event');
  assert.deepStrictEqual(types(s, c.stopped, '2026-05-14', ['NETFLIX.COM']), []);
  assert.strictEqual(detect(s, c.stable, '2026-03-20', ['WORLDGYM 0012']).length, 1, 'exact key match only');

  // Floor and consumption.
  assert.deepStrictEqual(detect(s, c.floor, '2025-10-10'), [], 'rows before 2025-10-01 do not count');
  assert.deepStrictEqual(detect(s, c.nonConsumption, '2026-03-10').map(x => x.key), ['轉帳有分類'],
    'income and uncategorised transfers are not consumption; a categorised transfer is');

  // Boundaries: ±5% and 26–35 days inclusive.
  assert.deepStrictEqual(detect(s, c.boundaries, '2026-03-10').map(x => x.key), ['邊界五趴'], 'exactly 5% and gaps 26 / 35 qualify; 6%, 25 and 36 do not');

  // Split rows use the displayed amount (my consumption), as the rows carry it.
  assert.deepStrictEqual(detect(s, series('分攤訂閱', MONTHLY.slice(0, 3), 150, { charged: 300, mine: 150 }), '2026-03-10').map(x => x.amount), [150]);

  // Same-day order: date, then time, then row id.
  const tie = [txn('2026-03-05', 500, '同日'), txn('2026-01-05', 500, '同日'), txn('2026-02-05', 500, '同日'),
    txn('2026-03-05', 700, '同日', { hm: '09:00' })];
  assert.deepStrictEqual(detect(s, tie, '2026-03-10').map(x => x.amount), [700], 'the later time is the newest charge');

  assert.throws(() => s.subscriptionDetect({ transactions: [], asOf: '2026/03/10' }), /YYYY-MM-DD/);
}

// ---------------------------------------------------------------- 3. parity with the page
function normalized(src) { return src.split('\n').map(l => l.trim()).join('\n'); }

function testParity() {
  const serverSrc = fs.readFileSync(SUBS, 'utf8');
  const pageSrc = extractInlineScript(fs.readFileSync(PANEL, 'utf8'));
  SHARED_FNS.forEach(n => assert.strictEqual(normalized(extractFunction(pageSrc, n)), normalized(extractFunction(serverSrc, n)),
    'ToolPanel.html\'s ' + n + ' is the server\'s, verbatim'));
  SHARED_VARS.forEach(n => assert.strictEqual(varDecl(pageSrc, n), varDecl(serverSrc, n), n + ' matches'));

  const s = loadServerSubs();
  const p = loadPageSubs();
  const c = cases();
  const all = [].concat(...Object.values(c));
  ['WORLDGYM 0012', 'X12345', '  NETFLIX.COM 12 ', '12345', 'Spotify #1234-*', ''].forEach(m =>
    assert.strictEqual(p.subscriptionKey(m), s.subscriptionKey(m), 'key parity: ' + JSON.stringify(m)));
  Object.keys(c).concat(['all']).forEach(name => {
    const rows = name === 'all' ? all : c[name];
    for (let d = '2025-09-20'; d <= '2026-12-31'; d = addDays(d, 1)) {
      [[], ['WORLDGYM', '電信']].forEach(dismissed => {
        assert.deepStrictEqual(detect(p, rows, d, dismissed), detect(s, rows, d, dismissed), 'parity: ' + name + ' as of ' + d);
      });
    }
  });
}

// ---------------------------------------------------------------- 4. META 訂閱忽略
function loadMeta(sheet) {
  const source = fs.readFileSync(SERVER, 'utf8');
  assert.ok(/META_SUB_IGNORE_COL:\s*11,/.test(source) && /META_SUB_IGNORE_HEADER:\s*'訂閱忽略',/.test(source), 'CFG: 訂閱忽略 at K');
  const locks = { wait: 0, release: 0 };
  let flushes = 0;
  const sandbox = {
    console,
    CFG: { META_SHEET: 'META', META_SUB_IGNORE_COL: 11, META_SUB_IGNORE_HEADER: '訂閱忽略' },
    getSpreadsheet_: () => ({ getSheetByName: name => name === 'META' ? sheet : null }),
    SpreadsheetApp: { flush: () => { flushes++; } },
    LockService: { getScriptLock: () => ({ waitLock: () => { locks.wait++; }, releaseLock: () => { locks.release++; } }) }
  };
  vm.createContext(sandbox);
  vm.runInContext(['subscriptionIgnoreCol_', 'readSubscriptionIgnores_', 'ensureMetaWidth_', 'claimMetaHeader_']
    .map(n => extractFunction(source, n)).join('\n'), sandbox);
  vm.runInContext(fs.readFileSync(SUBS, 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(FACADE, 'utf8'), sandbox);
  sandbox.locks = locks;
  sandbox.flushes = () => flushes;
  return sandbox;
}

/** A META like the live one: A:B rules deeper than everything else, D categories, E empty,
 *  G accounts, H:J settings, nothing at K. */
function liveMeta(maxCols) {
  const rows = [['交易關鍵字', '種類', '', '種類清單', '', '', '帳戶清單', '專案類別', '專案起始月', '日常比較對象']];
  for (let i = 0; i < 12; i++) {
    rows.push(['kw' + i, 'cat', '', i < 4 ? 'c' + i : '', '', '', i < 2 ? 'acct' + i : '', i < 1 ? '房屋' : '', i < 1 ? '2026-01' : '',
      i === 0 ? 'median' : '']);
  }
  return new Sheet(rows, maxCols || 10);
}

function snapshot(sheet) { return JSON.stringify(sheet.rows); }

function testMeta() {
  // Missing header: nothing dismissed, nothing throws, no META at all neither.
  let sheet = liveMeta();
  assert.deepStrictEqual(plain(loadMeta(sheet).readSubscriptionIgnores_()), []);
  assert.deepStrictEqual(plain(loadMeta(null).readSubscriptionIgnores_()), [], 'no META sheet');
  sheet.rows[0][4] = '訂閱忽略';
  sheet.rows[1][4] = 'FROM-E';
  assert.deepStrictEqual(plain(loadMeta(sheet).readSubscriptionIgnores_()), [], 'column E is never read');

  // First write claims K on a sheet ten columns wide.
  sheet = liveMeta(10);
  let server = loadMeta(sheet);
  const before = plain(sheet.rows);
  assert.strictEqual(server.ledgerDismissSubscription('NETFLIX.COM'), 'dismissed');
  assert.deepStrictEqual(sheet.inserted, [[10, 1]], 'META grows to K');
  assert.strictEqual(sheet.rows[0][10], '訂閱忽略', 'K1 claimed');
  assert.strictEqual(sheet.rows[1][10], 'NETFLIX.COM', 'K2 holds the key');
  assert.strictEqual(sheet.getLastRow(), before.length, 'no row added: A:B is deeper');
  sheet.writes.forEach(w => assert.strictEqual(w.col, 11, 'only K is written'));
  before.forEach((r, i) => r.forEach((v, c) => assert.strictEqual(sheet.rows[i][c], v, 'cell ' + (i + 1) + ':' + (c + 1) + ' unchanged')));
  assert.deepStrictEqual(plain(server.readSubscriptionIgnores_()), ['NETFLIX.COM']);
  assert.strictEqual(server.locks.wait, 1, 'under the script lock');
  assert.strictEqual(server.locks.release, 1);

  // Idempotent, then appended after the last non-blank K cell even with a gap.
  const writes = sheet.writes.length;
  assert.strictEqual(server.ledgerDismissSubscription(' NETFLIX.COM '), 'already-dismissed');
  assert.strictEqual(sheet.writes.length, writes, 'a repeated key writes nothing');
  sheet.rows[3][10] = '電信';
  assert.strictEqual(server.ledgerDismissSubscription('健身: A'), 'dismissed');
  assert.strictEqual(sheet.rows[4][10], '健身: A', 'after the last non-blank K cell (K4), not after a blank');
  assert.deepStrictEqual(plain(server.readSubscriptionIgnores_()), ['NETFLIX.COM', '電信', '健身: A']);
  assert.ok(sheet.rows.every(r => r[4] === '' || r[4] == null), 'column E untouched');

  // A foreign K header: the write fails and changes nothing.
  sheet = liveMeta(11);
  sheet.rows[0][10] = '其他用途';
  const frozen = snapshot(sheet);
  assert.throws(() => loadMeta(sheet).ledgerDismissSubscription('NETFLIX.COM'), /META!K 已有其他設定/);
  assert.strictEqual(snapshot(sheet), frozen, 'nothing written');
  assert.strictEqual(sheet.writes.length, 0);

  // The header elsewhere in row 1 is found by name and written there.
  sheet = liveMeta(12);
  sheet.rows[0][11] = '訂閱忽略';
  server = loadMeta(sheet);
  assert.strictEqual(server.ledgerDismissSubscription('WORLDGYM'), 'dismissed');
  assert.strictEqual(sheet.rows[1][11], 'WORLDGYM', 'written under the located header (L)');
  assert.ok(sheet.rows.every(r => r[10] === '' || r[10] == null), 'K untouched');

  // Invalid keys.
  ['', '   ', '一二三四五六七八九十一二三四五六七八九十多'].forEach(k =>
    assert.throws(() => server.ledgerDismissSubscription(k), /訂閱名稱不合法/, 'rejects ' + JSON.stringify(k)));
}

// ---------------------------------------------------------------- 5. payload
function testPayload() {
  const server = recentAck.loadServer(new recentAck.EditableSheet(recentAck.fixtureRows()));
  server.readSubscriptionIgnores_ = () => ['NETFLIX.COM'];
  [server.getDashboardData(), server.getDashboardData({ sinceMonths: 13 })].forEach((raw, i) => {
    const obj = JSON.parse(raw);
    assert.deepStrictEqual(Object.keys(obj).slice(-4), ['subscriptionIgnores', 'projects', 'baseline', 'categories'],
      'shape ' + i + ': subscriptionIgnores right before projects');
    assert.deepStrictEqual(obj.subscriptionIgnores, ['NETFLIX.COM']);
  });
}

// ---------------------------------------------------------------- 6. weekly report
function loadWeekly(txns, opts) {
  opts = opts || {};
  const fetches = [];
  const sandbox = {
    console: { log() {}, error() {} },
    CONFIG: { geminiApiKey: opts.key || '' },
    CFG: { DATA_SHEET: 'Transactions', META_SHEET: 'META' },
    getSpreadsheet_: () => ({ getSheetByName: () => ({}) }),
    readTxnsForLoad_: () => ({ rows: [1], mineIdx: -1, rowIdIdx: -1 }),
    txnsFromRows_: () => txns,
    readMetaSettings_: () => ({ projects: [], baseline: { mode: 'median', amount: null } }),
    readSubscriptionIgnores_: () => opts.dismissed || [],
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: { fetch: (url, req) => { fetches.push(req); return { getResponseCode: () => 500, getContentText: () => '' }; } }
  };
  vm.createContext(sandbox);
  [WCFO, SUBS, FACADE].forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: path.basename(f) }));
  sandbox.fetches = fetches;
  return sandbox;
}

function testWeekly() {
  const c = cases();
  const rows = c.stopped.concat(c.stable.map(t => Object.assign({}, t, { y: 2026, m: t.m + 2 })));  // WORLDGYM 03-05..05-05
  // Report Monday 2026-05-18 covers 05-11..05-17: NETFLIX.COM's deadline week, WORLDGYM's third charge was 05-05.
  let w = loadWeekly(rows);
  let report = w.ledgerWeeklyCfo('2026-05-18');
  assert.deepStrictEqual(plain(report.facts.subscriptionEvents),
    [{ type: 'missed', key: 'NETFLIX.COM', name: 'NETFLIX.COM 12', amount: 390, reference: 390, date: '2026-04-05', verified: true }],
    'the week\'s detector events reach the facts, marked verified');
  report = w.ledgerWeeklyCfo('2026-05-11');
  assert.deepStrictEqual(plain(report.facts.subscriptionEvents).map(e => e.type + ':' + e.key), ['new:WORLDGYM'], 'the week of 05-04..05-10');
  assert.strictEqual(report.copy.source, 'computed');

  w = loadWeekly(rows, { dismissed: ['NETFLIX.COM'] });
  assert.deepStrictEqual(plain(w.ledgerWeeklyCfo('2026-05-18').facts.subscriptionEvents), [], 'a dismissed key is never reported');

  // Gemini never sees the events.
  w = loadWeekly(rows, { key: 'placeholder-key' });
  w.ledgerWeeklyCfo('2026-05-18');
  assert.strictEqual(w.fetches.length, 1, 'the wording call was attempted');
  const prompt = JSON.parse(w.fetches[0].payload).contents[0].parts[0].text;
  assert.ok(prompt.indexOf('subscriptionEvents') < 0 && prompt.indexOf('NETFLIX') < 0, 'subscription events stay out of the prompt');

  // …nor may it quote their numbers.
  const facts = {
    reportDate: '2026-05-18', weekKey: '2026-W20', week: { start: '2026-05-11', end: '2026-05-17', daily: 1000, refunds: 0, project: 0 },
    month: { key: '2026-05', elapsedDays: 17, daysInMonth: 31, daily: 5000, projection: 9118 }, baseline: { amount: 8000, source: 'median', months: 7 },
    overspending: true, observations: [],
    subscriptionEvents: [{ type: 'price', key: 'K', name: 'K', amount: 777, reference: 700, date: '2026-05-12', verified: true }]
  };
  assert.ok(w.weeklyCfoValidateGeminiCopy(facts, { conclusion: '本月推估 9118，可能超過基準', explanations: [] }), 'computed numbers pass');
  assert.ok(!w.weeklyCfoValidateGeminiCopy(facts, { conclusion: '本月有 777 訂閱，可能超過基準', explanations: [] }), 'an event amount is not quotable');
  assert.ok(!('subscriptionEvents' in w.weeklyCfoFactsForWording(facts)));
  assert.deepStrictEqual(plain(facts.subscriptionEvents).length, 1, 'the facts themselves are not modified');
}

const CASES = { testKey, testDetection, testParity, testMeta, testPayload, testWeekly };

function run() {
  Object.keys(CASES).forEach(n => CASES[n]());
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_subscriptions');
} else {
  module.exports = { run, CASES };
}
