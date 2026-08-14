'use strict';
const assert = require('assert');
const { loadFns } = require('./extract_panel');

function txn(d, type, amount) {
  return { y: 2026, m: 8, d: d, type: type, amount: amount };
}

function cellHtml(panel, day) {
  const re = new RegExp('<div class="(cell[^"]*)"([^>]*)><span class="dn num">' + day + '</span>(.*?)</div>');
  const m = panel.match(re);
  assert.ok(m, 'cell for day ' + day + ' missing');
  return { cls: m[1], attrs: m[2], inner: m[3] };
}

function run() {
  const now = { year: 2026, month: 8, day: 14 };
  const txns = [
    txn(1, '支出', 500),
    txn(2, '收入', 80000),
    txn(3, '轉帳', 1000),
    txn(5, '支出', 0),
    txn(20, '支出', 100)
  ];
  const fns = loadFns(['daysInMonth', 'fmt', 'blendSpend', 'heatDaysForMonth', 'heatPanel'], {
    TXNS: txns,
    NOW: now,
    openHeatDay: null,
    dayEditor: function () { return ''; }
  });
  const kinds = {};
  fns.heatDaysForMonth(txns, 2026, 8, now).forEach(function (x) { kinds[x.d] = x; });

  assert.strictEqual(kinds[1].kind, 'spend-hit');
  assert.strictEqual(kinds[2].kind, 'zero-spend-hit');
  assert.strictEqual(kinds[3].kind, 'zero-spend-hit');
  assert.strictEqual(kinds[4].kind, 'inert');
  assert.strictEqual(kinds[5].kind, 'spend-hit');
  assert.strictEqual(kinds[5].v, 0);
  assert.strictEqual(kinds[14].kind, 'inert');
  assert.strictEqual(kinds[20].kind, 'inert');
  assert.ok(kinds[20].future);

  const spentDays = Object.keys(kinds).filter(function (d) {
    return !kinds[d].future && kinds[d].v > 0;
  }).length;
  assert.strictEqual(spentDays, 1, '有消費 counts expense totals > 0 only (not payday, not $0 split)');

  const html = fns.heatPanel({ level: 'month', year: 2026, month: 8 });
  assert.ok(html.indexOf('點有交易的日子看當天明細') >= 0);
  assert.strictEqual(html.indexOf('點任一格'), -1);

  const c1 = cellHtml(html, 1);
  const c2 = cellHtml(html, 2);
  const c3 = cellHtml(html, 3);
  const c4 = cellHtml(html, 4);
  const c5 = cellHtml(html, 5);
  const c20 = cellHtml(html, 20);

  assert.ok(/\bhit\b/.test(c1.cls) && c1.attrs.indexOf('data-hday=') >= 0);
  assert.strictEqual(c1.inner.indexOf('class="mark"'), -1, 'expense day has no dot');

  assert.ok(/\bhit\b/.test(c2.cls) && c2.inner.indexOf('class="mark"') >= 0, 'income-only day: hit + dot');
  assert.ok(/\bhit\b/.test(c3.cls) && c3.inner.indexOf('class="mark"') >= 0, 'transfer-only day: hit + dot');

  assert.ok(!/\bhit\b/.test(c4.cls) && c4.attrs.indexOf('data-hday=') < 0);
  assert.strictEqual(c4.inner.indexOf('class="mark"'), -1, 'empty day has no dot');

  assert.ok(/\bhit\b/.test(c5.cls), '$0 我的消費 expense day is still clickable');
  assert.strictEqual(c5.inner.indexOf('class="mark"'), -1);

  assert.ok(/\bfuture\b/.test(c20.cls) && !/\bhit\b/.test(c20.cls));
  assert.ok(/有消費 <b class="num">1<\/b> 天/.test(html));
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_heatmap_hit');
} else {
  module.exports = { run };
}
