'use strict';
/*
 * 趨勢 › 每月明細 / 每年明細: monthTable(rows, yearMode, selKey) in sidebar/ToolPanel.html renders a
 * table for desktop and appends a stacked list (monthList) for phones; CSS shows the list at 640px
 * and below (#89). Since #103 only the selected period is expanded.
 *
 * On synthetic rows only (periodDetail is stubbed; test/dashboard_trend_period.js covers it):
 *   1. The table markup, byte for byte: newest first, the selected row highlighted with one
 *      full-width detail row (colspan = 日常 + projects + 月份 + 總流出) directly under it, every other
 *      row a tap target (data-tsel, tabindex).
 *   2. The list: the selected block is expanded (line 1, the 日常 / project cells, the detail); every
 *      other block is one line (period + 總流出) carrying data-tsel; 至今 only on the running month.
 *   3. Cells are 日常 then every project in PROJECTS order; an empty project keeps its label and
 *      shows a muted —; amounts use fmt and the $ prefix; labels are escaped and carried in title.
 *   4. 年 mode: headings 每年明細 / 年份, a year of fewer than 12 months labelled with its count.
 *   5. With PROJECTS empty, the selected block holds only the 日常 cell.
 *   6. Stylesheet: the list is hidden by default; a max-width: 640px media rule hides .mtable-wrap
 *      and shows the list; the grid declares 3 columns and a container query 2; the existing .mtable
 *      rules are unchanged; the selection rules exist.
 *
 * NOT evidence of the rendered layout (no clipping, no horizontal scroll at 390px): that is the
 * owner's phone check after deploy.
 */
const assert = require('assert');
const fs = require('fs');
const { loadFns, PANEL } = require('./extract_panel');

const LONG = '這是一個非常非常長的專案名稱用來測試省略號截斷效果';
const EVIL = 'A<b>&"x';

function render(projects, rows, yearMode, selKey) {
  const sb = loadFns(['monthTable', 'monthList', 'periodRowLabel', 'esc', 'fmt'], {
    PROJECTS: projects.map(n => ({ name: n })),
    periodDetail: (k, y) => '<DETAIL ' + k + (y ? ' year' : '') + '>',
  });
  return sb.monthTable(rows, yearMode, selKey);
}

function run() {
  // ---- 1. the table ----------------------------------------------------------------------------
  const ROWS2 = [
    { key: '2026-10', daily: 1234.4, proj: { '旅遊': 0, [EVIL]: 5000 }, total: 6234.4, partial: false },
    { key: '2026-11', daily: 0, proj: { '旅遊': 123456.6, [EVIL]: 0 }, total: 123456.6, partial: true },
  ];
  const TABLE = '<div class="panel" style="margin-bottom:var(--sp4)"><h3>每月明細</h3><div class="mtable-wrap"><table class="mtable num"><thead><tr><th>月份</th><th>日常</th><th>旅遊</th><th>A&lt;b&gt;&amp;&quot;x</th><th>總流出</th></tr></thead><tbody>'
    + '<tr data-tsel="2026-11" tabindex="0" aria-selected="false"><td>26/11 至今</td><td>$0</td><td>$123,457</td><td>—</td><td>$123,457</td></tr>'
    + '<tr class="sel" aria-selected="true"><td>26/10</td><td>$1,234</td><td>—</td><td>$5,000</td><td>$6,234</td></tr>'
    + '<tr class="mdetail"><td colspan="5"><DETAIL 2026-10></td></tr>'
    + '</tbody></table></div>';
  const out2 = render(['旅遊', EVIL], ROWS2, false, '2026-10');
  const tableEnd = out2.indexOf('</table></div>') + '</table></div>'.length;
  assert.strictEqual(out2.slice(0, tableEnd), TABLE, '(1) the table markup, selected row and its detail row');
  assert.ok(out2.slice(tableEnd).startsWith('<div class="mlist num">'), '(1) the list follows the table inside the same panel');
  assert.ok(out2.endsWith('</div></div>'), '(1) and the panel closes');
  assert.strictEqual((out2.slice(0, tableEnd).match(/class="mdetail"/g) || []).length, 1, '(1) exactly one detail row');

  // ---- helpers over the list markup ----------------------------------------------------------
  function blocks(html) {
    const list = html.slice(html.indexOf('<div class="mlist num">'));
    return list.split('<div class="ml-block').slice(1).map(b => ({
      raw: b,
      sel: b.startsWith(' sel" aria-current="true">'),
      tsel: (b.match(/^ collapsed" data-tsel="([^"]*)" role="button" tabindex="0" aria-expanded="false">/) || [])[1],
      month: (b.match(/<span class="ml-month">([^<]*)/) || [])[1],
      sofar: /<span class="ml-sofar">至今<\/span>/.test(b),
      total: (b.match(/<span class="ml-tl">總流出<\/span><b class="ml-total">([^<]*)<\/b>/) || [])[1],
      detail: (b.match(/<DETAIL ([^>]*)>/) || [])[1],
      cells: [...b.matchAll(/<div class="ml-cell" title="([^"]*)"><span class="ml-lbl">([^<]*)<\/span><span class="(ml-amt(?: ml-empty)?)">([^<]*)<\/span><\/div>/g)]
        .map(m => ({ title: m[1], label: m[2], cls: m[3], amt: m[4] })),
    }));
  }

  // ---- 2-3. list content ---------------------------------------------------------------------
  const ROWS = [
    { key: '2026-09', daily: 36420, proj: { '重機': 0, '旅遊': 1500.5, [LONG]: 0 }, total: 37920.5, partial: false },
    { key: '2026-10', daily: 0, proj: { '重機': 620, '旅遊': 0, [LONG]: 999 }, total: 1619, partial: false },
    { key: '2026-11', daily: 19980, proj: { '重機': 0, '旅遊': 0, [LONG]: 0 }, total: 19980, partial: true },
  ];
  const b3 = blocks(render(['重機', '旅遊', LONG], ROWS, false, '2026-10'));
  assert.deepStrictEqual(b3.map(b => b.month), ['26/11', '26/10', '26/09'], '(2) blocks are newest first');
  assert.deepStrictEqual(b3.map(b => b.sel), [false, true, false], '(2) only the selected block is expanded');
  assert.deepStrictEqual(b3.map(b => b.tsel), ['2026-11', undefined, '2026-09'], '(2) every other block is a tap target');
  assert.deepStrictEqual(b3.map(b => b.sofar), [true, false, false], '(2) 至今 only on the running month');
  assert.deepStrictEqual(b3.map(b => b.total), ['$19,980', '$1,619', '$37,921'], '(2) 總流出 and the fmt-rounded total on line 1');
  assert.deepStrictEqual(b3.map(b => b.detail), [undefined, '2026-10', undefined], '(2) the detail sits in the selected block only');
  assert.deepStrictEqual(b3.map(b => b.cells.length), [0, 4, 0], '(2) a collapsed block is one line, no cells');
  const s = b3[1];
  assert.deepStrictEqual(s.cells.map(c => c.label), ['日常', '重機', '旅遊', LONG], '(3) 日常 then PROJECTS order');
  assert.deepStrictEqual(s.cells.map(c => c.title), ['日常', '重機', '旅遊', LONG], '(3) every cell carries its full label in title');
  assert.deepStrictEqual(s.cells.map(c => c.amt), ['$0', '$620', '—', '$999'], '(3) 日常 $0, an empty project —');
  assert.deepStrictEqual(s.cells.map(c => c.cls), ['ml-amt', 'ml-amt', 'ml-amt ml-empty', 'ml-amt'], '(3) only the empty value is muted');
  assert.ok(s.raw.indexOf('<div class="ml-grid">') > s.raw.indexOf('ml-total') && s.raw.indexOf('<DETAIL') > s.raw.indexOf('ml-grid'),
    '(3) the grid sits below line 1 and the detail below the grid');
  const b3b = blocks(render(['重機', '旅遊', LONG], ROWS, false, '2026-09'));
  assert.deepStrictEqual(b3b[2].cells.map(c => c.amt), ['$36,420', '—', '$1,501', '—'], '(3) amounts use fmt and the $ prefix');

  const evil = blocks(out2);
  assert.strictEqual(evil[1].cells[2].title, 'A&lt;b&gt;&amp;&quot;x', '(3) title is escaped');
  assert.strictEqual(evil[1].cells[2].label, 'A&lt;b&gt;&amp;&quot;x', '(3) label is escaped');
  assert.ok(!/<b>&/.test(out2), '(3) no raw HTML from a project name reaches the markup');

  // ---- 4. 年 mode ----------------------------------------------------------------------------
  const YEARS = [
    { key: '2025', daily: 300000, proj: {}, total: 300000, months: 6, partial: false },
    { key: '2026', daily: 200000, proj: {}, total: 200000, months: 11, partial: true },
  ];
  const yh = render([], YEARS, true, '2025');
  assert.ok(yh.indexOf('<h3>每年明細</h3>') >= 0 && yh.indexOf('<th>年份</th>') >= 0, '(4) 每年明細 / 年份 headings');
  assert.ok(yh.indexOf('<tr data-tsel="2026" tabindex="0" aria-selected="false"><td>2026 · 11 個月</td>') >= 0, '(4) the current year with its month count, no 至今');
  assert.ok(yh.indexOf('<tr class="sel" aria-selected="true"><td>2025 · 6 個月</td>') >= 0, '(4) a first year starting mid-year with its count');
  assert.ok(yh.indexOf('<tr class="mdetail"><td colspan="3"><DETAIL 2025 year></td></tr>') >= 0, '(4) the year detail row');
  const full = render([], [{ key: '2025', daily: 1, proj: {}, total: 1, months: 12, partial: false }], true, '2025');
  assert.ok(full.indexOf('<td>2025</td>') >= 0, '(4) a 12-month year has no count');
  const yb = blocks(yh);
  assert.deepStrictEqual(yb.map(b => b.month), ['2026 · 11 個月', '2025 · 6 個月'], '(4) list labels match');
  assert.deepStrictEqual(yb.map(b => b.sofar), [false, false], '(4) no 至今 in 年 mode');

  // ---- 5. no projects ------------------------------------------------------------------------
  const b0 = blocks(render([], ROWS.map(r => Object.assign({}, r, { proj: {}, total: r.daily })), false, '2026-11'));
  assert.strictEqual(b0.length, 3);
  assert.deepStrictEqual(b0[0].cells.map(c => c.label), ['日常'], '(5) only the 日常 cell');

  // ---- 6. stylesheet -------------------------------------------------------------------------
  const css = fs.readFileSync(PANEL, 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\n\s*\.mlist \{[^}]*display: none;[^}]*container-type: inline-size;/, '(6) the list is hidden by default and is a size container');
  assert.match(css, /@media \(max-width: 640px\) \{ \.mtable-wrap \{ display: none; \} \.mlist \{ display: block; \} \}/, '(6) at 640px and below the table hides and the list shows');
  assert.ok(css.indexOf('@media (max-width: 640px) { .mtable-wrap') > css.indexOf('.mlist {'), '(6) the media rule follows the default rule');
  assert.match(css, /\.ml-grid \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/, '(6) 3 equal columns');
  assert.match(css, /@container \(max-width: 305px\) \{ \.ml-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/, '(6) 2 columns in a narrow panel');
  assert.match(css, /\.ml-lbl \{[^}]*text-overflow: ellipsis;[^}]*color: var\(--text-muted\);/, '(6) labels are muted and ellipsized');
  assert.match(css, /\.ml-amt \{ flex: none; white-space: nowrap; \}/, '(6) amounts never shrink or wrap');
  assert.match(css, /\.ml-empty \{ color: var\(--text-muted\); \}/, '(6) the empty — is muted');
  [
    '.mtable-wrap { overflow-x: auto; }',
    '.mtable { width: 100%; border-collapse: collapse; font-size: 12px; }',
    '.mtable th, .mtable td { padding: 7px 4px; text-align: right; border-bottom: 1px solid var(--border); white-space: nowrap; }',
    '.mtable th { font-weight: 600; color: var(--text-muted); font-size: 12px; }',
    '.mtable th:first-child, .mtable td:first-child { text-align: left; padding-left: 0; }',
    '.mtable td:last-child { font-weight: 600; }',
    '.mtable tr:last-child td { border-bottom: none; }',
  ].forEach(rule => assert.ok(css.includes(rule), '(6) unchanged table rule: ' + rule));
  assert.match(css, /\.mtable tr\.mdetail td \{[^}]*white-space: normal;/, '(6) the detail row wraps');
  assert.match(css, /\.mtable \.pd-cols \{ grid-template-columns: 1fr 1fr;/, '(6) Top 商店 and 定期扣款 side by side on desktop');
  assert.match(css, /\.ml-block\.collapsed \{/, '(6) collapsed blocks are styled');
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_month_list');
} else {
  module.exports = { run };
}
