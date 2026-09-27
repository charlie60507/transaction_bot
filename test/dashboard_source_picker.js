'use strict';
const assert = require('assert');
const fs = require('fs');
const { loadFns, PANEL } = require('./extract_panel');

function txn(bank, id) {
  return { bank: bank, id: id };
}

function run() {
  const html = fs.readFileSync(PANEL, 'utf8');
  assert.ok(/<select id="a-source">\s*<\/select>/.test(html), '來源 must be an empty <select id="a-source">');
  const addOverlay = html.match(/<div class="overlay" id="addOverlay">([\s\S]*?)<div class="overlay" id="settingsOverlay">/)[1];
  const settingsOverlay = html.match(/<div class="overlay" id="settingsOverlay">([\s\S]*?)<div class="overlay" id="delOverlay">/)[1];
  assert.ok(/data-settings/.test(html), 'dashboard header exposes Settings independently');
  assert.ok(/id="settings-account-list"/.test(settingsOverlay), 'Settings contains the account list');
  assert.ok(/id="settings-account-create"/.test(settingsOverlay), 'Settings contains account creation');
  assert.strictEqual(/settings-account|新增帳戶|a-source-add/.test(addOverlay), false, 'transaction entry contains no account management controls');
  assert.strictEqual(html.indexOf('list="banklist"'), -1, 'no datalist binding on 來源');
  assert.strictEqual(html.indexOf('id="banklist"'), -1, 'banklist datalist is gone');
  assert.ok(html.indexOf('id="taglist"') >= 0, 'TAG datalist is untouched');

  const elements = {};
  ['a-cat', 'a-tag', 'a-date', 'a-time', 'a-source', 'a-amt', 'a-mer'].forEach(id => {
    elements[id] = { value: '', innerHTML: '', classList: { add() {}, remove() {} } };
  });
  const fns = loadFns(['distinctBanks', 'isManual', 'openAddModal'], {
    ACCOUNT_SOURCES: [],
    PREFERRED_SOURCE: null,
    NOW: { year: 2026, month: 9, day: 27 },
    esc: value => String(value),
    realCats: () => [],
    document: { getElementById: id => id === 'addOverlay' ? { classList: { add() {} } } : elements[id] },
    TXNS: [
      txn('國泰', 'msg-1'),
      txn('國泰', 'msg-2'),
      txn('國泰', 'msg-3'),
      txn('富邦', 'msg-4'),
      txn('富邦', 'msg-5'),
      txn('臺新', 'msg-6'),
      txn('現金', 'manual-1'),
      txn('現金', 'manual-2'),
      txn('', 'msg-empty'),
      txn(null, 'msg-null')
    ]
  });

  // distinctBanks() returns a vm-realm Array; compare contents, not identity.
  assert.strictEqual(fns.distinctBanks().join('|'), ['現金', '國泰', '富邦', '臺新'].join('|'));

  fns.ACCOUNT_SOURCES = ['中信', '國泰'];
  assert.strictEqual(
    fns.distinctBanks().join('|'),
    ['中信', '國泰', '現金', '富邦', '臺新'].join('|'),
    'configured accounts lead, duplicates collapse, and historical sources remain'
  );
  fns.PREFERRED_SOURCE = '中信';
  fns.openAddModal(null);
  assert.strictEqual(elements['a-source'].value, '中信', 'newly-added preferred source is selected when the transaction picker is populated');
  assert.strictEqual(fns.PREFERRED_SOURCE, null, 'preferred source is consumed by the next transaction modal open');
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_source_picker');
} else {
  module.exports = { run };
}
