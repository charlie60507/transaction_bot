'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadFns } = require('./extract_panel');

const SOURCE = path.resolve(__dirname, '..', 'sidebar', 'weekly_cfo.js');

function load() {
  const sandbox = { Date, JSON, Math, Number, String, Object, Array, RegExp, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), sandbox, { filename: 'weekly_cfo.js' });
  return sandbox;
}

function txn(date, amount, merchant, cat, extra) {
  const p = date.split('-').map(Number);
  return Object.assign({ y: p[0], m: p[1], d: p[2], amount, merchant, cat, type: '支出', rowId: date + '|' + merchant }, extra || {});
}

function monthlyHistory() {
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(2025, 9 + i, 10));
    const ymd = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-10';
    rows.push(txn(ymd, 10000 + i * 1000, '歷史商家' + i, '飲食'));
  }
  return rows;
}

function run() {
  const w = load();

  // Dashboard parity plus the intentional recorded-only projection difference.
  {
    const rows = monthlyHistory().concat([
      txn('2026-10-05', 2000, '餐廳', '飲食'),
      txn('2026-10-06', 1500, '理髮店', '個人', { type: '轉帳' }),
      txn('2026-10-07', 50000, '機票', '旅遊'),
      txn('2026-10-08', 500, '退款', '退款', { type: '收入' })
    ]);
    const projects = [{ name: '旅遊', start: '2026-01' }];
    const facts = w.weeklyCfoCalculate({ reportDate: '2026-10-12', transactions: rows, projects, baseline: { mode: 'median', amount: null } });
    assert.strictEqual(facts.week.daily, 3000, 'expense + categorized transfer - refund');
    assert.strictEqual(facts.week.project, 50000, 'project is separate');
    assert.strictEqual(facts.month.projection, Math.round(3000 / 11 * 31), 'projection uses recorded daily consumption only through Sunday');

    const panel = loadFns(['isIncome', 'isRefund', 'isConsumption', 'daysInMonth', 'ymKey', 'addMonths', 'keyCovered', 'projectStart', 'isProjectCat',
      'monthTotals', 'curPartialKey', 'baselineWindow', 'median_', 'sortNum', 'dailyBaseline'], {
      TXNS: rows, PROJECTS: projects, BASELINE: { mode: 'median', amount: null }, BASE_FLOOR: '2025-10',
      NOW: { year: 2026, month: 10, day: 11 }, historyCovers: () => true
    });
    const dashboardBaseline = panel.dailyBaseline('2026-10', panel.monthTotals());
    assert.strictEqual(facts.baseline.amount, Math.round(dashboardBaseline.ref), 'baseline matches dashboard');
    assert.strictEqual(facts.baseline.months, dashboardBaseline.months);
  }

  // A custom baseline wins, and any projection above it warns without another percentage gate.
  {
    const rows = [txn('2026-10-05', 1000, '早餐店', '飲食')];
    const facts = w.weeklyCfoCalculate({ reportDate: '2026-10-12', transactions: rows, projects: [], baseline: { mode: 'budget', amount: 2000 } });
    assert.strictEqual(facts.baseline.amount, 2000);
    assert.strictEqual(facts.overspending, true);
  }

  // The first seven days still project. A Monday on day 1 correctly reports the preceding month.
  {
    let facts = w.weeklyCfoCalculate({ reportDate: '2026-11-02', transactions: [txn('2026-11-01', 100, '早餐', '飲食')], baseline: { mode: 'budget', amount: 5000 } });
    assert.strictEqual(facts.month.elapsedDays, 1);
    assert.strictEqual(facts.month.projection, 3000);
    facts = w.weeklyCfoCalculate({ reportDate: '2026-06-01', transactions: [txn('2026-05-31', 3100, '月底採買', '超市')], baseline: { mode: 'budget', amount: 5000 } });
    assert.strictEqual(facts.month.key, '2026-05');
    assert.strictEqual(facts.month.elapsedDays, 31);
    assert.strictEqual(facts.month.projection, 3100);
  }

  // Twelve complete weekly buckets include zeros; overlapping large/new signals deduplicate.
  {
    const rows = [];
    for (let i = 1; i <= 12; i++) rows.push(txn('2026-07-' + String(i).padStart(2, '0'), 100, '舊餐廳', '飲食'));
    rows.push(txn('2026-10-05', 5000, '新店 123', '飲食'));
    rows.push(txn('2026-10-06', 2200, '第二新店', '個人'));
    const facts = w.weeklyCfoCalculate({ reportDate: '2026-10-12', transactions: rows, baseline: { mode: 'budget', amount: 99999 } });
    assert.ok(facts.observations.length <= 2);
    const named = facts.observations.map(o => o.merchant);
    assert.strictEqual(named.filter(n => n === '新店 123').length, 1, 'one merchant appears under only one candidate type');
    assert.ok(facts.observations.some(o => o.type === 'category-anomaly'), 'zero weekly buckets make the anomaly measurable');
  }

  // No recorded spending means an explicit null projection, not an invented value.
  {
    const facts = w.weeklyCfoCalculate({ reportDate: '2026-10-12', transactions: [], baseline: { mode: 'budget', amount: 10000 } });
    assert.strictEqual(facts.month.projection, null);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(facts.observations)), []);
    assert.strictEqual(w.weeklyCfoFallbackCopy(facts).explanations.length, 0, 'no generic advice');
  }

  // ISO week-year remains deterministic at the boundary.
  {
    const facts = w.weeklyCfoCalculate({ reportDate: '2027-01-04', transactions: [], baseline: { mode: 'budget', amount: 10000 } });
    assert.strictEqual(facts.weekKey, '2026-W53');
  }

  // Gemini is all-or-nothing: an invented number discards the whole copy.
  {
    const facts = w.weeklyCfoCalculate({ reportDate: '2026-10-12', transactions: [txn('2026-10-05', 5000, '3C 商店', '個人')], baseline: { mode: 'budget', amount: 10000 } });
    assert.strictEqual(w.weeklyCfoValidateGeminiCopy(facts, { conclusion: '本週 5,000 元', explanations: ['3C 商店值得留意'] }), true,
      'formatted fact numbers and merchant digits are allowed');
    assert.strictEqual(w.weeklyCfoValidateGeminiCopy(facts, { conclusion: '建議控制在 4,321 元', explanations: [] }), false);
    assert.strictEqual(w.weeklyCfoValidateGeminiCopy(facts, { conclusion: '正常', explanations: '不是陣列' }), false);
  }
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_weekly_cfo');
} else module.exports = { run };
