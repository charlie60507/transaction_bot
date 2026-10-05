'use strict';
// Pure helpers of the LINE webhook (linebot/line_parse.js): entry validation, literal account
// resolution, the 12 + 取消 button cap, the duplicate hint, reply text and postback encoding.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.resolve(__dirname, '..', 'linebot', 'line_parse.js');

function load() {
  const sandbox = { Date, Math, Array, String, Number };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });
  return sandbox;
}
function plain(x) { return JSON.parse(JSON.stringify(x)); }
const E = (o) => Object.assign({ date: '2026-10-05', time: '', amount: 180, merchant: '拉麵', type: '支出', accountText: '' }, o);

function run() {
  const lp = load();

  // ---- numbers in the text ------------------------------------------------
  assert.deepStrictEqual(plain(lp.lpNumbersIn('薪水 52,000 午餐180 計程車 12.5')), [52000, 180, 12.5]);
  assert.deepStrictEqual(plain(lp.lpNumbersIn('一百八')), []);

  // ---- validation ----------------------------------------------------------
  let v = lp.lpValidateEntries([E({ accountText: '中信' })], '中信 午餐 拉麵 180');
  assert.strictEqual(v.ok, true);
  assert.deepStrictEqual(plain(v.entries[0]), { date: '2026-10-05', time: '', amount: 180, merchant: '拉麵', type: '支出', accountText: '中信', accountMismatch: false });

  v = lp.lpValidateEntries([E({ merchant: '午餐', amount: 180 }), E({ merchant: '晚餐', amount: 250 })], '午餐 180 晚餐 250');
  assert.strictEqual(v.ok, true, 'multi-entry message');
  assert.strictEqual(v.entries.length, 2);

  assert.strictEqual(lp.lpValidateEntries([E({ amount: 52000, type: '收入' })], '薪水 52,000').ok, true, 'thousands separator');
  assert.strictEqual(lp.lpValidateEntries([E({ amount: '180' })], '午餐 180').ok, true, 'numeric string amount');
  assert.strictEqual(lp.lpValidateEntries([E({ type: '' })], '午餐 180').entries[0].type, '支出', 'blank type → 支出');

  // The whole message is "not understood" — never partially written — when any amount is unverifiable.
  assert.strictEqual(lp.lpValidateEntries([], '午餐').ok, false, 'no entries');
  assert.strictEqual(lp.lpValidateEntries(null, '午餐').ok, false);
  assert.strictEqual(lp.lpValidateEntries([E({ amount: null })], '午餐 拉麵').ok, false, 'no amount');
  assert.strictEqual(lp.lpValidateEntries([E({ amount: 180 })], '午餐 一百八').ok, false, 'amount not written in digits');
  assert.strictEqual(lp.lpValidateEntries([E({ amount: 1200 })], '午餐 1.2k').ok, false, '1.2k is not 1200');
  assert.strictEqual(lp.lpValidateEntries([E({ amount: 180 }), E({ amount: 999 })], '午餐 180 晚餐').ok, false, 'one bad entry rejects the message');
  assert.strictEqual(lp.lpValidateEntries([E({ amount: 0 })], '午餐 0').ok, false, 'zero amount');
  assert.strictEqual(lp.lpValidateEntries([E({ date: '2026-02-30' })], '午餐 180').ok, false, 'impossible date');
  assert.strictEqual(lp.lpValidateEntries([E({ date: '10/5' })], '午餐 180').ok, false, 'non-ISO date');
  assert.strictEqual(lp.lpValidateEntries([E({ type: '借貸' })], '午餐 180').ok, false, 'type outside the enum');
  assert.strictEqual(lp.lpValidateEntries([E({ time: '25:00' })], '午餐 180').entries[0].time, '', 'invalid time is dropped, never invented');
  assert.strictEqual(lp.lpValidateEntries([E({ time: '12:30' })], '12:30 午餐 180').entries[0].time, '12:30');

  // An account the owner never typed is flagged, so it is asked about rather than trusted.
  v = lp.lpValidateEntries([E({ accountText: '中信' })], '重信 午餐 拉麵 180');
  assert.strictEqual(v.entries[0].accountMismatch, true);

  // ---- account resolution ----------------------------------------------------
  const accounts = ['中信', 'LINE Pay', '現金', '富邦', '國泰'];
  assert.deepStrictEqual(plain(lp.lpResolveAccount({ accountText: '' }, accounts)), { kind: 'default', account: '現金' }, 'no account → 現金');
  assert.deepStrictEqual(plain(lp.lpResolveAccount({ accountText: '中信' }, accounts)), { kind: 'matched', account: '中信' });
  assert.deepStrictEqual(plain(lp.lpResolveAccount({ accountText: 'line pay' }, accounts)), { kind: 'matched', account: 'LINE Pay' }, 'case-insensitive, list spelling wins');
  assert.deepStrictEqual(plain(lp.lpResolveAccount({ accountText: '重信' }, accounts)), { kind: 'unmatched' }, 'typo is unmatched');
  assert.deepStrictEqual(plain(lp.lpResolveAccount({ accountText: '中國信託' }, accounts)), { kind: 'unmatched' }, 'aliases are not guessed');
  assert.deepStrictEqual(plain(lp.lpResolveAccount({ accountText: '中信', accountMismatch: true }, accounts)), { kind: 'unmatched' }, 'model-corrected account is not trusted');

  // ---- choices: all when ≤ 12, else the 12 nearest -------------------------
  let c = lp.lpChoices('重信', accounts);
  assert.deepStrictEqual(plain(c), { shown: accounts, truncated: false }, 'short list kept in order');
  // 14 candidates, all at edit distance 2 from 重信 except 中信 (distance 1).
  const many = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8', 'I9', 'J0', 'K1', 'L2', 'M3', '中信'];
  c = lp.lpChoices('重信', many);
  assert.strictEqual(c.truncated, true);
  assert.strictEqual(c.shown.length, 12);
  assert.strictEqual(c.shown[0], '中信', 'nearest first');
  assert.strictEqual(c.shown[1], 'A1', 'distance ties keep list order');
  assert.deepStrictEqual(plain(c.shown.slice(-1)), ['K1'], 'equal-distance candidates past 12 are cut');
  assert.ok(c.shown.indexOf('L2') === -1 && c.shown.indexOf('M3') === -1);
  assert.strictEqual(lp.lpEditDistance('重信', '中信'), 1);
  assert.strictEqual(lp.lpEditDistance('', 'abc'), 3);

  // ---- reply lines ---------------------------------------------------------
  assert.strictEqual(lp.lpWrittenLine({ bank: '中信', merchant: '拉麵', amount: 180, cat: '飲食', m: 10, d: 5 }), '已記：中信｜拉麵｜$180｜飲食｜10/5');
  assert.strictEqual(lp.lpWrittenLine({ bank: '現金', merchant: '午餐', amount: 180, cat: '', m: 10, d: 5 }), '已記：現金｜午餐｜$180｜未分類｜10/5');
  assert.strictEqual(lp.lpWrittenLine({ bank: '富邦', merchant: '超商', amount: 60, cat: '未分類', m: 1, d: 12 }),
    '已記：富邦｜超商｜$60｜未分類｜1/12（這張卡會自動匯入，可能重複）');
  assert.ok(lp.lpWrittenLine({ bank: '國泰', merchant: 'x', amount: 1, cat: '', m: 1, d: 1 }).indexOf('可能重複') !== -1);
  assert.ok(lp.lpWrittenLine({ bank: '中信', merchant: 'x', amount: 1, cat: '', m: 1, d: 1 }).indexOf('可能重複') === -1);
  assert.ok(lp.lpNotUnderstoodText().indexOf('中信 午餐 拉麵 180') !== -1, 'not-understood carries one example line');
  assert.ok(/找不到帳戶「重信」/.test(lp.lpPendingText({ accountText: '重信', merchant: '拉麵', amount: 180 }, false)));
  assert.ok(/最接近的 12 個/.test(lp.lpPendingText({ accountText: '重信', merchant: '拉麵', amount: 180 }, true)));

  // ---- postbacks -------------------------------------------------------------
  const rowId = '123e4567-e89b-12d3-a456-426614174000';
  assert.deepStrictEqual(plain(lp.lpDecodePostback(lp.lpEncodeUndo(rowId))), { action: 'undo', rowId });
  assert.deepStrictEqual(plain(lp.lpDecodePostback(lp.lpEncodePick('ab12cd34', 11))), { action: 'pick', token: 'ab12cd34', index: 11 });
  assert.deepStrictEqual(plain(lp.lpDecodePostback(lp.lpEncodeCancel('ab12cd34'))), { action: 'cancel', token: 'ab12cd34' });
  ['', 'undo:', 'pick:short:1', 'pick:ab12cd34:x', 'cancel:../../x', 'other:1', 'undo:a b'].forEach(d =>
    assert.strictEqual(lp.lpDecodePostback(d), null, 'rejects ' + JSON.stringify(d)));
  assert.ok(lp.lpEncodeUndo(rowId).length <= 300, 'within LINE postback data limit');
}

if (require.main === module) {
  run();
  console.log('✓ linebot_parse');
} else {
  module.exports = { run };
}
