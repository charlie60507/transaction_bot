'use strict';
/*
 * Recent months first, the rest of the history in the background (#58).
 *
 * getDashboardData({ sinceMonths: 13 }) returns only the rows dated from the first day of the month
 * twelve months back (CFG.TZ), with `complete: false`, `before` and a fingerprint of what it sent;
 * getTxnsBefore(before.y, before.m, loadedFp) returns the rest. The owner's contract: once the
 * history is in, every view shows exactly what a full load shows, and while it is not, no view
 * shows a number computed from part of the rows.
 *
 * The client cases run the WHOLE inline script of ToolPanel.html (boot, render, every view) in a
 * sandbox against the real server functions on a fixture sheet, and compare the rendered HTML of
 * every view with a page booted from the whole list, the way the dashboard loaded before #58.
 *
 * NOT evidence about the deployed dashboard: that needs the live sheet.
 */
process.env.TZ = 'Asia/Taipei';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { extractInlineScript, PANEL } = require('./extract_panel');
const { loadServer, EditableSheet, row, txnRow, HEADERS, wire, formDocument } = require('./dashboard_recent_ack');

// NOW is 2 Oct 2026 in Taipei (dashboard_recent_ack's clock), so 13 months start at October 2025.
const BEFORE = { y: 2025, m: 10 };
const BEFORE_KEY = 202510;
function ymKey(t) { return t.y * 100 + t.m; }
// getDashboardData and getTxnsBefore return their payload as a JSON string, which the page parses
// (#62); server-side assertions read it the same way, client cases hand the page the string itself.
function parsed(s) { assert.strictEqual(typeof s, 'string', 'load calls return a JSON string'); return JSON.parse(s); }

// ---------------------------------------------------------------- fixture
// Nearly four years of rows, so 全部期間, older years, baselines and the 待記帳 backlog all reach
// past the loaded range. Deterministic: no randomness, no clock.
const MERCHANTS = ['全聯', '星巴克', '中油', '誠品', '好市多', '台電'];
const CATS = ['超市', '飲食', '交通', '個人', '家居', '房屋'];
function fixtureRows(order) {
  const data = [];
  let n = 0;
  const id = () => 'r' + (++n);
  for (let y = 2023; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > 10) break;
      const k = (y - 2023) * 12 + m;
      const lastDay = (y === 2026 && m === 10) ? 1 : 27;
      // A monthly subscription, so 定期訂閱 and the month-end projection have something to find.
      data.push(txnRow(id(), new Date(Date.UTC(y, m - 1, 1, 1)), 'nf-' + k, 390, '4321', 'Netflix', { 0: true, 10: '娛樂' }));
      for (let j = 0; j < 4; j++) {
        const d = 1 + ((k * 7 + j * 5) % lastDay);
        const amount = 120 + ((k * 37 + j * 91) % 900);
        const extra = { 0: !(j === 1 && k % 9 === 0), 10: CATS[(k + j) % CATS.length] };
        if (j === 2 && k % 5 === 0) extra[11] = Math.round(amount / 2);          // 我的消費 split
        if (j === 3 && k % 4 === 0) { extra[9] = '轉帳'; extra[10] = k % 8 === 0 ? '房屋' : ''; }
        data.push(txnRow(id(), new Date(Date.UTC(y, m - 1, d, 2 + j)), 'm-' + k + '-' + j, amount,
          String(1000 + j), MERCHANTS[(k + j) % MERCHANTS.length], extra));
      }
      data.push(txnRow(id(), new Date(Date.UTC(y, m - 1, Math.min(5, lastDay), 1)), 'pay-' + k, 50000 + k * 10, '',
        '薪水', { 0: true, 9: '收入', 10: '薪資' }));
    }
  }
  // Same-day duplicates (one base key, several occurrences) on both sides of the boundary, and
  // on the very first loaded day.
  const dup = (date, msg, amount, last4, count) => { for (let i = 0; i < count; i++) data.push(txnRow(id(), date, msg, amount, last4, '彙整' + i)); };
  dup(new Date('2024-02-10T03:00:00Z'), 'cathay-old', 300, '5678', 2);
  dup(new Date('2025-09-30T16:00:00Z'), 'cathay-edge', 210, '5678', 2);  // 1 Oct 2025 00:00 Taipei: loaded
  dup(new Date('2026-03-12T03:00:00Z'), 'cathay-new', 300, '5678', 3);
  dup(new Date('2026-09-25T04:00:00Z'), 'cathay-win', 150, '5678', 2);
  // The boundary minute: 30 Sep 2025 23:59 Taipei is older, though it is 1 Oct nowhere.
  data.push(txnRow(id(), new Date('2025-09-30T15:59:00Z'), 'edge-out', 77, '2222', '邊界外'));
  data.sort((a, b) => (a[2].getTime() - b[2].getTime()) || String(a[8]).localeCompare(String(b[8])));
  // A blank-date row in the middle, and hand-typed text dates (Sheets sorts text after every real
  // date) on both sides of the boundary at the bottom: older rows are NOT all at the top.
  data.splice(Math.floor(data.length / 2), 0, row({ 1: '玉山', 2: '', 4: 51, 5: '空白日期', 8: 'blank' }));
  data.push(txnRow(id(), '2024-07-04T01:00:00Z', 'txt-old', 70, '5555', '文字日期舊', { 0: false }));
  data.push(txnRow(id(), '2026-03-05T01:00:00Z', 'txt-new', 80, '5555', '文字日期新'));
  if (order === 'desc') data.reverse();
  if (order === 'mixed') {
    // An unsorted sheet (SORT_ORDER NONE after an import): a fixed interleaving.
    const odd = data.filter((_, i) => i % 2), even = data.filter((_, i) => !(i % 2));
    data.length = 0;
    data.push(...odd.reverse(), ...even);
  }
  return [HEADERS.slice()].concat(data, [[false]]);
}
const fixture = order => new EditableSheet(fixtureRows(order));

/** The client-side merge, done by hand: older rows spliced among the recent ones by loadedBefore. */
function spliceByCount(recent, older, at) {
  const out = [];
  let j = 0;
  for (let k = 0; k <= recent.length; k++) {
    while (j < older.length && at[j] <= k) out.push(older[j++]);
    if (k < recent.length) out.push(recent[k]);
  }
  return out.concat(older.slice(j));
}

// ---------------------------------------------------------------- server
function testServerSplit() {
  ['asc', 'desc', 'mixed'].forEach(order => {
    const sheet = fixture(order);
    const server = loadServer(sheet);
    const full = wire(server.getAllTxns());
    const whole = parsed(server.getDashboardData());
    assert.ok(full.some(t => ymKey(t) < BEFORE_KEY) && full.some(t => ymKey(t) >= BEFORE_KEY), order + ': precondition, rows on both sides');

    const recent = parsed(server.getDashboardData({ sinceMonths: 13 }));
    assert.deepStrictEqual(Object.keys(recent).sort(), ['accounts', 'baseline', 'before', 'categories', 'complete', 'loadedFp', 'projects', 'txns'],
      order + ': the partial shape, with no older-rows fingerprint for edits to send');
    assert.strictEqual(recent.complete, false, order + ': marked incomplete');
    assert.deepStrictEqual(recent.before, BEFORE, order + ': before = the first loaded month, twelve months back in CFG.TZ');
    assert.deepStrictEqual(recent.txns, full.filter(t => ymKey(t) >= BEFORE_KEY),
      order + ': the recent part is exactly the full list\'s rows from that month on, every field and id, in order');
    assert.ok(recent.txns.some(t => t.merchant === '彙整0' && t.y === 2025 && t.m === 10 && t.d === 1),
      order + ': 1 Oct 00:00 Taipei is loaded (it is still 30 Sep in UTC)');
    assert.ok(!recent.txns.some(t => t.merchant === '邊界外'), order + ': 30 Sep 23:59 Taipei is not');

    const rest = parsed(server.getTxnsBefore(recent.before.y, recent.before.m, recent.loadedFp));
    assert.deepStrictEqual(Object.keys(rest).sort(), ['loadedBefore', 'ok', 'older', 'olderFp'], order + ': the older-rows shape');
    assert.deepStrictEqual(rest.older, full.filter(t => ymKey(t) < BEFORE_KEY),
      order + ': the older part is exactly the full list\'s rows before that month, every field and id, in order');
    assert.deepStrictEqual(spliceByCount(recent.txns, rest.older, rest.loadedBefore), full,
      order + ': recent + before = the full list exactly, order included');
    assert.strictEqual(rest.olderFp, whole.olderFp, order + ': and the fingerprint is the one a full load hands out');
    if (order === 'asc') {
      assert.ok(rest.loadedBefore.slice(0, -1).every(c => c === 0), 'asc: older rows go in front of the recent ones…');
      assert.strictEqual(rest.loadedBefore[rest.loadedBefore.length - 1], recent.txns.length - 1,
        'asc: …except the text-dated one Sheets keeps at the bottom, just before the newer text-dated row');
    }

    // Composite ids: duplicate groups on both sides, numbered on their own side, match the full list.
    const occ = (list, msg) => list.filter(t => t.id.split('|')[0] === msg).map(t => t.id.split('|').pop());
    assert.deepStrictEqual(occ(rest.older, 'cathay-old'), ['0', '1'], order + ': older duplicates keep occurrences 0, 1');
    assert.deepStrictEqual(occ(recent.txns, 'cathay-edge'), ['0', '1'], order + ': duplicates on the first loaded day keep 0, 1');
    assert.deepStrictEqual(occ(recent.txns, 'cathay-new'), ['0', '1', '2'], order + ': recent duplicates keep 0, 1, 2');

    // Without opts, or with unusable ones, nothing changes.
    [undefined, {}, { sinceMonths: 0 }, { sinceMonths: 'x' }, { sinceMonths: 2.5 }].forEach(opts => {
      assert.deepStrictEqual(parsed(server.getDashboardData(opts)), whole, order + ': opts ' + JSON.stringify(opts) + ' behave exactly as before');
    });
    assert.deepStrictEqual(Object.keys(whole).sort(), ['accounts', 'baseline', 'categories', 'olderFp', 'projects', 'txns'], order + ': the whole-list shape is unchanged');
    assert.deepStrictEqual(whole.txns, full, order + ': and so is its list');

    // A page whose recent rows no longer match the sheet gets the whole list instead.
    [undefined, null, 'stale'].forEach(fp => {
      assert.deepStrictEqual(parsed(server.getTxnsBefore(2025, 10, fp)), { ok: true, txns: full, olderFp: whole.olderFp },
        order + ': loadedFp ' + fp + ' gets the whole list');
    });
    sheet.rows[sheet.rows.findIndex(r => r[8] === 'cathay-new')][5] = '別處改的';
    assert.deepStrictEqual(Object.keys(parsed(server.getTxnsBefore(2025, 10, recent.loadedFp))).sort(), ['ok', 'olderFp', 'txns'],
      order + ': a recent row changed since boot gets the whole list');
  });

  // Every displayed row is inside the range: the partial list IS the whole list, so it says so.
  const young = new EditableSheet([HEADERS.slice(), txnRow('y1', new Date('2026-05-01T03:00:00Z'), 'y', 10, '1', '新')]);
  const youngServer = loadServer(young);
  const all = parsed(youngServer.getDashboardData({ sinceMonths: 13 }));
  assert.deepStrictEqual(all, Object.assign(parsed(youngServer.getDashboardData()), { complete: true }),
    'nothing older than the range: the whole-list shape, with complete: true');

  // The fingerprint guards every recent row, window rows included, and nothing older.
  const sheet = fixture('asc');
  const server = loadServer(sheet);
  const fp0 = parsed(server.getDashboardData({ sinceMonths: 13 })).loadedFp;
  const fpAfter = mutate => { const s = fixture('asc'); mutate(s.rows); return parsed(loadServer(s).getDashboardData({ sinceMonths: 13 })).loadedFp; };
  assert.notStrictEqual(fpAfter(rows => { rows[rows.findIndex(r => r[8] === 'cathay-win')][0] = true; }), fp0, 'a window row is covered');
  assert.notStrictEqual(fpAfter(rows => { rows[rows.findIndex(r => r[8] === 'cathay-edge')][5] = 'x'; }), fp0, 'a row on the first loaded day is covered');
  assert.strictEqual(fpAfter(rows => { rows[rows.findIndex(r => r[8] === 'edge-out')][5] = 'x'; }), fp0, 'a row before the range is not');
}

// ---------------------------------------------------------------- client
/** The whole inline script of ToolPanel.html, evaluated against a stub document. Every
 *  google.script.run call is recorded with its handlers, for the test to answer. */
function page(clockNow) {
  const html = fs.readFileSync(PANEL, 'utf8');
  const script = extractInlineScript(html)
    .replace("<?= now.year ?>", String(clockNow.year)).replace("<?= now.month ?>", String(clockNow.month))
    .replace("<?= now.day ?>", String(clockNow.day)).replace('<?= sheetUrl ?>', 'https://example.invalid/sheet');
  const nodes = {};
  function node() {
    return { innerHTML: '', value: '', textContent: '', disabled: false, classList: { add() {}, remove() {}, contains: () => false },
      querySelectorAll: () => [], querySelector: () => null, focus() {}, select() {} };
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
const TODAY = { year: 2026, month: 10, day: 2 };

/** Take the one pending call to `fn`, asserting there is exactly one. */
function take(p, fn) {
  const open = p.calls.filter(c => c.fn === fn && !c.taken);
  assert.strictEqual(open.length, 1, 'exactly one pending ' + fn + ' call (got ' + open.length + ')');
  open[0].taken = true;
  return open[0];
}
function noPending(p, fn, label) {
  assert.strictEqual(p.calls.filter(c => c.fn === fn && !c.taken).length, 0, label);
}

/** A page booted from the recent months only, with the background read still out. */
function partialPage(server) {
  const p = page(TODAY);
  const boot = take(p, 'getDashboardData');
  assert.deepStrictEqual(wire(boot.args), [{ sinceMonths: 13 }], 'boot asks for the recent 13 months');
  boot.success(server.getDashboardData(boot.args[0]));   // the JSON string, as it crosses the wire
  return p;
}
/** A page booted from the whole list, i.e. the dashboard as it loaded before #58. */
function fullPage(server) {
  const p = page(TODAY);
  take(p, 'getDashboardData').success(server.getDashboardData());
  noPending(p, 'getTxnsBefore', 'a whole list needs no background read');
  return p;
}
function answerHistory(p, server) {
  const c = take(p, 'getTxnsBefore');
  const raw = server.getTxnsBefore.apply(null, c.args);
  c.success(raw);
  return parsed(raw);
}

// Every view the dashboard has, as state + an optional open heat day.
const VIEWS = [];
['analysis', 'trend'].forEach(tab => {
  ['month', 'year', 'all', '2026-09', '2026-03', '2025-10', '2025-09', '2025', '2024', '2024-02', '2023'].forEach(scope => {
    VIEWS.push({ tab, scope });
  });
});
VIEWS.push({ tab: 'analysis', scope: '2026-09', openHeatDay: '2026-9-25' });
VIEWS.push({ tab: 'analysis', scope: '2024-02', openHeatDay: '2024-2-10' });
[['all', false], ['all', true], ['year', false], ['year', true]].forEach(([inboxScope, inboxDone]) => VIEWS.push({ tab: 'inbox', inboxScope, inboxDone }));
['全聯', '彙整', '390', '文字日期', '薪資'].forEach(q => VIEWS.push({ tab: 'analysis', scope: 'month', q }));

function show(p, v) {
  Object.assign(p.state, { tab: 'analysis', scope: 'month', selYear: 2026, selMonth: 10, q: '', inboxScope: 'all', inboxDone: false }, v);
  delete p.state.openHeatDay;
  p.openHeatDay = v.openHeatDay || null;
  p.openRow = null;
  p.render();
  // _textKey is a client-only row identity numbered in adoption order; it is not data.
  return p.nodes.app.innerHTML.replace(/text-row-\d+/g, 'text-row');
}
const label = v => JSON.stringify(v);
/** Only the tab's own content, without the header (whose inbox badge carries its own state). */
function body(p, v) {
  show(p, v);
  const h = v.q ? p.searchPanel(v.q) : (v.tab === 'trend' ? p.trendTab() : (v.tab === 'inbox' ? p.inboxTab() : p.periodTab()));
  return h.replace(/text-row-\d+/g, 'text-row');
}

/** Every view of `p` renders exactly what the full-load page renders. */
function assertSameViews(p, ref, what) {
  VIEWS.forEach(v => assert.strictEqual(show(p, v), show(ref, v), what + ': ' + label(v) + ' renders exactly as a full load'));
}
/** TXNS equals a full reload, field for field and in order, and so does the fingerprint. */
function assertReload(p, server, what, viaRefresh) {
  const ref = fullPage(server);
  assert.deepStrictEqual(wire(p.TXNS.map(t => t.rowId)), wire(ref.TXNS.map(t => t.rowId)), what + ': same rows in the same order as a full reload');
  assert.strictEqual(p.txnsSignature(p.TXNS), ref.txnsSignature(ref.TXNS), what + ': every field equals a full reload');
  // refreshTxns' getAllTxns carries no fingerprint and always clears it (one whole list on the next edit, as before #58).
  assert.strictEqual(p.OLDER_FP, viaRefresh ? null : ref.OLDER_FP, what + (viaRefresh ? ': a refresh leaves no fingerprint' : ': the page\'s fingerprint is a full load\'s'));
  assert.strictEqual(p.HISTORY.complete, true, what + ': the history is marked complete');
  return ref;
}

const WAIT = '載入完整歷史中…';
function testPartialViews() {
  ['asc', 'mixed'].forEach(order => {
    const server = loadServer(fixture(order));
    const p = partialPage(server);
    const ref = fullPage(server);
    assert.strictEqual(p.HISTORY.complete, false, order + ': boot leaves the history incomplete');
    const bg = take(p, 'getTxnsBefore');
    assert.deepStrictEqual(wire(bg.args), [2025, 10, parsed(server.getDashboardData({ sinceMonths: 13 })).loadedFp],
      order + ': and fetches the rest in the background, with the fingerprint of what it got');
    bg.taken = false;
    assert.strictEqual(p.OLDER_FP, null, order + ': no fingerprint an edit could send while history is partial');
    assert.ok(p.TXNS.every(t => ymKey(t) >= BEFORE_KEY), order + ': only the recent months are on the page');

    // Views that need older rows wait instead of showing a partial number.
    const needsHistory = VIEWS.filter(v => (v.tab === 'analysis' || v.tab === 'trend') && !v.q &&
      (v.scope === 'all' || /^(2025|2024|2023)$/.test(v.scope) || /^(2025-09|2024-02)$/.test(v.scope)));
    needsHistory.forEach(v => {
      const h = body(p, v);
      assert.ok(h.indexOf(WAIT) >= 0, order + ': ' + label(v) + ' shows the loading state');
      assert.ok(h.indexOf('class="kpi"') < 0 && h.indexOf('row-card') < 0 && h.indexOf('class="trend"') < 0,
        order + ': ' + label(v) + ' shows no number at all');
    });
    // A loaded month shows its own numbers exactly as a full load does, except the baselines,
    // which are medians over every month and so wait.
    ['month', '2026-09', '2025-10'].forEach(scope => {
      const v = { tab: 'analysis', scope };
      const h = body(p, v);
      assert.ok(h.indexOf('class="kpi"') >= 0, order + ': ' + scope + ' renders its totals');
      assert.ok(h.indexOf('vs 月常態') < 0 && h.indexOf('vs 月平均') < 0 && h.indexOf('無常態可比') < 0,
        order + ': ' + scope + ' shows no baseline comparison computed from part of the months');
      assert.ok(h.indexOf('<div class="k-sub">' + WAIT + '</div>') >= 0, order + ': ' + scope + ' shows the loading state in its place');
      assert.ok(/class="delta flat" title="載入完整歷史中…">…<\/span>/.test(h), order + ': ' + scope + ' per-category chips wait too');
      const strip = s => s.replace(/<div class="k-sub">[^<]*(<span[^>]*>[^<]*<\/span>)?<\/div>/g, '').replace(/<span class="delta[^"]*"[^>]*>[^<]*<\/span>/g, '')
        .replace(/<div class="tabs">[\s\S]*?<\/div><div class="controls">/, '').replace(/<select id="selYear">[\s\S]*?<\/select>/, '');
      assert.strictEqual(strip(h), strip(body(ref, v)), order + ': ' + scope + ': every total, list and calendar equals a full load\'s');
    });
    ['month', '2026-09', 'year', '2026'].forEach(scope => {
      const h = body(p, { tab: 'trend', scope });
      assert.ok(h.indexOf(WAIT) < 0 && h.indexOf('class="trend"') >= 0, order + ': trend ' + scope + ' needs only loaded months and renders');
    });
    // The 待記帳 badge and totals cover every date, so they wait; the loaded rows stay workable.
    const inbox = show(p, { tab: 'inbox', inboxScope: 'all' });
    assert.ok(inbox.indexOf('<span class="tsub">' + WAIT + '</span>') >= 0, order + ': the inbox badge waits');
    assert.ok(inbox.indexOf('筆待處理') < 0, order + ': no pending count is shown as the whole backlog');
    assert.ok(inbox.indexOf('下面只列 2025/10 起的待記帳') >= 0, order + ': the queue says it lists the loaded months only');
    assert.ok(inbox.indexOf('全部記帳完成') < 0, order + ': and never claims the backlog is empty');
    const pendingLoaded = p.TXNS.filter(t => !t.posted).length;
    assert.ok(pendingLoaded > 0, order + ': precondition, loaded pending rows exist');
    assert.strictEqual((inbox.match(/class="erow"/g) || []).length, pendingLoaded, order + ': every loaded pending row is listed and editable');
    assert.ok(ref.TXNS.filter(t => !t.posted).length > pendingLoaded, order + ': precondition, older pending rows exist too');
    assert.strictEqual(show(p, { tab: 'inbox', inboxScope: 'year' }).indexOf('下面只列'), -1, order + ': 本年 is fully loaded and needs no note');
    // Search: loaded results, plus the note.
    const search = body(p, { tab: 'analysis', scope: 'month', q: '全聯' });
    assert.ok(search.indexOf('目前只搜尋 2025/10 起的交易') >= 0, order + ': search says older data is still loading');
    assert.strictEqual((search.match(/class="erow( done)?"/g) || []).length,
      Math.min(40, p.TXNS.filter(t => t.merchant.indexOf('全聯') >= 0).length), order + ': and lists the loaded matches');

    // The background read lands: one merge, one repaint, and every view equals a full load.
    const before = p.nodes.app.innerHTML;
    const res = answerHistory(p, server);
    assert.ok(res.older, order + ': the page\'s rows were current, so the older rows came on their own');
    assert.notStrictEqual(p.nodes.app.innerHTML, before, order + ': the page repaints once the history is in');
    assertReload(p, server, order + ': after the background read');
    assertSameViews(p, ref, order + ': after the background read');
    // Baselines explicitly: the median over every month equals the full load's.
    ['2026-09', '2025-10', '2024-02'].forEach(k => {
      assert.deepStrictEqual(wire(p.monthlyBaseline(p.isConsumption, k)), wire(ref.monthlyBaseline(ref.isConsumption, k)), order + ': monthlyBaseline ' + k);
      assert.deepStrictEqual(wire(p.catBaselines(k)), wire(ref.catBaselines(k)), order + ': catBaselines ' + k);
    });
    assert.ok(p.monthlyBaseline(p.isConsumption, '2026-09').months > 13, order + ': and the baseline really spans the older months');
  });
}

/** One edit through the real applyEdit, answered by the real server. Returns the response. */
function edit(p, server, rowId, field, value) {
  p.applyEdit(rowId, field, value);
  const c = take(p, 'updateTxn');
  const res = wire(server.updateTxn.apply(null, c.args));
  return { call: c, res, deliver() { c.success(res); } };
}
const rid = (server, msg, i) => wire(server.getAllTxns()).filter(t => t.id.split('|')[0] === msg)[i || 0].rowId;

function testEditDuringPartial() {
  // The edit goes out with no fingerprint, so the server answers with the whole list: that is the
  // complete history, and the background read that lands after it changes nothing.
  ['merge', 'whole'].forEach(lateShape => {
    const sheet = fixture('asc');
    const server = loadServer(sheet);
    const p = partialPage(server);
    // The background read is answered by the server BEFORE the edit (the page's rows still match:
    // the older-rows shape) or AFTER it (they no longer match: the whole list).
    const bg = take(p, 'getTxnsBefore');
    const early = lateShape === 'merge' ? server.getTxnsBefore.apply(null, bg.args) : null;
    // Then an older row is deleted somewhere else: the early response still carries it.
    const goneId = rid(server, 'cathay-old', 0);
    sheet.rows.splice(sheet.rows.findIndex(r => r[12] === goneId), 1);
    const e = edit(p, server, rid(server, 'cathay-win', 1), 'posted', true);
    assert.strictEqual(e.call.args[2], 'recent', lateShape + ': the edit still asks for the recent acknowledgement');
    assert.strictEqual(e.call.args[3], null, lateShape + ': but sends no fingerprint while history is partial');
    assert.ok(e.res.txns && !e.res.recent, lateShape + ': so the server answers with the whole list');
    e.deliver();
    assertReload(p, server, lateShape + ': the edit\'s whole list completes the history');
    const late = early || server.getTxnsBefore.apply(null, bg.args);
    assert.ok(lateShape === 'merge' ? parsed(late).older : parsed(late).txns, lateShape + ': precondition, the late response has the ' + lateShape + ' shape');
    const sig = p.txnsSignature(p.TXNS);
    bg.success(late);
    assert.strictEqual(p.txnsSignature(p.TXNS), sig, lateShape + ': a late background response changes nothing (no duplicate, no reorder)');
    assert.ok(!p.TXNS.some(t => t.rowId === goneId), lateShape + ': and does not bring back the row deleted elsewhere');
    assertReload(p, server, lateShape + ': after the late background response');
    // And the next edit, now that the page holds a fingerprint, is incremental again.
    const next = edit(p, server, rid(server, 'cathay-old', 0), 'cat', '交通');
    assert.ok(next.res.recent, lateShape + ': the next edit is incremental');
    next.deliver();
    assertReload(p, server, lateShape + ': after the next edit');
  });

  // Edits after the background merge: the merged fingerprint lets an older edit stay incremental,
  // and the page still equals a reload.
  const server = loadServer(fixture('mixed'));
  const p = partialPage(server);
  answerHistory(p, server);
  [['cathay-old', 1, 'amount', 333], ['txt-old', 0, 'posted', true], ['cathay-win', 0, 'cat', '飲食']].forEach(([msg, i, field, value]) => {
    const e = edit(p, server, rid(server, msg, i), field, value);
    assert.ok(e.call.args[3] != null, 'after the merge the edit sends the merged fingerprint');
    e.deliver();
    assertReload(p, server, 'edit ' + msg + ' ' + field + ' after the merge');
  });
  assert.ok(p.TXNS.find(t => t.merchant === '文字日期舊').posted, 'the older text-dated row is ticked 已記帳');
}

function testFullListAckDuringPartial() {
  // A delete returns the whole list: the history is complete, and the late read is ignored.
  const server = loadServer(fixture('asc'));
  const p = partialPage(server);
  const bg = take(p, 'getTxnsBefore');
  const victim = p.textRowKey(rid(server, 'cathay-new', 0));
  p.ROW_DELETE_INTENTS[victim] = { sent: false, button: null };
  p.trySendDelete(victim);
  const del = take(p, 'deleteTxn');
  del.success(wire(server.deleteTxn.apply(null, del.args)));
  assertReload(p, server, 'a delete during the partial phase');
  assert.ok(p.TXNS.find(t => t.id.split('|')[0] === 'cathay-new').id.endsWith('|0'), 'its duplicate siblings are renumbered');
  const sig = p.txnsSignature(p.TXNS);
  bg.success(server.getTxnsBefore.apply(null, bg.args));
  assert.strictEqual(p.txnsSignature(p.TXNS), sig, 'the late background read after a delete changes nothing');
  assertSameViews(p, fullPage(server), 'after a delete during the partial phase');

  // refreshTxns' getAllTxns is the whole list too.
  const server2 = loadServer(fixture('asc'));
  const p2 = partialPage(server2);
  p2.refreshTxns();
  take(p2, 'getAllTxns').success(wire(server2.getAllTxns()));
  assert.strictEqual(p2.HISTORY.complete, true, 'a refresh during the partial phase completes the history');
  assert.strictEqual(p2.OLDER_FP, null, 'with no fingerprint, exactly as a refresh always leaves it');
  take(p2, 'getTxnsBefore').success(server2.getTxnsBefore(2025, 10, 'whatever'));
  assert.deepStrictEqual(wire(p2.TXNS.map(t => t.rowId)), wire(fullPage(server2).TXNS.map(t => t.rowId)), 'the late read changes nothing');
}

function testLateAndRacingBackground() {
  // A bot row arrives inside the window between boot and the background read: the page's rows no
  // longer match, so the read returns the whole list, and the page shows the bot row too.
  const sheet = fixture('asc');
  const server = loadServer(sheet);
  const p = partialPage(server);
  const at = sheet.rows.findIndex(r => r[2] === '2024-07-04T01:00:00Z');
  sheet.rows.splice(at, 0, txnRow('bot-new', new Date('2026-09-30T01:00:00Z'), 'z', 499, '9999', '新的機器人列', { 10: '' }));
  const res = answerHistory(p, server);
  assert.ok(res.txns && !res.older, 'a recent row changed since boot: the whole list comes back');
  assertReload(p, server, 'background whole list');
  assert.ok(p.TXNS.some(t => t.rowId === 'bot-new'), 'the bot row is on the page');

  // A split (no list comes back) is written before the background read: the read's whole list
  // could predate nothing on screen, but it was issued before the split, so it is dropped and the
  // page refetches once the split has landed.
  const server2 = loadServer(fixture('asc'));
  const p2 = partialPage(server2);
  const target = rid(server2, 'm-40-0');
  p2.applySplit(target, '50');
  const split = take(p2, 'updateTxn');
  server2.updateTxn.apply(null, split.args);
  answerHistory(p2, server2);
  assert.strictEqual(p2.HISTORY.complete, false, 'a whole list issued before an in-flight write is not adopted');
  assert.strictEqual(p2.TXNS.find(t => t.rowId === target).amount, 50, 'the optimistic split stays on screen');
  noPending(p2, 'getAllTxns', 'no refetch while the write is still in flight');
  split.success({ ok: true });
  take(p2, 'getAllTxns').success(wire(server2.getAllTxns()));
  assertReload(p2, server2, 'refetch after a dropped background list', true);

  // The same split written AFTER the background read: the merge lands while the split is in flight
  // and keeps it, and the next edit sees the split in the sheet and gets the whole list.
  const server3 = loadServer(fixture('asc'));
  const p3 = partialPage(server3);
  p3.applySplit(rid(server3, 'm-40-0'), '50');
  const split3 = take(p3, 'updateTxn');
  const res3 = answerHistory(p3, server3);
  assert.ok(res3.older, 'the read came first: the older-rows shape');
  assert.strictEqual(p3.HISTORY.complete, true, 'the merge adds only older rows, so it is adopted even with a write in flight');
  assert.strictEqual(p3.TXNS.find(t => t.rowId === rid(server3, 'm-40-0')).amount, 50, 'the optimistic split survives the merge');
  server3.updateTxn.apply(null, split3.args);
  split3.success({ ok: true });
  noPending(p3, 'getAllTxns', 'nothing was dropped, so nothing is refetched');
  const e = edit(p3, server3, rid(server3, 'cathay-old', 0), 'posted', true);
  assert.ok(e.res.txns, 'the split changed a row the merged fingerprint covers: the next edit gets the whole list');
  e.deliver();
  assertReload(p3, server3, 'edit after a split that raced the merge');

  // A manual add dated before the loaded range, landed before the background read: the read
  // carries the row in its sheet position, and the page's own copy is not kept twice.
  const sheet4 = fixture('asc');
  const server4 = loadServer(sheet4);
  const p4 = partialPage(server4);
  Object.assign(p4.nodes, formDocument({ 'a-date': '2024-05-20', 'a-time': '', 'a-amt': '64', 'a-type': '支出',
    'a-source': '現金', 'a-mer': '補記很久以前', 'a-cat': '飲食' }).nodes);
  p4.submitAdd();
  const add = take(p4, 'addTxn');
  add.success(wire(server4.addTxn.apply(null, add.args)));
  answerHistory(p4, server4);
  assert.strictEqual(p4.TXNS.filter(t => t.merchant === '補記很久以前').length, 1, 'the backdated add appears once');
  assertReload(p4, server4, 'backdated add before the background read');
  edit(p4, server4, rid(server4, 'cathay-win', 0), 'posted', true).deliver();
  assertReload(p4, server4, 'edit after that');
}

function testBackgroundFailureAndRetry() {
  const server = loadServer(fixture('asc'));
  const p = partialPage(server);
  take(p, 'getTxnsBefore').failure(new Error('逾時'));
  assert.strictEqual(p.HISTORY.complete, false, 'a failed read leaves the history incomplete');
  const all = body(p, { tab: 'analysis', scope: 'all' });
  assert.ok(all.indexOf('完整歷史載入失敗') >= 0 && all.indexOf('data-hretry') >= 0, '全部期間 shows the failure and a retry control');
  assert.ok(all.indexOf('<button class="ev-toggle" style="margin-left:6px" data-hretry title="逾時">重試</button>') >= 0,
    'the retry control is a well-formed button carrying the error');
  assert.ok(all.indexOf('class="kpi"') < 0, 'and still no partial number');
  const month = show(p, { tab: 'analysis', scope: 'month' });
  assert.ok(month.indexOf('class="kpi"') >= 0 && month.indexOf('row-card') >= 0, 'the recent view stays usable');
  assert.ok(month.indexOf('data-hretry') >= 0, 'with the retry control in view');
  assert.ok(month.indexOf('vs 月常態') < 0, 'and its baselines still wait');
  assert.ok(show(p, { tab: 'inbox' }).indexOf('<span class="tsub">完整歷史載入失敗</span>') >= 0, 'the inbox badge says so too');
  // The recent view still edits; the edit's whole list would complete the history, so retry first.
  p.loadHistory();
  const again = take(p, 'getTxnsBefore');
  assert.strictEqual(p.HISTORY.failed, null, 'retrying clears the failure');
  assert.ok(body(p, { tab: 'analysis', scope: 'all' }).indexOf(WAIT) >= 0, 'and shows the loading state again');
  again.success(server.getTxnsBefore.apply(null, again.args));
  assertReload(p, server, 'after a retry');
  assertSameViews(p, fullPage(server), 'after a retry');

  // Failure, then an edit: its whole list completes the history without any retry.
  const server2 = loadServer(fixture('asc'));
  const p2 = partialPage(server2);
  take(p2, 'getTxnsBefore').failure(new Error('逾時'));
  edit(p2, server2, rid(server2, 'cathay-win', 0), 'posted', true).deliver();
  assertReload(p2, server2, 'an edit after a failed read');
  assert.strictEqual(show(p2, { tab: 'analysis', scope: 'all' }).indexOf('data-hretry'), -1, 'and the retry control is gone');
}

// A retry clicked while a tick is still in flight, after a bot row has landed since boot: the
// retried read comes back as the whole list, read BEFORE the tick's write. It must not overwrite
// the tick on screen; it is dropped and the tick's own whole list completes the history.
function testRetryRacesInFlightEdit() {
  const sheet = fixture('asc');
  const server = loadServer(sheet);
  const p = partialPage(server);
  take(p, 'getTxnsBefore').failure(new Error('逾時'));
  const target = p.TXNS.find(t => !t.posted && t.rowId);
  assert.ok(target, 'precondition: a loaded pending row to tick');
  p.applyEdit(target.rowId, 'posted', true);
  const tick = take(p, 'updateTxn');
  const at = sheet.rows.findIndex(r => r[2] === '2024-07-04T01:00:00Z');
  sheet.rows.splice(at, 0, txnRow('bot-new', new Date('2026-09-30T01:00:00Z'), 'z', 499, '9999', '新的機器人列', { 10: '' }));
  p.loadHistory();
  const retry = take(p, 'getTxnsBefore');
  const raw = server.getTxnsBefore.apply(null, retry.args);
  const res = parsed(raw);
  assert.ok(res.txns, 'precondition: the retried read returns the whole list');
  assert.strictEqual(res.txns.find(t => t.rowId === target.rowId).posted, false, 'precondition: read before the tick landed');
  retry.success(raw);
  assert.strictEqual(p.TXNS.find(t => t.rowId === target.rowId).posted, true, 'the retried whole list does not overwrite the in-flight tick');
  assert.strictEqual(p.HISTORY.complete, false, 'and is not adopted as the history');
  noPending(p, 'getAllTxns', 'no refetch while the tick is still in flight');
  const tickRes = wire(server.updateTxn.apply(null, tick.args));
  tick.success(tickRes);
  noPending(p, 'getAllTxns', 'the tick\'s whole list settles the dropped read without another one');
  assertReload(p, server, 'tick after a dropped retry');
  assert.ok(p.TXNS.find(t => t.rowId === target.rowId).posted && p.TXNS.some(t => t.rowId === 'bot-new'), 'the tick and the bot row are both on the page');

  // Same race, but the tick fails: the dropped read is refetched once nothing is in flight.
  const sheet2 = fixture('asc');
  const server2 = loadServer(sheet2);
  const p2 = partialPage(server2);
  take(p2, 'getTxnsBefore').failure(new Error('逾時'));
  const target2 = p2.TXNS.find(t => !t.posted && t.rowId);
  p2.applyEdit(target2.rowId, 'posted', true);
  const tick2 = take(p2, 'updateTxn');
  sheet2.rows.splice(sheet2.rows.findIndex(r => r[2] === '2024-07-04T01:00:00Z'), 0,
    txnRow('bot-new', new Date('2026-09-30T01:00:00Z'), 'z', 499, '9999', '新的機器人列', { 10: '' }));
  p2.loadHistory();
  const retry2 = take(p2, 'getTxnsBefore');
  retry2.success(server2.getTxnsBefore.apply(null, retry2.args));
  assert.strictEqual(p2.TXNS.find(t => t.rowId === target2.rowId).posted, true, 'failing tick: the retried list is still dropped while it is in flight');
  tick2.failure(new Error('寫入失敗'));
  take(p2, 'getAllTxns').success(wire(server2.getAllTxns()));
  assertReload(p2, server2, 'refetch after a failed tick and a dropped retry', true);
  assert.strictEqual(p2.TXNS.find(t => t.rowId === target2.rowId).posted, false, 'the failed tick is not shown as written');
}

const CASES = { testServerSplit, testPartialViews, testEditDuringPartial, testFullListAckDuringPartial,
  testLateAndRacingBackground, testBackgroundFailureAndRetry, testRetryRacesInFlightEdit };

function run() {
  Object.keys(CASES).forEach(name => CASES[name]());
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_history_split');
} else {
  module.exports = { run, CASES, fixtureRows };
}
