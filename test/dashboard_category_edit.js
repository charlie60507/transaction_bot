'use strict';
const assert = require('assert');
const fs = require('fs');
const { loadFns, extractInlineScript, extractFunction, PANEL } = require('./extract_panel');

function sample(overrides) {
  return Object.assign({
    id: 'msg|date|120|1234|0', bank: '富邦', last4: '1234', hm: '12:00',
    merchant: '星巴克', amount: 120, charged: 120, mine: null,
    type: '支出', cat: '飲食', tag: '', posted: true, link: ''
  }, overrides);
}

function run() {
  const src = fs.readFileSync(PANEL, 'utf8');
  assert.ok(/data-ef="amount"/.test(src), 'expense amount has an editor control');
  assert.ok(/field==='amount'[\s\S]*?金額需大於 0/.test(src), 'client validates amount');
  // The old form of this check — does the string getAllTxns() appear anywhere in the file —
  // kept passing off boot()'s call after the edit path stopped making one, so it asserted
  // nothing about editing. The contract is now one round trip: updateTxn returns the
  // authoritative list itself, and applyEdit never fetches it separately.
  const applyEditSrc = extractFunction(extractInlineScript(src), 'applyEdit');
  assert.ok(/\.updateTxn\(\s*id,\s*patch,\s*true\s*\)/.test(applyEditSrc),
    'successful edits refresh authoritative transactions in the same call that writes them');
  assert.ok(!/getAllTxns/.test(applyEditSrc),
    'the edit path does not follow a successful write with a second fetch');
  assert.ok(/row-card \.drill[\s\S]*?stopPropagation/.test(src), 'editor controls cannot toggle the category card');

  const server = fs.readFileSync(require('path').resolve(__dirname, '..', 'sidebar', '程式碼.js'), 'utf8');
  assert.ok(/amountIdx[\s\S]*?currentMine[\s\S]*?CFG\.IDX_AMOUNT/.test(server), 'amount write distinguishes split rows from charged-only rows');
  assert.ok(/currentMine !== '' && currentMine !== null && currentMine !== undefined/.test(server), 'blank 我的消費 keeps non-split charged amount semantics');
  assert.ok(/setValue\(Number\(patch\.amount\)\)/.test(server), 'amount correction persists a validated number');

  const fns = loadFns(['esc', 'fmt', 'isSplitTxn', 'chargedOf', 'advOf', 'advIn', 'splitMark', 'typeColor', 'delBtn', 'mailLink', 'editRow', 'txnRow', 'categoryTxn', 'rowCard'], {
    openSplit: null,
    openCategoryTxn: null,
    openRow: null,
    PALETTE: ['#5f9aa0'],
    catDelta: function () { return ''; },
    splitBox: function () { return ''; },
    selOpts: function () { return ''; },
    distinctCats: function () { return ['飲食']; }
  });
  const html = fns.editRow(sample());
  assert.ok(html.indexOf('data-ef="amount"') >= 0, 'row exposes amount correction');
  assert.ok(html.indexOf('value="120"') >= 0, 'amount editor carries current value');
  assert.ok(html.indexOf('data-amt="msg|date|120|1234|0"') >= 0, 'split affordance retains stable row identity');

  const incomeHtml = fns.editRow(sample({ type: '收入' }));
  assert.strictEqual(incomeHtml.indexOf('data-ef="amount"'), -1, 'income rows do not expose expense amount correction');
  assert.ok(incomeHtml.includes('+$120'), 'income amount remains visible');
  const transferHtml = fns.editRow(sample({ type: '轉帳' }));
  assert.ok(transferHtml.includes('$120'), 'transfer amount remains visible');
  assert.ok(transferHtml.includes('data-amt='), 'transfer retains its existing split control');
  assert.ok(!transferHtml.includes('data-ef="amount"'), 'transfer does not gain expense correction');
  assert.ok(html.indexOf('data-ef="amount"') > html.indexOf('class="er2"'), 'amount correction does not crowd the merchant line');

  const t = sample();
  const item = { name: t.cat, total: t.amount, count: 1 };
  assert.ok(!fns.rowCard(item, 0, 120, [t], null, 1).includes('data-erow='), 'collapsed category mounts no editor');
  fns.openRow = t.cat;
  const category = fns.rowCard(item, 0, 120, [t], null, 1);
  assert.ok(category.includes('data-category-txn="'+t.id+'"'), 'expanded category lists selectable transactions');
  assert.ok(category.includes('aria-expanded="false"'), 'transaction starts collapsed');
  assert.ok(!category.includes('data-erow='), 'category expansion does not open every editor');
  fns.openCategoryTxn = t.id;
  const selected = fns.rowCard(item, 0, 120, [t], null, 1);
  assert.ok(selected.includes('aria-expanded="true"'), 'selected transaction is expanded');
  assert.ok(selected.includes('data-erow="'+t.id+'"'), 'selected transaction mounts the shared editor');
  assert.ok(!fns.categoryTxn(sample({id:'another-row'})).includes('data-erow='), 'other transactions stay collapsed');
  assert.ok(/rowType[\s\S]*只有支出交易可以修正金額/.test(server), 'server rejects amount patches for non-expense rows');
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_category_edit');
} else {
  module.exports = { run };
}
