'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadFns, extractFunction, extractInlineScript, PANEL } = require('./extract_panel');

const SERVER = path.resolve(__dirname, '..', 'sidebar', '程式碼.js');

function run() {
  const href = 'https://docs.google.com/spreadsheets/d/MOCK_SHEET_ID/edit';
  const fns = loadFns(['esc', 'sheetLink'], { SHEET_URL: href });
  const link = fns.sheetLink();
  const titleHtml = '<span class="title-row"><span class="title">交易 Dashboard</span>' + link + '</span>';

  const re = /<a class="sheet-link" href="([^"]*)" target="_blank" rel="noopener"/;
  const m = titleHtml.match(re);
  assert.ok(m, 'title HTML must contain a .sheet-link anchor with target=_blank rel=noopener');
  assert.strictEqual(m[1], href);
  assert.ok(titleHtml.indexOf('title="Open spreadsheet"') >= 0);
  assert.ok(titleHtml.indexOf('aria-label="Open spreadsheet"') >= 0);
  assert.ok(/<svg[\s\S]*<rect[\s\S]*<path d="M3 9h18/.test(link), 'sheet-grid SVG present');
  assert.strictEqual(link.indexOf('class="mail"'), -1);
  assert.strictEqual(link.indexOf('gid='), -1, 'must not hard-code gid');
  assert.strictEqual(link.indexOf('l9 6 9-6'), -1, 'must not reuse the Gmail envelope path');

  const src = fs.readFileSync(PANEL, 'utf8');
  const script = extractInlineScript(src);
  const renderSrc = extractFunction(script, 'render');
  assert.ok(renderSrc.indexOf("class=\"title\">交易 Dashboard</span>'+sheetLink()") >= 0,
    'render() must place sheetLink() immediately after the title');
  assert.ok(src.indexOf("var SHEET_URL = '<?= sheetUrl ?>';") >= 0);
  assert.ok(src.indexOf('即時讀取自 Transactions') >= 0);
  assert.ok(src.indexOf('flex-shrink:0') >= 0 || src.indexOf('flex-shrink: 0') >= 0,
    'add-button cluster must not shrink off a narrow row');

  const server = fs.readFileSync(SERVER, 'utf8');
  assert.ok(/t\.sheetUrl\s*=\s*getSpreadsheet_\(\)\.getUrl\(\)/.test(server),
    'doGet must inject getSpreadsheet_().getUrl() as sheetUrl');
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_sheet_link');
} else {
  module.exports = { run };
}
