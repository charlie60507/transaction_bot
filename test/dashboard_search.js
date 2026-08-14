'use strict';
const assert = require('assert');
const fs = require('fs');
const { loadFns, PANEL } = require('./extract_panel');

function T(partial) {
  return Object.assign({
    id: 'id', y: 2026, m: 8, d: 10, hm: '10:00', merchant: 'x', cat: '其他',
    type: '支出', amount: 1, charged: 1, tag: '', bank: '富邦'
  }, partial);
}

function ids(hits) { return hits.map(function (t) { return t.id; }); }

function run() {
  const src = fs.readFileSync(PANEL, 'utf8');
  assert.ok(src.indexOf('placeholder="搜尋…"') >= 0);
  assert.strictEqual(src.indexOf('搜尋商店'), -1);
  assert.ok(/tabs button[\s\S]*?openHeatDay=null; render\(\);/.test(src), 'tab switch keeps state.q');
  assert.ok(/id="q"/.test(src));

  const txns = [
    T({ id: 'starbucks-aug', merchant: '星巴克 信義', cat: '飲食', amount: 1350, charged: 1350, y: 2026, m: 8, d: 12, hm: '09:00' }),
    T({ id: 'starbucks-jul', merchant: '星巴克 南京', cat: '飲食', amount: 120, charged: 120, y: 2026, m: 7, d: 3, hm: '18:00' }),
    T({ id: 'exact-350', merchant: '全聯', cat: '日用', amount: 350, charged: 350, y: 2026, m: 8, d: 1 }),
    T({ id: 'charged-350', merchant: '聚餐', cat: '飲食', amount: 200, charged: 350, y: 2026, m: 6, d: 20 }),
    T({ id: 'income-pay', merchant: '薪水', cat: '薪資', type: '收入', amount: 80000, charged: 80000, y: 2026, m: 5, d: 5 }),
    T({ id: 'tag-only', merchant: '中油', cat: '交通', tag: '重機', amount: 400, charged: 400, y: 2026, m: 4, d: 2 }),
    T({ id: 'bank-only', merchant: '無名店', cat: '其他', bank: '國泰', amount: 99, charged: 99, y: 2026, m: 3, d: 1 })
  ];
  const fns = loadFns(['numericQuery', 'txnMatchesQuery', 'searchHits', 'searchPanel'], {
    TXNS: txns,
    SEARCH_CAP: 40,
    state: { q: '' },
    esc: function (s) { return String(s); },
    editRow: function (t) { return '<div class="erow" data-erow="' + t.id + '"></div>'; }
  });

  assert.deepStrictEqual(ids(fns.searchHits(txns, '星巴克')).sort(), ['starbucks-aug', 'starbucks-jul'].sort());
  assert.deepStrictEqual(ids(fns.searchHits(txns, '薪資')), ['income-pay']);
  assert.deepStrictEqual(ids(fns.searchHits(txns, '飲食')).sort(), ['starbucks-aug', 'starbucks-jul', 'charged-350'].sort());

  const amt = ids(fns.searchHits(txns, '350')).sort();
  assert.deepStrictEqual(amt, ['charged-350', 'exact-350'].sort());
  assert.ok(amt.indexOf('starbucks-aug') < 0, '350 must not match amount 1350');
  assert.deepStrictEqual(ids(fns.searchHits(txns, '$350')).sort(), amt);
  assert.deepStrictEqual(ids(fns.searchHits(txns, '1,350')), ['starbucks-aug']);

  assert.deepStrictEqual(ids(fns.searchHits(txns, '重機')), [], 'TAG is not a search field');
  assert.deepStrictEqual(ids(fns.searchHits(txns, '國泰')), [], 'bank is not a search field');
  assert.deepStrictEqual(ids(fns.searchHits(txns, '2026')), [], 'date is not a search field');

  const ordered = ids(fns.searchHits(txns, '飲食'));
  assert.deepStrictEqual(ordered, ['starbucks-aug', 'starbucks-jul', 'charged-350'], 'newest date first');

  const many = [];
  for (let i = 0; i < 45; i++) many.push(T({ id: 'm' + i, merchant: '連鎖店', amount: 10 + i, charged: 10 + i, d: 1 + (i % 28) }));
  const capFns = loadFns(['numericQuery', 'txnMatchesQuery', 'searchHits', 'searchPanel'], {
    TXNS: many,
    SEARCH_CAP: 40,
    state: { q: '連鎖' },
    esc: function (s) { return String(s); },
    editRow: function (t) { return '<div class="erow" data-erow="' + t.id + '"></div>'; }
  });
  assert.strictEqual(capFns.searchHits(many, '連鎖店').length, 45);
  const html = capFns.searchPanel('連鎖店');
  assert.strictEqual((html.match(/class="erow"/g) || []).length, 40);
  assert.ok(html.indexOf('還有 5 筆') >= 0);
  assert.ok(html.indexOf('class="erow"') >= 0, 'results are editRow, not txnRow');
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_search');
} else {
  module.exports = { run };
}
