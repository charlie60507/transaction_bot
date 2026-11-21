'use strict';
/*
 * #89: 趨勢 › 每月明細 on a phone. monthTable(rows) in sidebar/ToolPanel.html keeps the table and
 * appends a stacked list built from the same rows; CSS shows the list at 640px and below.
 *
 * On synthetic rows only:
 *   1. The table portion of the output is byte for byte the markup monthTable produced before #89.
 *   2. The list has one block per month, newest first; line 1 holds the month, 總流出 and the total;
 *      至今 (small, muted) appears only on the partial month.
 *   3. Cells are 日常 then every project in PROJECTS order; an empty project keeps its label and
 *      shows a muted —; 日常 shows $0 when zero; amounts use the same fmt rounding and $ prefix.
 *   4. A long project name is in the cell's title; HTML in a project name is escaped.
 *   5. With PROJECTS empty, every block holds only the 日常 cell.
 *   6. Stylesheet: the list is hidden by default; a max-width: 640px media rule hides .mtable-wrap
 *      and shows the list; the grid declares 3 columns and a container query declares 2; the
 *      existing .mtable rules are unchanged.
 *
 * NOT evidence of the rendered layout (no clipping, column count at 360/390px, ellipsis): that was
 * checked in headless Chrome before merge, and the owner's phone check after deploy.
 */
const assert = require('assert');
const fs = require('fs');
const { loadFns, PANEL } = require('./extract_panel');

const LONG = '這是一個非常非常長的專案名稱用來測試省略號截斷效果';
const EVIL = 'A<b>&"x';

function render(projects, rows) {
  const sb = loadFns(['monthTable', 'monthList', 'esc', 'fmt'], { PROJECTS: projects.map(n => ({ name: n })) });
  return sb.monthTable(rows);
}

function run() {
  // ---- 1. the table is unchanged -------------------------------------------------------------
  const TABLE_BEFORE = '<div class="panel" style="margin-bottom:var(--sp4)"><h3>每月明細</h3><div class="mtable-wrap"><table class="mtable num"><thead><tr><th>月份</th><th>日常</th><th>旅遊</th><th>A&lt;b&gt;&amp;&quot;x</th><th>總流出</th></tr></thead><tbody><tr><td>26/11 至今</td><td>$0</td><td>$123,457</td><td>—</td><td>$123,457</td></tr><tr><td>26/10</td><td>$1,234</td><td>—</td><td>$5,000</td><td>$6,234</td></tr></tbody></table></div></div>';
  const ROWS2 = [
    { key: '2026-10', daily: 1234.4, proj: { '旅遊': 0, [EVIL]: 5000 }, total: 6234.4, partial: false },
    { key: '2026-11', daily: 0, proj: { '旅遊': 123456.6, [EVIL]: 0 }, total: 123456.6, partial: true },
  ];
  const out2 = render(['旅遊', EVIL], ROWS2);
  const tableEnd = out2.indexOf('</table></div>') + '</table></div>'.length;
  assert.strictEqual(out2.slice(0, tableEnd) + out2.slice(-'</div>'.length), TABLE_BEFORE,
    'the table markup is byte for byte the pre-#89 markup');
  assert.ok(out2.slice(tableEnd).startsWith('<div class="mlist num">'), 'the list follows the table inside the same panel');

  // ---- helpers over the list markup ----------------------------------------------------------
  function blocks(html) {
    const list = html.slice(html.indexOf('<div class="mlist num">'));
    return list.split('<div class="ml-block">').slice(1).map(b => ({
      raw: b,
      month: (b.match(/<span class="ml-month">([^<]*)/) || [])[1],
      sofar: /<span class="ml-sofar">至今<\/span>/.test(b),
      total: (b.match(/<span class="ml-tl">總流出<\/span><b class="ml-total">([^<]*)<\/b>/) || [])[1],
      cells: [...b.matchAll(/<div class="ml-cell" title="([^"]*)"><span class="ml-lbl">([^<]*)<\/span><span class="(ml-amt(?: ml-empty)?)">([^<]*)<\/span><\/div>/g)]
        .map(m => ({ title: m[1], label: m[2], cls: m[3], amt: m[4] })),
    }));
  }

  // ---- 2-4. list content ---------------------------------------------------------------------
  const ROWS = [
    { key: '2026-09', daily: 36420, proj: { '重機': 0, '旅遊': 1500.5, [LONG]: 0 }, total: 37920.5, partial: false },
    { key: '2026-10', daily: 0, proj: { '重機': 620, '旅遊': 0, [LONG]: 999 }, total: 1619, partial: false },
    { key: '2026-11', daily: 19980, proj: { '重機': 0, '旅遊': 0, [LONG]: 0 }, total: 19980, partial: true },
  ];
  const b3 = blocks(render(['重機', '旅遊', LONG], ROWS));
  assert.deepStrictEqual(b3.map(b => b.month), ['26/11', '26/10', '26/09'], 'blocks are newest first');
  assert.deepStrictEqual(b3.map(b => b.sofar), [true, false, false], '至今 only on the partial month');
  assert.deepStrictEqual(b3.map(b => b.total), ['$19,980', '$1,619', '$37,921'], '總流出 and the fmt-rounded total on line 1');
  b3.forEach(b => {
    assert.deepStrictEqual(b.cells.map(c => c.label), ['日常', '重機', '旅遊', LONG], '日常 then PROJECTS order');
    assert.deepStrictEqual(b.cells.map(c => c.title), ['日常', '重機', '旅遊', LONG], 'every cell carries its full label in title');
    assert.ok(b.raw.indexOf('<div class="ml-grid">') > b.raw.indexOf('ml-total'), 'the grid sits below line 1');
  });
  assert.deepStrictEqual(b3[1].cells.map(c => c.amt), ['$0', '$620', '—', '$999'], '日常 $0, an empty project —');
  assert.deepStrictEqual(b3[1].cells.map(c => c.cls), ['ml-amt', 'ml-amt', 'ml-amt ml-empty', 'ml-amt'], 'only the empty value is muted');
  assert.deepStrictEqual(b3[2].cells.map(c => c.amt), ['$36,420', '—', '$1,501', '—'], 'amounts use fmt and the $ prefix');

  const evil = blocks(out2);
  assert.strictEqual(evil[0].cells[2].title, 'A&lt;b&gt;&amp;&quot;x', 'title is escaped');
  assert.strictEqual(evil[0].cells[2].label, 'A&lt;b&gt;&amp;&quot;x', 'label is escaped');
  assert.ok(!/<b>&/.test(out2), 'no raw HTML from a project name reaches the markup');

  // ---- 5. no projects ------------------------------------------------------------------------
  const b0 = blocks(render([], ROWS.map(r => Object.assign({}, r, { proj: {}, total: r.daily }))));
  assert.strictEqual(b0.length, 3);
  b0.forEach(b => assert.deepStrictEqual(b.cells.map(c => c.label), ['日常'], 'only the 日常 cell'));

  // ---- 6. stylesheet -------------------------------------------------------------------------
  const css = fs.readFileSync(PANEL, 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\n\s*\.mlist \{[^}]*display: none;[^}]*container-type: inline-size;/, 'the list is hidden by default and is a size container');
  assert.match(css, /@media \(max-width: 640px\) \{ \.mtable-wrap \{ display: none; \} \.mlist \{ display: block; \} \}/, 'at 640px and below the table hides and the list shows');
  assert.ok(css.indexOf('@media (max-width: 640px) { .mtable-wrap') > css.indexOf('.mlist {'), 'the media rule follows the default rule');
  assert.match(css, /\.ml-grid \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/, '3 equal columns');
  assert.match(css, /@container \(max-width: 305px\) \{ \.ml-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/, '2 columns in a narrow panel');
  assert.match(css, /\.ml-lbl \{[^}]*text-overflow: ellipsis;[^}]*color: var\(--text-muted\);/, 'labels are muted and ellipsized');
  assert.match(css, /\.ml-amt \{ flex: none; white-space: nowrap; \}/, 'amounts never shrink or wrap');
  assert.match(css, /\.ml-empty \{ color: var\(--text-muted\); \}/, 'the empty — is muted');
  [
    '.mtable-wrap { overflow-x: auto; }',
    '.mtable { width: 100%; border-collapse: collapse; font-size: 12px; }',
    '.mtable th, .mtable td { padding: 7px 4px; text-align: right; border-bottom: 1px solid var(--border); white-space: nowrap; }',
    '.mtable th { font-weight: 600; color: var(--text-muted); font-size: 12px; }',
    '.mtable th:first-child, .mtable td:first-child { text-align: left; padding-left: 0; }',
    '.mtable td:last-child { font-weight: 600; }',
    '.mtable tr:last-child td { border-bottom: none; }',
  ].forEach(rule => assert.ok(css.includes(rule), 'unchanged table rule: ' + rule));

}

if (require.main === module) {
  run();
  console.log('✓ dashboard_month_list');
} else {
  module.exports = { run };
}
