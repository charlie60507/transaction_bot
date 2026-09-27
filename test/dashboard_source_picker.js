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
  assert.strictEqual(html.indexOf('list="banklist"'), -1, 'no datalist binding on 來源');
  assert.strictEqual(html.indexOf('id="banklist"'), -1, 'banklist datalist is gone');
  assert.ok(html.indexOf('id="taglist"') >= 0, 'TAG datalist is untouched');

  const fns = loadFns(['distinctBanks', 'isManual'], {
    ACCOUNT_SOURCES: [],
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
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_source_picker');
} else {
  module.exports = { run };
}
