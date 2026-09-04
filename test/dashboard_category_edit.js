'use strict';
const assert = require('assert');
const fs = require('fs');
const { loadFns, PANEL } = require('./extract_panel');

function sample(overrides) {
  return Object.assign({
    id: 'msg|date|120|1234|0', bank: '富邦', last4: '1234', hm: '12:00',
    merchant: '星巴克', amount: 120, charged: 120, mine: null,
    type: '支出', cat: '飲食', tag: '', posted: true, link: ''
  }, overrides);
}

function run() {
  const src = fs.readFileSync(PANEL, 'utf8');
  assert.ok(/支出明細[\s\S]*?d\+=editRow\(t\)/.test(src), 'category drill-down uses the existing editor');
  assert.ok(/data-ef="amount"/.test(src), 'expense amount has an editor control');
  assert.ok(/field==='amount'[\s\S]*?金額需大於 0/.test(src), 'client validates amount');
  assert.ok(/getAllTxns\(\)/.test(src), 'successful edits refresh authoritative transactions');
  assert.ok(/row-card \.drill[\s\S]*?stopPropagation/.test(src), 'editor controls cannot toggle the category card');

  const server = fs.readFileSync(require('path').resolve(__dirname, '..', 'sidebar', '程式碼.js'), 'utf8');
  assert.ok(/amountIdx[\s\S]*?currentMine[\s\S]*?CFG\.IDX_AMOUNT/.test(server), 'amount write distinguishes split rows from charged-only rows');
  assert.ok(/currentMine !== '' && currentMine !== null && currentMine !== undefined/.test(server), 'blank 我的消費 keeps non-split charged amount semantics');
  assert.ok(/setValue\(Number\(patch\.amount\)\)/.test(server), 'amount correction persists a validated number');

  const fns = loadFns(['esc', 'fmt', 'isSplitTxn', 'chargedOf', 'splitMark', 'typeColor', 'delBtn', 'mailLink', 'editRow'], {
    openSplit: null,
    splitBox: function () { return ''; },
    selOpts: function () { return ''; },
    distinctCats: function () { return ['飲食']; }
  });
  const html = fns.editRow(sample());
  assert.ok(html.indexOf('data-ef="amount"') >= 0, 'row exposes amount correction');
  assert.ok(html.indexOf('value="120"') >= 0, 'amount editor carries current value');
  assert.ok(html.indexOf('data-amt="msg|date|120|1234|0"') >= 0, 'split affordance retains stable row identity');
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_category_edit');
} else {
  module.exports = { run };
}
