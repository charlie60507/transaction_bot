'use strict';
/*
 * #82: the project start-month picker in Settings › 類別 (sidebar/ToolPanel.html).
 *
 * On the whole inline script against a stub document (the page harness of
 * dashboard_project_split, with element stubs that keep their classes and handlers), synthetic rows
 * only, and "now" fixed at 2026-10:
 *   1. Default: 日常 → 專案 opens the picker on the current month, with the new-project labels.
 *   2. Cancel by the button, the scrim and Esc writes nothing and leaves the category daily; Esc is
 *      stopped in the capture phase so Settings behind the picker stays open.
 *   3. Confirm calls setCategoryProject once with the chosen 'YYYY-MM'.
 *   4. Year bounds: the earliest row's year to the current year; the arrows stop at the limits; a
 *      category without rows has only the current year.
 *   5. Months after the current month are disabled and cannot be selected.
 *   6. The earliest month carries the dot, the legend is shown and the subtitle names it.
 *   7. Partial history: back to 2020, no dot, no legend, no second subtitle sentence.
 *   8. Editing a project opens on its start; the same month makes no call; another month saves and
 *      the 總覽 running total follows; a start before the range widens it; a start after the current
 *      month opens on the current month.
 *   9. Markup: no native month input in the panel; every row has the start column, empty on a
 *      daily row and a `YYYY/MM 起` button on a project; nothing opens while the row saves.
 *
 * NOT evidence of the live look (alignment at 390px, sheet vs dialog, 44px targets, focus ring):
 * those need a rendered build.
 */
const assert = require('assert');
const fs = require('fs');
const { PANEL } = require('./extract_panel');
const { booted, view, PROJ, clickOn } = require('./dashboard_project_split');

/** An element stub that tracks its classes, attributes and the handlers the page assigns. */
function makeNode(id) {
  const cls = new Set();
  const attrs = {};
  return {
    id, innerHTML: '', value: '', textContent: '', disabled: false, hidden: false, focused: 0,
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
    querySelectorAll: () => [], querySelector: () => null, focus() { this.focused++; }, select() {},
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: k => (k in attrs ? attrs[k] : null)
  };
}

const CATS = ['飲食', '購物', '家居', '汽車', '房屋', '旅遊', '醫療'];   // 醫療 has no rows
function open(opts) {
  return booted(Object.assign({ makeNode, categories: CATS }, opts || {}));
}
const idx = (p, name) => p.settingsCategories().indexOf(name);
const projectClick = (p, name) => p.categoryKindClick(clickOn({ 'data-kind-idx': String(idx(p, name)), 'data-kind': 'project' }));
const startClick = (p, name) => p.categoryKindClick(clickOn({ 'data-start-idx': String(idx(p, name)) }));
const writes = p => p.calls.filter(c => c.fn === 'setCategoryProject');
const overlayOn = p => p.nodes.monthPickOverlay.classList.contains('on');
const grid = p => p.nodes['monthpick-grid'].innerHTML;
function cell(p, key) {
  const m = new RegExp('<button type="button" class="monthpick-cell" data-month="' + key + '"[^>]*>[^<]*(<i class="monthpick-dot"[^>]*></i>)?</button>').exec(grid(p));
  assert.ok(m, 'cell ' + key + ' is on show');
  return m[0];
}
function esc(p) {
  const e = { key: 'Escape', stopped: 0, prevented: 0, stopPropagation() { this.stopped++; }, preventDefault() { this.prevented++; } };
  p.monthPickEscape(e);
  return e;
}

// ---------------------------------------------------------------- 1. default month
function testDefault() {
  const p = open();
  projectClick(p, '飲食');
  assert.ok(overlayOn(p), '(1) 專案 on a daily row opens the picker');
  assert.strictEqual(writes(p).length, 0, '(1) and writes nothing');
  assert.strictEqual(p.MONTHPICK.sel, '2026-10', '(1) on the current month');
  assert.strictEqual(p.nodes['monthpick-title'].textContent, '飲食 的專案從哪個月開始？', '(1) title');
  assert.strictEqual(p.nodes['monthpick-year'].textContent, '2026 年', '(1) year row');
  assert.strictEqual(p.nodes['monthpick-cancel'].textContent, '取消，維持日常', '(1) cancel label for a new project');
  assert.strictEqual(p.nodes['monthpick-ok'].textContent, '設為 2026/10 起', '(1) confirm label follows the selection');
  assert.ok(/aria-current="true"/.test(cell(p, '2026-10')), '(1) the current month is selected');
  assert.strictEqual((grid(p).match(/aria-current="true"/g) || []).length, 1, '(1) and only it');
  assert.strictEqual((grid(p).match(/class="monthpick-cell"/g) || []).length, 12, '(1) a 12-month grid');
  assert.ok(/>1 月</.test(grid(p)) && />12 月</.test(grid(p)), '(1) labelled 1 月 … 12 月');
  p.monthPickSelect('2026-04');
  assert.strictEqual(p.nodes['monthpick-ok'].textContent, '設為 2026/04 起', '(1) the confirm label follows a new selection');
}

// ---------------------------------------------------------------- 2. cancel without write
function testCancel() {
  const p = open();
  // Button.
  projectClick(p, '飲食');
  p.nodes['monthpick-cancel'].onclick();
  assert.ok(!overlayOn(p) && p.MONTHPICK === null, '(2) the cancel button closes the picker');
  // Scrim: a click on the overlay itself, not on the dialog inside it.
  projectClick(p, '飲食');
  p.nodes.monthPickOverlay.onclick.call(p.nodes.monthPickOverlay, { target: {} });
  assert.ok(overlayOn(p), '(2) a click inside the dialog does not close it');
  p.nodes.monthPickOverlay.onclick.call(p.nodes.monthPickOverlay, { target: p.nodes.monthPickOverlay });
  assert.ok(!overlayOn(p), '(2) the scrim closes it');
  // Esc, with Settings open behind.
  p.nodes.settingsOverlay.classList.add('on');
  projectClick(p, '飲食');
  const e = esc(p);
  assert.ok(!overlayOn(p) && p.MONTHPICK === null, '(2) Esc closes the picker');
  assert.ok(e.stopped && e.prevented, '(2) and is stopped, so the Settings Esc handler never sees it');
  assert.ok(p.nodes.settingsOverlay.classList.contains('on'), '(2) Settings stays open');
  const idle = esc(p);
  assert.strictEqual(idle.stopped, 0, '(2) with the picker closed, Esc is left to Settings');
  assert.strictEqual(writes(p).length, 0, '(2) no cancel calls setCategoryProject');
  assert.ok(!p.isProjectCat('飲食'), '(2) 飲食 stays daily');
}

// ---------------------------------------------------------------- 3. confirm
function testConfirm() {
  const p = open();
  let back = null;
  p.nodes['settings-category-list'].querySelector = sel => ({ disabled: false, focus() { back = sel; } });
  projectClick(p, '飲食');
  p.nodes['monthpick-ok'].onclick();
  assert.strictEqual(writes(p).length, 1, '(3) confirm calls setCategoryProject once');
  assert.deepStrictEqual(Array.from(writes(p)[0].args), ['飲食', '2026-10'], '(3) with the default month');
  assert.ok(!overlayOn(p), '(3) and closes the picker');
  assert.strictEqual(back, '[data-kind="project"][data-kind-idx="0"]', '(3) focus returns to the 專案 switch');
  assert.ok(p.PROJECT_SAVING['飲食'], '(3) the save is in flight');
  writes(p)[0].success(PROJ.concat([{ name: '飲食', start: '2026-10' }]));
  assert.ok(p.isProjectCat('飲食'), '(3) the server answer is adopted');

  const q = open();
  projectClick(q, '購物');
  q.monthPickStep(-1);
  q.monthPickSelect('2025-11');
  q.closeMonthPicker(true);
  assert.deepStrictEqual(writes(q).map(c => Array.from(c.args)), [['購物', '2025-11']], '(3) a chosen month is saved as YYYY-MM');
}

// ---------------------------------------------------------------- 4. year bounds
function testYearBounds() {
  const p = open();
  projectClick(p, '飲食');                     // earliest 飲食 row: 2025-09
  let md = p.monthPickModel('飲食', p.MONTHPICK.sel, p.MONTHPICK.year);
  assert.strictEqual(md.minYear, 2025, '(4) the lower bound is the earliest row\'s year');
  assert.strictEqual(md.maxYear, 2026, '(4) the upper bound is the current year');
  assert.ok(p.nodes['monthpick-next'].disabled && !p.nodes['monthpick-prev'].disabled, '(4) at the current year only ‹ is enabled');
  p.monthPickStep(1);
  assert.strictEqual(p.MONTHPICK.year, 2026, '(4) › cannot pass the current year');
  p.monthPickStep(-1);
  assert.strictEqual(p.nodes['monthpick-year'].textContent, '2025 年', '(4) ‹ shows the previous year');
  assert.ok(p.nodes['monthpick-prev'].disabled && !p.nodes['monthpick-next'].disabled, '(4) at the lower bound only › is enabled');
  p.monthPickStep(-1);
  assert.strictEqual(p.MONTHPICK.year, 2025, '(4) ‹ cannot pass the lower bound');
  assert.strictEqual(p.MONTHPICK.sel, '2026-10', '(4) stepping years keeps the selection');
  assert.ok(grid(p).indexOf('aria-current') < 0, '(4) which is not on show in another year');

  p.closeMonthPicker(false);
  projectClick(p, '醫療');                     // no rows at all
  md = p.monthPickModel('醫療');
  assert.ok(md.minYear === 2026 && md.maxYear === 2026, '(4) no rows: only the current year');
  assert.ok(p.nodes['monthpick-prev'].disabled && p.nodes['monthpick-next'].disabled, '(4) both arrows disabled');
  assert.strictEqual(p.nodes['monthpick-sub'].textContent, '從這個月起的醫療支出都算進專案累計。', '(4) no earliest-row sentence');
  assert.ok(p.nodes['monthpick-legend'].hidden && grid(p).indexOf('monthpick-dot') < 0, '(4) no dot, no legend');
}

// ---------------------------------------------------------------- 5. future months
function testFutureMonths() {
  const p = open();
  projectClick(p, '飲食');
  ['2026-11', '2026-12'].forEach(k => assert.ok(/ disabled/.test(cell(p, k)), '(5) ' + k + ' is after the current month: disabled'));
  ['2026-01', '2026-10'].forEach(k => assert.ok(!/ disabled/.test(cell(p, k)), '(5) ' + k + ' is selectable'));
  p.monthPickSelect('2026-11');
  assert.strictEqual(p.MONTHPICK.sel, '2026-10', '(5) a future month cannot be selected');
  p.monthPickStep(-1);
  assert.ok(!/ disabled/.test(grid(p)), '(5) every month of a past year is selectable');
}

// ---------------------------------------------------------------- 6. earliest-month dot
function testEarliestDot() {
  const p = open();
  projectClick(p, '飲食');
  assert.strictEqual(p.nodes['monthpick-sub'].textContent, '從這個月起的飲食支出都算進專案累計。最早一筆交易在 2025/09。', '(6) the subtitle names the earliest month');
  assert.strictEqual(p.nodes['monthpick-legend'].hidden, false, '(6) the legend is shown');
  assert.ok(grid(p).indexOf('monthpick-dot') < 0, '(6) 2026 has no dot');
  p.monthPickStep(-1);
  assert.ok(/monthpick-dot/.test(cell(p, '2025-09')), '(6) 2025/09 carries the dot');
  assert.strictEqual((grid(p).match(/monthpick-dot/g) || []).length, 1, '(6) and only it');
  const html = fs.readFileSync(PANEL, 'utf8');
  assert.ok(/id="monthpick-legend"[^>]*>.*最早交易的月份<\/p>/.test(html), '(6) legend text');
}

// ---------------------------------------------------------------- 7. partial history
function testPartial() {
  const p = open({ partial: true });
  assert.strictEqual(p.HISTORY.complete, false, '(7) precondition: partial load');
  projectClick(p, '飲食');
  assert.ok(overlayOn(p), '(7) the picker still opens');
  const md = p.monthPickModel('飲食');
  assert.ok(md.minYear === 2020 && md.earliest === null, '(7) back to 2020, without an earliest month');
  assert.ok(p.nodes['monthpick-legend'].hidden, '(7) no legend');
  assert.strictEqual(p.nodes['monthpick-sub'].textContent, '從這個月起的飲食支出都算進專案累計。', '(7) no second sentence');
  for (let y = 2026; y > 2020; y--) p.monthPickStep(-1);
  assert.strictEqual(p.MONTHPICK.year, 2020, '(7) ‹ reaches 2020');
  assert.ok(p.nodes['monthpick-prev'].disabled, '(7) and stops there');
  assert.ok(grid(p).indexOf('monthpick-dot') < 0, '(7) no dot in any year');
}

// ---------------------------------------------------------------- 8. editing an existing project
function testEdit() {
  const p = open();
  let back = null;
  p.nodes['settings-category-list'].querySelector = sel => ({ disabled: false, focus() { back = sel; } });
  startClick(p, '房屋');                       // saved start 2026-01
  assert.ok(overlayOn(p), '(8) the start-month button opens the picker');
  assert.strictEqual(p.MONTHPICK.sel, '2026-01', '(8) on the saved start');
  assert.strictEqual(p.nodes['monthpick-cancel'].textContent, '取消', '(8) a plain 取消 when editing');
  p.closeMonthPicker(true);
  assert.strictEqual(writes(p).length, 0, '(8) confirming the same month makes no call');
  assert.strictEqual(back, '[data-start-idx="' + idx(p, '房屋') + '"]', '(8) focus returns to the start-month button');

  startClick(p, '房屋');
  p.monthPickSelect('2026-05');
  p.nodes['monthpick-ok'].onclick();
  assert.deepStrictEqual(writes(p).map(c => Array.from(c.args)), [['房屋', '2026-05']], '(8) another month is saved once');
  writes(p)[0].success(PROJ.map(x => (x.name === '房屋' ? { name: '房屋', start: '2026-05' } : x)));
  const h = view(p, { scope: '2026-09' });
  assert.ok(h.indexOf('2026/05 起累計 $50,000') >= 0, '(8) the 總覽 running total follows the new start');
  assert.ok(h.indexOf('2026/01 起累計') < 0, '(8) and the old one is gone');

  const q = open({ projects: [{ name: '汽車', start: '2019-03' }, { name: '家居', start: '2027-01' }] });
  startClick(q, '汽車');                       // first 汽車 row: 2026-05
  assert.ok(q.MONTHPICK.sel === '2019-03' && q.MONTHPICK.year === 2019, '(8) a start before the range opens on it');
  assert.strictEqual(q.monthPickModel('汽車').minYear, 2019, '(8) the range widens to its year');
  q.closeMonthPicker(false);
  startClick(q, '家居');
  assert.strictEqual(q.MONTHPICK.sel, '2026-10', '(8) a start after the current month opens on the current month');
  assert.strictEqual(q.monthPickModel('家居').maxYear, 2026, '(8) the range still ends at the current year');
}

// ---------------------------------------------------------------- 9. markup and busy rows
function testMarkup() {
  const html = fs.readFileSync(PANEL, 'utf8');
  assert.strictEqual((html.match(/type="month"/g) || []).length, 0, '(9) no native month input in the panel');
  assert.ok(/id="monthPickOverlay"[\s\S]*?role="dialog" aria-modal="true" aria-labelledby="monthpick-title"/.test(html), '(9) the picker is a labelled modal dialog');
  const p = open();
  const daily = p.categoryKind('飲食', 0);
  assert.ok(daily.indexOf('<span class="settings-startcol"></span><span class="settings-kind"') === 0, '(9) a daily row has the empty start column before the switch');
  const proj = p.categoryKind('房屋', 4);
  assert.ok(/^<span class="settings-startcol"><button type="button" class="settings-start" data-start-idx="4"[^>]*><span class="settings-start-ym">2026\/01<\/span><span class="settings-start-qi">起<\/span><\/button><\/span><span class="settings-kind"/.test(proj),
    '(9) a project row has a 2026/01 起 button in the same column');
  p.PROJECT_SAVING['房屋'] = true;
  assert.strictEqual((p.categoryKind('房屋', 4).match(/ disabled/g) || []).length, 3, '(9) while it saves, the start button and both switch sides are disabled');
  startClick(p, '房屋');
  assert.ok(!overlayOn(p), '(9) and the picker does not open');
  p.PROJECT_SAVING['飲食'] = true;
  projectClick(p, '飲食');
  assert.ok(!overlayOn(p), '(9) nor from a daily row that is saving');
}

const CASES = { testDefault, testCancel, testConfirm, testYearBounds, testFutureMonths, testEarliestDot, testPartial, testEdit, testMarkup };

function run() {
  Object.keys(CASES).forEach(n => CASES[n]());
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_month_picker');
} else {
  module.exports = { run, CASES };
}
