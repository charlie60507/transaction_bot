'use strict';
const assert = require('assert');
const { loadFns } = require('./extract_panel');

function sample(overrides) {
  return Object.assign({
    id: 'msg-1',
    bank: '富邦',
    last4: '1234',
    hm: '12:00',
    merchant: '星巴克',
    amount: 120,
    type: '支出',
    cat: '飲食',
    tag: '',
    posted: false,
    link: '',
    charged: 120,
    mine: null
  }, overrides);
}

function run() {
  const fns = loadFns(
    ['esc', 'fmt', 'isSplitTxn', 'chargedOf', 'splitMark', 'typeColor', 'delBtn', 'mailLink', 'editRow', 'txnRow'],
    {
      openSplit: null,
      splitBox: function () { return ''; },
      selOpts: function () { return ''; },
      distinctCats: function () { return []; }
    }
  );
  const href = 'https://mail.google.com/mail/u/0/#inbox/abc123';
  const withLink = fns.editRow(sample({ link: href }));
  const without = fns.editRow(sample({ link: '' }));
  const readOnly = fns.txnRow(sample({ link: href }), true);

  const re = /<a class="mail" href="([^"]*)" target="_blank" rel="noopener"/;
  const m = withLink.match(re);
  assert.ok(m, 'editRow with link must contain a .mail anchor with target=_blank rel=noopener');
  assert.strictEqual(m[1], href);
  assert.ok(withLink.indexOf('title="Open original email"') >= 0);
  assert.ok(withLink.indexOf('aria-label="Open original email"') >= 0);
  assert.ok(/<svg[\s\S]*<rect[\s\S]*<path/.test(withLink), 'envelope SVG present');
  const amtAt = withLink.indexOf('class="amt amtbtn');
  const mailAt = withLink.indexOf('class="mail"');
  assert.ok(mailAt >= 0 && mailAt < amtAt, 'mail link sits left of the amount');

  assert.strictEqual(without.indexOf('class="mail"'), -1, 'empty link omits the icon');
  assert.strictEqual(without.indexOf('target="_blank"'), -1);
  assert.strictEqual(fns.editRow(sample({ link: '   ' })).indexOf('class="mail"'), -1, 'whitespace-only link omits the icon');

  assert.strictEqual(readOnly.indexOf('class="mail"'), -1, 'txnRow never gets a mail link');
  assert.strictEqual(readOnly.indexOf('target="_blank"'), -1);
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_gmail_link');
} else {
  module.exports = { run };
}
