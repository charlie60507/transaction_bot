'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadFns, extractInlineScript, extractFunction, PANEL } = require('./extract_panel');

const SERVER = path.resolve(__dirname, '..', 'sidebar', '程式碼.js');

function loadServerFns(names, extras) {
  const src = fs.readFileSync(SERVER, 'utf8');
  const sandbox = Object.assign({ console: console }, extras || {});
  vm.createContext(sandbox);
  vm.runInContext(names.map(n => extractFunction(src, n)).join('\n'), sandbox);
  return sandbox;
}

function serverFixture(type, mineValue) {
  const writes = [];
  const reads = [];
  let headerEnsures = 0;
  let flushes = 0;
  const CFG = {
    DATA_SHEET: 'Transactions', TZ: 'Asia/Taipei', HDR_MINE: '我的消費',
    IDX_POSTED: 0, IDX_BANK: 1, IDX_DATE: 2, IDX_LAST4: 3, IDX_AMOUNT: 4,
    IDX_MERCHANT: 5, IDX_CATEGORY_AUTO: 6, IDX_LINK: 7, IDX_MESSAGEID: 8,
    IDX_INOUT: 9, IDX_CATEGORY_MANUAL: 10
  };
  const row = new Array(13).fill('');
  row[CFG.IDX_POSTED] = false;
  row[CFG.IDX_BANK] = '國泰';
  row[CFG.IDX_DATE] = new Date('2026-09-13T12:00:00Z');
  row[CFG.IDX_LAST4] = '1234';
  row[CFG.IDX_AMOUNT] = 120;
  row[CFG.IDX_MERCHANT] = '轉帳';
  row[CFG.IDX_MESSAGEID] = 'msg';
  row[CFG.IDX_INOUT] = type;
  row[CFG.IDX_CATEGORY_MANUAL] = '轉帳';
  row[12] = mineValue;
  const sheet = {
    getLastRow: () => 2,
    getLastColumn: () => 13,
    getRange: function (row, col) {
      return {
        getValues: function () {
          reads.push([row, col, 'values']);
          return [serverRow.slice()];
        },
        getValue: function () {
          reads.push([row, col]);
          return serverRow[col - 1];
        },
        setValue: value => { writes.push([row, col, value]); serverRow[col - 1] = value; }
      };
    }
  };
  const serverRow = row;
  const sandbox = loadServerFns(['txnKey_', 'rowMine_', 'getAllTxns', 'isAmountCorrectionType_', 'updateTxn'], {
    CFG: CFG,
    getSpreadsheet_: () => ({ getSheetByName: () => sheet }),
    asTxnKey_: key => String(key),
    findRowByKey_: () => 2,
    getTagColIndex_: () => 11,
    getMineColIndex_: () => 12,
    ensureMineColIndex_: () => { headerEnsures++; return 12; },
    rowHM_: () => '12:00',
    rowCategory_: value => String(value[CFG.IDX_CATEGORY_MANUAL] || ''),
    Utilities: { formatDate: (date, tz, part) => ({ yyyy: '2026', M: '9', d: '13' })[part] },
    SpreadsheetApp: { flush: () => { flushes++; } }
  });
  return {
    update: (patch, wantTxns) => sandbox.updateTxn('row-key', patch, wantTxns),
    all: () => sandbox.getAllTxns(),
    writes: writes,
    reads: reads,
    headerEnsures: () => headerEnsures,
    flushes: () => flushes
  };
}

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

  const server = fs.readFileSync(SERVER, 'utf8');

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
  assert.ok(transferHtml.includes('data-ef="amount"'), 'transfer gains labeled amount correction');
  assert.ok(transferHtml.includes('value="120"'), 'transfer editor carries the raw amount');
  assert.ok(!transferHtml.includes('data-amt='), 'transfer does not expose the expense split control');
  fns.openSplit = sample().id;
  assert.ok(!fns.editRow(sample({ type: '轉帳' })).includes('class="split"'), 'transfer cannot render a stale split editor');
  assert.deepStrictEqual(['支出', '轉帳', '收入'].map(type => fns.editRow(sample({ type: type })).includes('data-ef="amount"')), [true, true, false],
    'client amount eligibility is the explicit expense/transfer allowlist');
  assert.ok(html.indexOf('data-ef="amount"') > html.indexOf('class="er2"'), 'amount correction does not crowd the merchant line');

  const transferServer = serverFixture('轉帳', 45);
  const mappedTransfer = transferServer.all()[0];
  assert.strictEqual(mappedTransfer.amount, 120, 'transfer mapping uses raw 金額_NTD even when 我的消費 is populated');
  assert.strictEqual(mappedTransfer.charged, 120, 'transfer retains the raw charged amount');
  assert.strictEqual(mappedTransfer.mine, null, 'transfer mapping exposes no split state');

  const transferResult = transferServer.update({ amount: 150 }, true);
  assert.deepStrictEqual(transferServer.writes, [[2, 5, 150]], 'transfer correction writes only 金額_NTD');
  assert.ok(!transferServer.reads.some(read => read[1] === 13), 'transfer correction does not inspect 我的消費');
  assert.strictEqual(transferServer.headerEnsures(), 0, 'transfer correction does not create 我的消費');
  assert.strictEqual(transferServer.flushes(), 1, 'authoritative transfer response flushes the write first');
  assert.strictEqual(transferResult.txns[0].amount, 150, 'authoritative response carries the corrected raw amount');
  assert.notStrictEqual(transferResult.txns[0].id, mappedTransfer.id, 'authoritative response carries the new amount-bearing row identity');

  const transferMine = serverFixture('轉帳', 45);
  assert.throws(() => transferMine.update({ mine: 20 }), /轉帳交易不能設定我的消費/,
    'transfer mine patches are rejected');
  assert.strictEqual(transferMine.headerEnsures(), 0, 'rejected transfer mine patch cannot create the header');
  assert.deepStrictEqual(transferMine.writes, [], 'rejected transfer mine patch writes nothing');

  const incomeServer = serverFixture('收入', '');
  assert.throws(() => incomeServer.update({ amount: 20 }), /只有支出或轉帳交易可以修正金額/,
    'income amount patches remain rejected');
  [0, -1, 'bad', Infinity].forEach(value => {
    assert.throws(() => serverFixture('轉帳', '').update({ amount: value }), /金額需大於 0/,
      'transfer rejects invalid amount ' + String(value));
  });

  const unsplitExpense = serverFixture('支出', '');
  unsplitExpense.update({ amount: 130 });
  assert.deepStrictEqual(unsplitExpense.writes, [[2, 5, 130]], 'unsplit expense still writes 金額_NTD');
  const splitExpense = serverFixture('支出', 50);
  splitExpense.update({ amount: 60 });
  assert.deepStrictEqual(splitExpense.writes, [[2, 13, 60]], 'split expense still writes 我的消費');

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
  assert.ok(/function isAmountCorrectionType_[\s\S]*?\['支出', '轉帳'\]/.test(server),
    'server amount eligibility uses the same explicit allowlist');
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_category_edit');
} else {
  module.exports = { run };
}
