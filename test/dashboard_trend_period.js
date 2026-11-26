'use strict';
/*
 * #103: one 月 / 年 period control above the tabs, shared by 總覽 and 趨勢, and a 趨勢 tab that follows
 * the selection: a 12-month window around the selected month (state.trendWinEnd), one bar per year
 * in 年, and a 明細 panel whose selected period expands to Top 商店, 定期扣款 and a jump to 總覽.
 *
 * Runs the WHOLE inline script of ToolPanel.html against a stub document, on synthetic rows with a
 * fixed NOW (2026-11-15, so November is the running month). Covered:
 *   (1)  the header: 月 / 年 + stepper above the tabs on 總覽 and 趨勢; no 當年 / 全部; none on 待記帳.
 *   (3)  月 ↔ 年: the year of the month; back to 月 keeps selMonth, clamped to now and the first data month.
 *   (5)  the window re-clamp: containment, one-month shift on stepping, no shift on a tap, the
 *        first-data and current-month clamps, a selection set on 總覽 contained when 趨勢 renders.
 *   (6)  every 月 / 年 press resets state.trendWinEnd; a bar / row tap leaves it.
 *   (9)  只看日常: the 3-month average has a point on the window's first two bars, none on the running
 *        month, none where month − 2 is before the first data month.
 *   (10) 每月明細 lists exactly the window, newest first, the selected row highlighted.
 *   (11, 13) 年: 每年支出, one bar per year, full-year totals, the current year faded, month counts;
 *        no baseline or average; waits while the history is partial.
 *   (14) the expansion: top 5 merchants, 定期扣款 $X · N 筆 summed per subscription with N counting
 *        rows, the empty states, the 總覽 button; never a transaction list.
 *   (16) 趨勢 has no 信用卡別 / 定期訂閱 / standalone Top 商店 panel.
 *   wiring: a bar / row tap (click, Enter) selects; the 總覽 button switches tab keeping the selection.
 *
 * NOT evidence of the rendered layout at 390px or on the deployed dashboard: that is the owner's
 * post-deploy check.
 */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { extractInlineScript, PANEL } = require('./extract_panel');

const NOW = { year: 2026, month: 11, day: 15 };

function page(rows, opts) {
  opts = opts || {};
  const script = extractInlineScript(fs.readFileSync(PANEL, 'utf8'))
    .replace('<?= now.year ?>', String(NOW.year)).replace('<?= now.month ?>', String(NOW.month))
    .replace('<?= now.day ?>', String(NOW.day)).replace('<?= sheetUrl ?>', 'https://example.invalid/sheet');
  const nodes = {};
  const fakes = {};   // selector -> fake elements attach() should wire
  function node() {
    return { innerHTML: '', value: '', textContent: '', disabled: false, classList: { add() {}, remove() {}, contains: () => false },
      querySelectorAll: sel => fakes[sel] || [], querySelector: () => null, focus() {}, select() {} };
  }
  const document = {
    activeElement: null, querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
    getElementById(id) { return nodes[id] || (nodes[id] = node()); }
  };
  const run = new Proxy({}, { get(_, name) {
    if (name === 'withSuccessHandler' || name === 'withFailureHandler') return () => run;
    return () => {};
  } });
  const sandbox = { console, document, window: { pageXOffset: 0, pageYOffset: 0, scrollTo() {} },
    google: { script: { run } }, setTimeout: () => 0, clearTimeout() {} };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  sandbox.TXNS = rows;
  sandbox.PROJECTS = opts.projects || [];
  sandbox.SUB_IGNORES = [];
  sandbox.nodes = nodes;
  sandbox.fakes = fakes;
  return sandbox;
}

let seq = 0;
function txn(y, m, d, amount, merchant, cat, type) {
  return { id: 'r' + (++seq), rowId: 'r' + seq, y, m, d, amount, charged: amount, mine: null, merchant, cat: cat || '飲食',
    type: type || '支出', bank: '國泰', last4: '1234', posted: true, hm: '12:00' };
}
function key(y, m) { return y + '-' + ('0' + m).slice(-2); }
function addMonths(k, n) { const p = k.split('-'), t = (+p[0]) * 12 + (+p[1] - 1) + n; return key(Math.floor(t / 12), t % 12 + 1); }

/** 2025-03 .. 2026-11: a daily 全聯 row each month (zig-zagging, so it is never a subscription), 薪資 income, Netflix
 *  390 on the 5th from 2025-10, KKBOX 149 from 2026-06, a 房屋 project row in 2026-03, and six
 *  small merchants in 2026-03 so Top 商店 has more than five candidates. */
function fixture() {
  const rows = [];
  let i = 0;
  for (let k = '2025-03'; k <= '2026-11'; k = addMonths(k, 1), i++) {
    const [y, m] = k.split('-').map(Number);
    rows.push(txn(y, m, 10, 10000 + 1000 * i + (i % 2 ? 6000 : 0), '全聯'));
    rows.push(txn(y, m, 1, 80000, '公司', '薪資', '收入'));
    if (k >= '2025-10') rows.push(txn(y, m, 5, 390, 'Netflix', '娛樂'));
    if (k >= '2026-06') rows.push(txn(y, m, 7, 149, 'KKBOX', '娛樂'));
  }
  rows.push(txn(2026, 3, 20, 50000, '裝潢行', '房屋'));
  ['甲', '乙', '丙', '丁', '戊', '己'].forEach((n, j) => rows.push(txn(2026, 3, 12, 100 + j, n + '店')));
  return rows;
}

function show(p, st) {
  Object.assign(p.state, st || {});
  p.render();
  return p.nodes.app.innerHTML;
}
function trend(p) { return p.trendTab(); }
function windowKeys(h) {
  const chart = h.slice(h.indexOf('<div class="tc-bars'), h.indexOf('<div class="tlegend"'));
  return [...chart.matchAll(/class="tc-col[^"]*" data-tsel="([^"]+)"/g)].map(m => m[1]);
}
function tableKeys(h) {
  const t = h.slice(h.indexOf('<tbody>'), h.indexOf('</tbody>'));
  return [...t.matchAll(/<tr(?: class="sel" aria-selected="true"| data-tsel="([^"]+)" tabindex="0" aria-selected="false")><td>([^<]*)<\/td>/g)]
    .map(m => m[1] || 'SEL:' + m[2]);
}
function avgPoints(h) {
  const m = h.match(/<polyline class="tl-avg" points="([^"]*)"\/>/);
  return m ? m[1].split(' ').map(s => s.split(',').map(Number)) : [];
}

// ---------------------------------------------------------------- (1) header
function testHeader() {
  const p = page(fixture());
  const ov = show(p, { tab: 'analysis' });
  const head = ov.slice(0, ov.indexOf('<div class="tabs">'));
  assert.ok(head.indexOf('<div class="controls period-controls">') >= 0, '(1) the period control sits above the tab bar on 總覽');
  assert.ok(/<button type="button" data-period="month" aria-pressed="true">月<\/button><button type="button" data-period="year" aria-pressed="false">年<\/button>/.test(head),
    '(1) a 月 / 年 segmented switch');
  assert.ok(head.indexOf('<span class="step-label num">2026 年 11 月</span>') >= 0, '(1) and the stepper');
  [ov, show(p, { tab: 'trend' })].forEach(h => {
    assert.ok(h.indexOf('當年') < 0 && h.indexOf('data-period="all"') < 0 && h.indexOf('全部期間') < 0, '(1) no 當年, no 全部, no 全部期間');
    assert.strictEqual((h.match(/period-controls/g) || []).length, 1, '(1) exactly one period control');
  });
  const tr = show(p, { tab: 'trend' });
  assert.ok(tr.indexOf('period-controls') < tr.indexOf('<div class="tabs">'), '(1) above the tabs on 趨勢 too');
  const inbox = show(p, { tab: 'inbox' });
  assert.ok(inbox.indexOf('period-controls') < 0 && inbox.indexOf('data-period') < 0 && inbox.indexOf('data-step') < 0, '(1) no shared control on 待記帳');
  assert.ok(inbox.indexOf('data-iscope="all"') > inbox.indexOf('<div class="tabs">'), '(1) 待記帳 keeps its 全部 / 本年 under the tabs');
  assert.strictEqual(p.periodLabel(p.resolveScope('year')), '2026 全年(1–11 月)', 'a year label is unchanged');
  p.setPeriod('all');
  assert.strictEqual(p.state.scope, 'month', 'setPeriod no longer produces 全部');
}

// ---------------------------------------------------------------- (3) 月 ↔ 年
function testSwitch() {
  const p = page(fixture());
  show(p, { tab: 'trend', scope: '2025-05', selYear: 2025, selMonth: 5 });
  p.setPeriod('year');
  assert.strictEqual(p.state.scope, '2025', '(3) 月 → 年 selects the year of the month');
  p.setPeriod('month');
  assert.strictEqual(p.state.scope, '2025-05', '(3) 年 → 月 keeps the stored month');
  Object.assign(p.state, { scope: 'year', selYear: 2026, selMonth: 12 });
  p.setPeriod('month');
  assert.deepStrictEqual([p.state.scope, p.state.selMonth], ['month', 11], '(3) in the current year, no later than this month');
  Object.assign(p.state, { scope: '2025', selYear: 2025, selMonth: 1 });
  p.setPeriod('month');
  assert.strictEqual(p.state.scope, '2025-03', '(3) never before the first data month');
  // (4) the stepper bounds
  Object.assign(p.state, { scope: '2025-03', selYear: 2025, selMonth: 3 });
  assert.ok(p.periodControls().indexOf('data-step="-1" aria-label="上一個月" disabled') >= 0, '(4) ‹ disables at the first data month');
  Object.assign(p.state, { scope: 'year', selYear: 2026 });
  assert.ok(p.periodControls().indexOf('data-step="1" aria-label="下一年" disabled') >= 0, '(4) › disables at the current year');
}

// ---------------------------------------------------------------- (5, 6, 10) the window
function testWindow() {
  const p = page(fixture());
  let h = show(p, { tab: 'trend', scope: 'month', selYear: 2026, selMonth: 11, trendWinEnd: null });
  const W = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
  assert.deepStrictEqual(windowKeys(h), W, '(5) the default window ends at the selected month');
  assert.strictEqual(p.state.trendWinEnd, '2026-11', '(5) and is written back');
  assert.deepStrictEqual(tableKeys(h), W.slice().reverse().map(k => k === '2026-11' ? 'SEL:26/11 至今' : k), '(10) 每月明細 lists exactly the window, newest first');

  // Stepping back inside the window never moves it; leaving it shifts it by exactly one.
  for (let i = 0; i < 11; i++) { p.stepPeriod(-1); h = show(p); }
  assert.strictEqual(p.state.scope, '2025-12');
  assert.deepStrictEqual(windowKeys(h), W, '(5) stepping inside the window leaves it');
  p.stepPeriod(-1); h = show(p);
  assert.deepStrictEqual(windowKeys(h), ['2025-11'].concat(W.slice(0, 11)), '(5) one step past its left edge shifts it by one month');
  p.stepPeriod(1); h = show(p);
  assert.deepStrictEqual(windowKeys(h), ['2025-11'].concat(W.slice(0, 11)), '(5) stepping back inside does not shift it');

  // A bar / row tap selects only.
  p.selectPeriod('2026-05'); h = show(p);
  assert.deepStrictEqual([p.state.scope, p.state.selYear, p.state.selMonth], ['2026-05', 2026, 5], '(6) a tap selects the month');
  assert.strictEqual(p.state.trendWinEnd, '2026-10', '(6) and leaves the window');
  assert.ok(/<div class="tc-col sel" data-tsel="2026-05" role="button" tabindex="0" aria-pressed="true"/.test(h), '(8) the selected bar is framed');
  assert.ok(h.indexOf('<div class="tc-bars has-sel">') >= 0, '(8) the others are dimmed');
  assert.ok(/<tr class="sel" aria-selected="true"><td>26\/05<\/td>/.test(h), '(10) the selected row is highlighted');

  // Every 月 / 年 press re-defaults the window to end at the selection.
  p.setPeriod('month');
  assert.strictEqual(p.state.trendWinEnd, null, '(6) a 月 press resets the window');
  h = show(p);
  assert.strictEqual(windowKeys(h).pop(), '2026-05', '(6) which then ends at the selection');
  p.setPeriod('year'); assert.strictEqual(p.state.trendWinEnd, null, '(6) so does a 年 press');
  p.setPeriod('month');

  // First-data clamp: a window never starts before the first data month.
  p.selectPeriod('2025-04'); p.state.trendWinEnd = null; h = show(p);
  assert.deepStrictEqual(windowKeys(h)[0], '2025-03', '(5) the window starts at the first data month');
  assert.strictEqual(windowKeys(h).length, 12, '(5) and still holds 12 months');
  assert.strictEqual(p.state.trendWinEnd, '2026-02');
  // Current-month cap.
  p.state.trendWinEnd = '2027-03'; p.selectPeriod('2026-10'); h = show(p);
  assert.strictEqual(windowKeys(h).pop(), '2026-11', '(5) the window never ends after the current month');

  // A selection set on 總覽 is contained when 趨勢 renders.
  show(p, { tab: 'analysis', trendWinEnd: '2026-11' });
  p.stepPeriod(-1);
  Object.assign(p.state, { scope: '2025-06', selYear: 2025, selMonth: 6 });
  h = show(p, { tab: 'trend' });
  assert.strictEqual(windowKeys(h).pop(), '2026-05', '(5) a selection made on 總覽 is brought inside the window');
  assert.ok(windowKeys(h).indexOf('2025-06') === 0, '(5) by the least move');

  // Fewer than 12 bars when less data exists.
  const q = page(fixture().filter(t => t.y === 2026 && t.m >= 5));
  h = show(q, { tab: 'trend', scope: '2026-06', selYear: 2026, selMonth: 6, trendWinEnd: null });
  assert.deepStrictEqual(windowKeys(h), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'], '(5) months before the first data month are not drawn');
}

// ---------------------------------------------------------------- (7) history gate
function testHistoryGate() {
  const p = page(fixture().filter(t => key(t.y, t.m) >= '2025-11'));
  p.HISTORY = { complete: false, before: { y: 2025, m: 11 }, loadedFp: null, loading: true, failed: null };
  let h = show(p, { tab: 'trend', scope: 'month', selYear: 2026, selMonth: 11, trendWinEnd: null, trendMode: 'all' });
  assert.ok(trend(p).indexOf('class="tchart"') >= 0, '(7) 日常＋專案: the window 2025-12..2026-11 is loaded and renders');
  p.state.trendMode = 'daily';
  h = trend(p);
  assert.ok(h.indexOf('載入完整歷史中…') >= 0 && h.indexOf('class="tchart"') < 0 && h.indexOf('mtable') < 0,
    '(7) 只看日常 waits for 2025-10, which the first average point reads');
  p.state.trendMode = 'all';
  p.selectPeriod('2025-11'); h = trend(p);
  assert.ok(h.indexOf('class="tchart"') >= 0, '(7) a window starting at the first loaded month renders');
  Object.assign(p.state, { scope: '2025-11', selYear: 2025, selMonth: 11, trendWinEnd: '2026-08' });
  h = trend(p);
  assert.ok(h.indexOf('載入完整歷史中…') >= 0, '(7) the gate reads the unclamped start (2025-09), not one clamped to the first loaded month');
  assert.strictEqual(p.state.trendWinEnd, '2026-08', '(7) and only the selection-driven end is kept');
  Object.assign(p.state, { scope: 'year', selYear: 2026 });
  h = trend(p);
  assert.ok(h.indexOf('載入完整歷史中…') >= 0 && h.indexOf('class="tchart"') < 0, '(11) 年 waits for the whole history');
}

// ---------------------------------------------------------------- (9) 3-month average
function testAverage() {
  const p = page(fixture());
  let h = show(p, { tab: 'trend', scope: 'month', selYear: 2026, selMonth: 11, trendWinEnd: null, trendMode: 'daily' });
  let pts = avgPoints(h);
  assert.strictEqual(pts.length, 11, '(9) one point per complete month, the first two bars included, none on the running month');
  assert.strictEqual(pts[0][0], +(0.5 / 12 * 100).toFixed(2), '(9) the first point sits on the first bar');
  const mt = p.monthTotals();
  const max = Math.ceil(Math.max(...windowKeys(h).map(k => mt[k].daily), ...windowKeys(h).map(k => mt[k].income), p.dailyBaseline('2026-11', mt).ref) / 10000) * 10000;
  const v = (mt['2025-12'].daily + mt['2025-11'].daily + mt['2025-10'].daily) / 3;
  assert.strictEqual(pts[0][1], +((1 - v / max) * 100).toFixed(2), '(9) and averages 2025-12 with the two months before the window');
  assert.ok(h.indexOf('<line class="tl-base"') >= 0, '(9) the dashed baseline stays');
  p.selectPeriod('2025-04'); p.state.trendWinEnd = null;
  h = show(p);
  pts = avgPoints(h);
  assert.strictEqual(pts.length, 10, '(9) no point where month − 2 is before the first data month');
  assert.strictEqual(pts[0][0], +(2.5 / 12 * 100).toFixed(2), '(9) the first point is the third bar (2025-05)');
}

// ---------------------------------------------------------------- (11, 13) 年
function testYear() {
  const p = page(fixture(), { projects: [{ name: '房屋', start: '2026-01' }] });
  let h = show(p, { tab: 'trend', scope: 'year', selYear: 2026, trendMode: 'daily' });
  assert.ok(h.indexOf('<h3>每年支出 ') >= 0, '(11) title 每年支出');
  assert.deepStrictEqual(windowKeys(h), ['2025', '2026'], '(11) one bar per year from the first data year');
  assert.ok(/<div class="tc-col partial sel" data-tsel="2026"/.test(h) && /<div class="tc-col" data-tsel="2025"/.test(h), '(11) the current year is faded and selected');
  assert.ok(h.indexOf('tl-base') < 0 && h.indexOf('tl-avg') < 0 && h.indexOf('3 個月平均') < 0, '(12) no baseline or average in 年');
  assert.ok(h.indexOf('tl-inc') >= 0, '(12) the income line stays');
  assert.ok(h.indexOf('<h3>每年明細</h3>') >= 0, '(13) 每年明細');
  assert.ok(h.indexOf('<td>2026 · 11 個月</td>') >= 0 && h.indexOf('<td>2025 · 10 個月</td>') >= 0, '(13) month counts');
  const rows = p.yearRows(p.monthTotals());
  const mt = p.monthTotals();
  const sum = (y, f) => Object.keys(mt).filter(k => k.startsWith(y)).reduce((s, k) => s + f(mt[k]), 0);
  assert.strictEqual(rows[1].daily, sum('2026', o => o.daily), '(11) the full-year daily total');
  assert.strictEqual(rows[1].proj['房屋'], 50000, '(11) each project summed over the year');
  assert.strictEqual(rows[1].total, rows[1].daily + 50000, '(11) total = daily + projects');
  p.selectPeriod('2025'); h = show(p);
  assert.strictEqual(p.state.scope, '2025', '(11) a bar tap selects that year');
  assert.ok(/<div class="tc-col sel" data-tsel="2025"/.test(h), '(11) and highlights it');
}

// ---------------------------------------------------------------- (14) expansion
function testDetail() {
  const p = page(fixture());
  let d = p.periodDetail('2026', true);
  assert.ok(d.indexOf('<div class="pd-h">定期扣款 <span class="num">$5,184 · 17 筆</span></div>') >= 0,
    '(14) 年: X sums every charge of the year, N counts them (11 Netflix + 6 KKBOX)');
  assert.ok(d.indexOf('<span class="ln">Netflix</span><span class="la num">$4,290</span>') >= 0 &&
    d.indexOf('<span class="ln">KKBOX</span><span class="la num">$894</span>') >= 0, '(14) one line per subscription, summed');
  assert.ok(d.indexOf('在總覽看這一年 →') >= 0 && d.indexOf('data-goov') >= 0, '(14) the 總覽 button, 年 wording');
  assert.ok(d.indexOf('年約') < 0, '(14) no 年約 figure');
  d = p.periodDetail('2026-03', false);
  assert.ok(d.indexOf('定期扣款 <span class="num">$390 · 1 筆</span>') >= 0, '(14) 月: one charge');
  const top = d.slice(d.indexOf('Top 商店'), d.indexOf('定期扣款'));
  assert.strictEqual((top.match(/class="lrow"/g) || []).length, 5, '(14) Top 商店 is capped at 5');
  assert.ok(/<span class="ln">裝潢行<\/span><span class="ls num">1 筆<\/span><span class="la num">\$50,000<\/span>/.test(top), '(14) name, N 筆, amount, largest first');
  assert.ok(d.indexOf('在總覽看這個月 →') >= 0, '(14) 月 wording');
  assert.ok(d.indexOf('category-txn') < 0 && d.indexOf('class="txn"') < 0, '(14) never a transaction list');
  d = p.periodDetail('2025-05', false);
  assert.ok(d.indexOf('<div class="pd-h">定期扣款</div><div class="pd-none">這期間沒有定期扣款</div>') >= 0, '(14) the empty state, without $X · N 筆');
  d = p.periodDetail('2024-02', false);
  assert.ok(d.indexOf('<div class="pd-none">這期間沒有支出</div>') >= 0, '(14) no consumption: 這期間沒有支出');
  // Only the selected period is expanded, in the table and in the phone list.
  const h = show(p, { tab: 'trend', scope: '2026-03', selYear: 2026, selMonth: 3, trendWinEnd: null, trendMode: 'all' });
  assert.strictEqual((h.match(/class="pdetail"/g) || []).length, 2, '(15) one expansion in the table, one in the list');
  assert.ok(/<tr class="mdetail"><td colspan="3"><div class="pdetail">/.test(h), '(15) a full-width detail row on desktop');
}

// ---------------------------------------------------------------- (16) removals
function testRemovals() {
  const p = page(fixture());
  ['month', 'year'].forEach(scope => {
    const h = show(p, { tab: 'trend', scope, selYear: 2026, selMonth: 11, trendMode: 'all' });
    const body = h.slice(h.indexOf('<div class="head">'));
    assert.ok(body.indexOf('信用卡別') < 0 && body.indexOf('定期訂閱') < 0 && body.indexOf('<h3>Top 商店') < 0, '(16) ' + scope + ': no removed panel');
    assert.strictEqual((trend(p).match(/<div class="panel"/g) || []).length, 2, '(16) ' + scope + ': exactly two panels');
  });
  const src = extractInlineScript(fs.readFileSync(PANEL, 'utf8'));
  ['cardPanel', 'subPanel', 'topMerchants', 'PALETTE'].forEach(n => assert.ok(src.indexOf(n) < 0, '(16) ' + n + ' is deleted'));
  assert.ok(fs.readFileSync(PANEL, 'utf8').indexOf('.cardrow') < 0, '(16) and its CSS');
}

// ---------------------------------------------------------------- wiring
function testWiring() {
  const p = page(fixture());
  show(p, { tab: 'trend', scope: 'month', selYear: 2026, selMonth: 11, trendWinEnd: null, trendMode: 'all' });
  const bar = { getAttribute: () => '2026-07' };
  const goov = {};
  p.fakes['[data-tsel]'] = [bar];
  p.fakes['[data-goov]'] = [goov];
  p.attach();
  bar.onclick.call(bar);
  assert.deepStrictEqual([p.state.scope, p.state.trendWinEnd], ['2026-07', '2026-11'], 'a bar click selects without moving the window');
  const row = { getAttribute: () => '2026-02' };
  p.fakes['[data-tsel]'] = [row];
  p.attach();
  let prevented = false;
  row.onkeydown.call(row, { key: 'Enter', preventDefault() { prevented = true; } });
  assert.ok(prevented && p.state.scope === '2026-02', 'Enter on a row selects it');
  p.fakes['[data-tsel]'] = [];
  p.attach();
  goov.onclick({ stopPropagation() {} });
  assert.deepStrictEqual([p.state.tab, p.state.scope], ['analysis', '2026-02'], 'the 總覽 button switches tab and keeps the selection');
}

const CASES = { testHeader, testSwitch, testWindow, testHistoryGate, testAverage, testYear, testDetail, testRemovals, testWiring };

function run() {
  Object.keys(CASES).forEach(n => CASES[n]());
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_trend_period');
} else {
  module.exports.run = run;
  module.exports.CASES = CASES;
}
