'use strict';
// TAG was merged into 種類 and the column no longer exists in the sheet. Nothing in the
// dashboard, the server or the bot may still render, accept, read or write it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractFunction, extractInlineScript, loadFns, PANEL } = require('./extract_panel');

const SERVER = path.resolve(__dirname, '..', 'sidebar', '程式碼.js');
const BOT = path.resolve(__dirname, '..', 'sidebar', 'cards_transaction_bot.js');

function definesFunction(src, name) {
  return new RegExp('function\\s+' + name + '\\s*\\(').test(src);
}

function run() {
  const html = fs.readFileSync(PANEL, 'utf8');
  ['data-ef="tag"', 'id="a-tag"', 'taglist', '項目 (TAG)', 'data-tab="project"', 'projectTab'].forEach(function (needle) {
    assert.strictEqual(html.indexOf(needle), -1, 'dashboard source still contains ' + needle);
  });

  const fns = loadFns(['txnsSignature']);
  const probe = { tag: 'SENTINEL-TAG-VALUE' };
  assert.strictEqual(fns.txnsSignature([probe]).indexOf('SENTINEL-TAG-VALUE'), -1,
    'txnsSignature does not read a tag field');
  const sigSrc = extractFunction(extractInlineScript(html), 'txnsSignature');
  assert.ok(!/'tag'/.test(sigSrc), "'tag' is not among txnsSignature's fields");

  const renderSrc = extractFunction(extractInlineScript(html), 'render');
  const tabs = [];
  const re = /tb\('([a-z]+)'/g;
  let m;
  while ((m = re.exec(renderSrc))) tabs.push(m[1]);
  assert.deepStrictEqual(tabs, ['analysis', 'trend', 'inbox'], 'the dashboard tabs are exactly 分析 / 趨勢 / 待記帳');

  const server = fs.readFileSync(SERVER, 'utf8');
  const bot = fs.readFileSync(BOT, 'utf8');
  [['程式碼.js', server], ['cards_transaction_bot.js', bot]].forEach(function (pair) {
    ['getTagColIndex_', 'migrateMetaCategoryToMerged'].forEach(function (name) {
      assert.ok(!definesFunction(pair[1], name), pair[0] + ' still defines ' + name);
    });
  });
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_no_tag');
} else {
  module.exports = { run };
}
