'use strict';
/*
 * #94: the 總覽 tab's 日常類別 card in the running month (sidebar/ToolPanel.html: dailyCard,
 * rowCard, catDelta).
 *
 * The whole inline script runs against the stub document of dashboard_project_split (page / view),
 * on synthetic rows only, with "now" fixed at 2026-10-10 so 2026-10 is the running month and its
 * normal-month window is the 12 complete months 2025-10..2026-09. In that month:
 *   1. Every category with a normal above 0 draws the white rc-mark at ref / scale, where the scale
 *      is the larger of the biggest total and the biggest normal.
 *   2. 已超出 $<total − ref> appears only when total > ref.
 *   3. 常態還剩 $<ref − total> is in rc-meta for every category with ref > 0 and total <= ref,
 *      $0 at exactly the normal, and never on an exceeded category.
 *   4. No ≈ 常態, ▲, ▼ or % chip.
 *   5. No window spend ⇒ 新; a median of 0 with some window spend ⇒ no chip, no marker, no 常態還剩.
 *   6. A partial history whose loaded range starts inside the window ⇒ the … mark on every row, and
 *      no rc-mark, no 已超出, no 常態還剩 and no h3 note text.
 *   7. With the norms loaded the h3 note reads 白線 = 常態月 · 只標已超出.
 *   8. A completed month renders exactly as before #94 (the 2026-09 card is pinned to a string
 *      produced by the pre-#94 code), and the year / 全部期間 scopes carry none of the new strings.
 *
 * NOT evidence of the live look on a phone: that is the owner's post-deploy check.
 */
const assert = require('assert');
const { page, view } = require('./dashboard_project_split');

const NOW = { year: 2026, month: 10, day: 10 };
const WINDOW = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
  '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const CATS = ['飲食', '交通', '家居', '寵物', '娛樂'];

let seq = 0;
function txn(key, d, cat, amount) {
  const [y, m] = key.split('-').map(Number);
  seq++;
  return { id: 'rm-' + seq + '|x|' + amount + '|0000|0', rowId: 'row-' + seq, y, m, d, hm: '', type: '支出',
    amount, charged: amount, mine: null, cat, merchant: '店' + seq, bank: '測試卡', last4: '0000', link: '', posted: true };
}
/** Window months: 飲食 5000, 交通 2000, 家居 3000 every month (so each median is that amount);
 *  娛樂 900 in two months only (median 0, but some spend); 寵物 never.
 *  2026-10 so far: 飲食 6200 (over by 1200), 交通 800 (1200 left), 家居 3000 (exactly the normal),
 *  寵物 400 (新), 娛樂 700 (median 0). Merchants differ every row, so nothing reads as a subscription. */
function rows() {
  seq = 0;
  const out = [];
  WINDOW.forEach((k, i) => {
    out.push(txn(k, 3, '飲食', 5000));
    out.push(txn(k, 4, '交通', 2000));
    out.push(txn(k, 5, '家居', 3000));
    if (i === 2 || i === 7) out.push(txn(k, 6, '娛樂', 900));
  });
  out.push(txn('2026-10', 2, '飲食', 4000));
  out.push(txn('2026-10', 6, '飲食', 2200));
  out.push(txn('2026-10', 3, '交通', 800));
  out.push(txn('2026-10', 4, '家居', 3000));
  out.push(txn('2026-10', 5, '寵物', 400));
  out.push(txn('2026-10', 7, '娛樂', 700));
  return out;
}

/** A page booted with rows(); `before` makes it a partial load starting at that month. */
function booted(before) {
  const p = page(NOW);
  const all = rows();
  const list = before ? all.filter(t => t.y * 100 + t.m >= before.y * 100 + before.m) : all;
  const payload = Object.assign({ txns: list, olderFp: null, accounts: [], projects: [],
    baseline: { mode: 'median', amount: null }, categories: CATS },
    before ? { complete: false, before, loadedFp: 'fp' } : {});
  p.calls.filter(c => c.fn === 'getDashboardData')[0].success(JSON.stringify(payload));
  return p;
}

/** The 日常類別 panel's markup, from its opening div to the matching close. */
function card(html) {
  const start = html.indexOf('<div class="panel"><h3>日常類別');
  assert.ok(start >= 0, 'the page has a 日常類別 card');
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  throw new Error('unbalanced 日常類別 card');
}
/** One category's row-card inside the card, closed or open. */
function row(c, name) {
  const at = Math.max(c.indexOf('<div class="row-card" data-row="' + name + '">'),
    c.indexOf('<div class="row-card open" data-row="' + name + '">'));
  assert.ok(at >= 0, 'the card has a ' + name + ' row');
  const next = c.indexOf('<div class="row-card', at + 1);
  return c.slice(at, next < 0 ? c.length : next);
}
const note = c => /<span class="h3note">([^<]*)<\/span>/.exec(c)[1];
const meta = r => /<div class="rc-meta num">(.*?)<\/div>/.exec(r)[1];
const markLeft = r => { const m = /<i class="rc-mark" style="left:([\d.]+)%"><\/i>/.exec(r); return m ? m[1] : null; };
const NEW_STRINGS = ['已超出', '常態還剩', '只標已超出', 'delta over'];

// ---------------------------------------------------------------- 1–5, 7. running month
function testRunningMonth() {
  const p = booted();
  assert.ok(p.isPartialCur(p.resolveScope('month')), 'precondition: 2026-10 is the running month');
  const norms = p.catMedians('2026-10', p.monthTotals());
  assert.deepStrictEqual(CATS.map(k => norms.byCat[k] ? norms.byCat[k].ref : null), [5000, 2000, 3000, null, 0],
    'precondition: the normals over the 12-month window');
  const c = card(view(p, { scope: 'month' }));

  // (7) the h3 note.
  assert.strictEqual(note(c), '白線 = 常態月 · 只標已超出', '(7) the running month\'s h3 note');

  // (1) markers at ref / scale; the scale is the larger of the biggest total (6200) and normal (5000).
  assert.strictEqual(markLeft(row(c, '飲食')), (5000 / 6200 * 100).toFixed(1), '(1) 飲食 marker at 5000 / 6200');
  assert.strictEqual(markLeft(row(c, '交通')), (2000 / 6200 * 100).toFixed(1), '(1) 交通 marker');
  assert.strictEqual(markLeft(row(c, '家居')), (3000 / 6200 * 100).toFixed(1), '(1) 家居 marker');
  assert.strictEqual((c.match(/class="rc-mark"/g) || []).length, 3, '(1) one marker per category with ref > 0');

  // (2) 已超出 only when total > ref, with the exact amount.
  assert.ok(row(c, '飲食').indexOf('<span class="delta over" title="常態 $5,000（12 個月中位數）">已超出 $1,200</span>') >= 0,
    '(2) 飲食 6200 vs 5000: 已超出 $1,200, before the total');
  assert.ok(row(c, '飲食').indexOf('已超出 $1,200</span><span class="rc-total num">$6,200</span>') >= 0, '(2) in catDelta\'s place');
  assert.strictEqual((c.match(/已超出 \$/g) || []).length, 1, '(2) no other category is exceeded');

  // (3) 常態還剩 on every category with ref > 0 and total <= ref, $0 at exactly the normal.
  assert.strictEqual(meta(row(c, '交通')), '1 筆 · 平均 $800 · 占 7% · 常態還剩 $1,200', '(3) 交通 800 of 2000');
  assert.strictEqual(meta(row(c, '家居')), '1 筆 · 平均 $3,000 · 占 27% · 常態還剩 $0', '(3) 家居 exactly at its normal: $0');
  assert.ok(row(c, '家居').indexOf('class="delta') < 0, '(3) and no chip at exactly the normal');
  assert.ok(row(c, '交通').indexOf('class="delta') < 0, '(3) nor under it');
  assert.strictEqual(meta(row(c, '飲食')), '2 筆 · 平均 $3,100 · 占 56%', '(3) never on an exceeded category');

  // (4) no ≈ / ▲ / ▼ / percentage chip.
  assert.ok(!/class="delta (up|down|flat)"/.test(c), '(4) no ≈ / ▲ / ▼ chip class');
  assert.ok(c.indexOf('≈ 常態') < 0 && c.indexOf('▲') < 0 && c.indexOf('▼') < 0, '(4) no ≈ 常態, ▲ or ▼');
  assert.ok(!/<span class="delta[^"]*"[^>]*>[^<]*%/.test(c), '(4) no percentage chip');

  // (5) 新, and a median of 0 with no chip, marker or 常態還剩.
  assert.ok(row(c, '寵物').indexOf('<span class="delta new" title="常態月份沒有這一類">新</span>') >= 0, '(5) 寵物 had no window spend: 新');
  assert.ok(markLeft(row(c, '寵物')) === null && meta(row(c, '寵物')).indexOf('常態還剩') < 0, '(5) 新 has no marker and no 常態還剩');
  const ent = row(c, '娛樂');
  assert.ok(ent.indexOf('class="delta') < 0, '(5) 娛樂 median 0: no chip');
  assert.strictEqual(markLeft(ent), null, '(5) no marker');
  assert.strictEqual(meta(ent), '1 筆 · 平均 $700 · 占 6%', '(5) no 常態還剩');

  // The expanded row still lists its transactions.
  const open = card(view(p, { scope: 'month' }, { openRow: '飲食' }));
  assert.strictEqual((row(open, '飲食').match(/data-category-txn="/g) || []).length, 2, 'the open row lists its two rows');
}

// ---------------------------------------------------------------- 6. wait
function testWait() {
  // Loaded from 2026-03: the window's 2025-10..2026-02 are not yet there.
  const p = booted({ y: 2026, m: 3 });
  assert.strictEqual(p.catMedians('2026-10', p.monthTotals()), 'wait', 'precondition: the norms wait');
  const c = card(view(p, { scope: 'month' }));
  CATS.forEach(k => assert.ok(row(c, k).indexOf('<span class="delta flat" title="載入完整歷史中…">…</span>') >= 0, '(6) ' + k + ' shows the … mark'));
  assert.ok(c.indexOf('rc-mark') < 0, '(6) no marker');
  assert.ok(c.indexOf('已超出') < 0 && c.indexOf('常態還剩') < 0, '(6) no 已超出, no 常態還剩');
  assert.strictEqual(note(c), '', '(6) no h3 note text');
}

// ---------------------------------------------------------------- 8. completed month and other scopes
/** The 2026-09 card as the pre-#94 code renders it (generated from base 4dac35e, then pinned). */
const SEP_CARD = '<div class="panel"><h3>日常類別 <span class="h3note">白線 = 常態月</span></h3>'
  + '<div class="row-card" data-row="飲食"><div class="rc-top"><span class="rc-name">@TILE:飲食@飲食</span><span class="rc-end"><span class="delta flat" title="常態 $5,000（11 個月中位數）">≈ 常態</span><span class="rc-total num">$5,000</span><span class="chev">▶</span></span></div><div class="rc-bar"><i style="width:100.0%;background:@COLOR:飲食@"></i><i class="rc-mark" style="left:100.0%"></i></div><div class="rc-meta num">1 筆 · 平均 $5,000 · 占 50%</div></div>'
  + '<div class="row-card" data-row="家居"><div class="rc-top"><span class="rc-name">@TILE:家居@家居</span><span class="rc-end"><span class="delta flat" title="常態 $3,000（11 個月中位數）">≈ 常態</span><span class="rc-total num">$3,000</span><span class="chev">▶</span></span></div><div class="rc-bar"><i style="width:60.0%;background:@COLOR:家居@"></i><i class="rc-mark" style="left:60.0%"></i></div><div class="rc-meta num">1 筆 · 平均 $3,000 · 占 30%</div></div>'
  + '<div class="row-card" data-row="交通"><div class="rc-top"><span class="rc-name">@TILE:交通@交通</span><span class="rc-end"><span class="delta flat" title="常態 $2,000（11 個月中位數）">≈ 常態</span><span class="rc-total num">$2,000</span><span class="chev">▶</span></span></div><div class="rc-bar"><i style="width:40.0%;background:@COLOR:交通@"></i><i class="rc-mark" style="left:40.0%"></i></div><div class="rc-meta num">1 筆 · 平均 $2,000 · 占 20%</div></div>'
  + '</div>';

function testCompletedMonth() {
  const p = booted();
  const c = card(view(p, { scope: '2026-09' }));
  const expected = SEP_CARD
    .replace(/@TILE:([^@]+)@/g, (_, n) => p.catTile(n, p.catColor(n), 28))
    .replace(/@COLOR:([^@]+)@/g, (_, n) => p.catColor(n));
  assert.strictEqual(c, expected, '(8) 2026-09 renders exactly as before #94');
  assert.strictEqual(note(c), '白線 = 常態月', '(8) the completed month keeps its note');
  NEW_STRINGS.forEach(s => assert.ok(c.indexOf(s) < 0, '(8) 2026-09 has no ' + s));

  // The window for 2026-09 starts at BASE_FLOOR, so 娛樂's 2025-12 / 2026-05 spend has a median of 0
  // there too, and 2026-09 has no 寵物 or 娛樂 rows: the pinned card above has neither.
  ['year', 'all', '2025'].forEach(s => {
    const y = card(view(p, { scope: s }));
    NEW_STRINGS.forEach(x => assert.ok(y.indexOf(x) < 0, '(8) ' + s + ': no ' + x));
    assert.ok(y.indexOf('rc-mark') < 0 && !/class="delta/.test(y), '(8) ' + s + ': no marker and no chip');
    assert.strictEqual(note(y), '', '(8) ' + s + ': no h3 note');
  });
}

const CASES = { testRunningMonth, testWait, testCompletedMonth };

function run() {
  Object.keys(CASES).forEach(n => CASES[n]());
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_running_month_norms');
} else {
  module.exports.run = run;
  module.exports.CASES = CASES;
}
