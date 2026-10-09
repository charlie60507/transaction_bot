'use strict';
/*
 * Category icons: every category name renders an icon from the fixed in-code map (IC +
 * CATEGORY_ICON) on the 日常類別 row card, the 專案 rows, the edit-row chip, the add-dialog chip
 * and the Settings 類別 list, and the 類別 selects are replaced by an icon picker. #80 gave every
 * category its own fixed colour (CATEGORY_COLOR, with a stable fallback for later categories); the
 * donut and its rank-coloured legend are gone.
 *
 * The functions and the two map literals are lifted out of ToolPanel.html and run against small
 * DOM stubs, so the markup asserted here is the real markup, and a pick is observed as the call
 * it makes (applyEdit for an existing row, the hidden #a-cat value for the add dialog).
 *
 * NOT evidence of the live look or of the save round trip: that needs the deployed dashboard.
 */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { extractInlineScript, extractFunction, PANEL } = require('./extract_panel');

const HTML = fs.readFileSync(PANEL, 'utf8');
const SCRIPT = extractInlineScript(HTML);

/** `var NAME = { ... };` from the panel script, as source. */
function extractVar(name) {
  const m = new RegExp('var ' + name + ' = \\{[\\s\\S]*?\\n?\\s*\\};').exec(SCRIPT);
  if (!m) throw new Error('var ' + name + ' not found in ToolPanel.html');
  return m[0];
}

/** `var NAME = [ ... ];` from the panel script, as source. */
function extractList(name) {
  const m = new RegExp('var ' + name + ' = \\[[^\\]]*\\];').exec(SCRIPT);
  if (!m) throw new Error('var ' + name + ' not found in ToolPanel.html');
  return m[0];
}

/** Loads the named functions plus the icon and colour maps into one sandbox. */
function load(names, extras) {
  const sandbox = Object.assign({ console: console }, extras || {});
  vm.createContext(sandbox);
  const src = [extractVar('IC'), extractVar('CATEGORY_ICON'), extractVar('CATEGORY_COLOR'), extractList('CATEGORY_COLOR_FALLBACK'),
    "var DAILY_COLOR = '#8296c4';"]
    .concat(names.map(n => extractFunction(SCRIPT, n))).join('\n')
    + '\nthis.IC = IC; this.CATEGORY_ICON = CATEGORY_ICON; this.CATEGORY_COLOR = CATEGORY_COLOR;';
  vm.runInContext(src, sandbox);
  return sandbox;
}

function node(id) {
  const n = { id: id, value: '', innerHTML: '', textContent: '', hidden: false, attrs: {}, focused: 0, ops: [] };
  n.classList = { add: c => n.ops.push('+' + c), remove: c => n.ops.push('-' + c), contains: () => false };
  n.setAttribute = (k, v) => { n.attrs[k] = v; };
  n.getAttribute = k => n.attrs[k];
  n.focus = () => { n.focused++; };
  n.querySelector = () => null;
  n.querySelectorAll = () => n.children || [];
  return n;
}
function doc() {
  const nodes = {};
  return {
    nodes: nodes,
    getElementById: id => { if (!nodes[id]) nodes[id] = node(id); return nodes[id]; }
  };
}

// The live META!D list (2026-10-09) plus 未分類.
const LIVE = ['飲食', '交通', '超市', '個人', '娛樂', '購物', '家居', '醫療', '旅遊', '投資', '其他',
  '汽車', '重機', '房屋', '結婚', '禮金'];
const PANEL_FNS = ['esc', 'fmt', 'catIcon', 'catTile', 'catChipInner'];

function run() {
  // ---- the map
  const base = load(PANEL_FNS);
  LIVE.concat(['未分類']).forEach(name => {
    const key = base.CATEGORY_ICON[name];
    assert.ok(key, name + ' is mapped');
    assert.ok(Object.prototype.hasOwnProperty.call(base.IC, key), name + ' maps to an existing IC entry (' + key + ')');
    assert.ok(base.catIcon(name).indexOf(base.IC[key]) >= 0, name + ' renders its own icon');
  });
  ['新類別', 'constructor', '__proto__', ''].forEach(name => {
    assert.ok(base.catIcon(name).indexOf(base.IC.q) >= 0, JSON.stringify(name) + ' falls back to the q icon');
  });
  const svg = base.catIcon('飲食');
  assert.ok(/^<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">/.test(svg),
    'icons use the 24x24 stroked line style and are hidden from assistive tech');

  // ---- tiles
  const tinted = base.catTile('飲食', '#5f9aa0', 22);
  assert.ok(/^<span class="ctile s22" aria-hidden="true" style="color:#5f9aa0;background:#5f9aa02e">/.test(tinted), 'tinted tile: colour icon on colour + 2e');
  const neutral = base.catTile('飲食', null, 34);
  assert.ok(/^<span class="ctile s34 neutral" aria-hidden="true">/.test(neutral), 'neutral tile has no inline colour');
  assert.ok(!/tabindex|<button|<a /.test(tinted + neutral), 'tiles are not focusable');
  assert.ok(base.catTile('<b>', null, 30).indexOf('<b>') < 0, 'a category name never reaches the tile markup');

  // ---- colours (#80): the Issue's 17 values, a stable fallback, daily = --accent
  const colors = load(PANEL_FNS.concat(['catColor']));
  const ISSUE = { 飲食: '#d08a63', 交通: '#5fa3b5', 超市: '#78ad7f', 購物: '#b98cc4', 娛樂: '#c9b06a', 個人: '#8296c4',
    家居: '#c27a8c', 醫療: '#6fbfa3', 禮金: '#d6a0b0', 其他: '#8f9a6a', 未分類: '#6b7080', 房屋: '#a98bc0', 汽車: '#c4a66a',
    旅遊: '#5fa3a0', 投資: '#9fb0c8', 重機: '#b5a07a', 結婚: '#c99ab0' };
  Object.keys(ISSUE).forEach(name => assert.strictEqual(colors.catColor(name), ISSUE[name], name + ' has the Issue\'s colour'));
  assert.strictEqual(Object.keys(colors.CATEGORY_COLOR).length, 17, 'exactly the 17 colours of the Issue');
  assert.ok(/--accent: #8296c4;/.test(HTML) && /var DAILY_COLOR = '#8296c4';/.test(SCRIPT), 'daily is --accent #8296c4');
  ['寵物', '新類別', 'constructor', ''].forEach(name => {
    const c = colors.catColor(name);
    assert.ok(/^#[0-9a-f]{6}$/.test(c), JSON.stringify(name) + ' falls back to a 6-digit hex (catTile appends 2e)');
    assert.strictEqual(colors.catColor(name), c, JSON.stringify(name) + ' always gets the same fallback colour');
  });
  assert.ok(!/function (donut|legend|lg)\(/.test(SCRIPT), 'the donut and its legend are gone');

  // ---- row card: 28px tile in the category's own colour, the same as its bar
  const rc = load(PANEL_FNS.concat(['rowCard', 'catDelta', 'advIn', 'advOf', 'isSplitTxn', 'chargedOf', 'catColor']), { openRow: null });
  const card = rc.rowCard({ name: '交通', total: 200, count: 2 }, 300,
    [{ cat: '交通', amount: 200, y: 2026, m: 10, d: 1 }], null);
  assert.ok(card.indexOf('<span class="rc-name"><span class="ctile s28" aria-hidden="true" style="color:#5fa3b5;background:#5fa3b52e">') >= 0,
    'row card name leads with a 28px tile in the category colour');
  assert.ok(card.indexOf('class="dot"') < 0, 'the 9px dot is gone');
  assert.ok(card.indexOf('background:#5fa3b5"></i>') >= 0, 'the bar keeps the same colour');

  // ---- edit row: the 類別 chip
  const er = load(PANEL_FNS.concat(['isSplitTxn', 'chargedOf', 'splitMark', 'typeColor', 'delBtn', 'mailLink', 'selOpts', 'editRow']), {
    openSplit: null, distinctCats: () => ['未分類', '飲食']
  });
  const txn = { id: 'msg-1|1|120|1234|0', y: 2026, m: 10, d: 1, hm: '', type: '支出', amount: 120, cat: '飲食',
    merchant: '星巴克', bank: '富邦', last4: '1234', link: '', posted: false };
  let html = er.editRow(txn);
  assert.ok(html.indexOf('data-ef="cat"') < 0, 'the 類別 <select> is gone');
  const chip = /<button type="button" class="catchip" data-catpick="([^"]*)" data-id="([^"]*)" aria-label="([^"]*)">([\s\S]*?)<\/button>/.exec(html);
  assert.ok(chip, 'edit row renders the 類別 chip');
  assert.strictEqual(chip[1], txn.id, 'the chip carries the row key attach() uses for [data-ef]');
  assert.strictEqual(chip[3], '類別：飲食，點擊更改', 'chip aria-label');
  assert.ok(chip[4].indexOf('<span class="catchip-ic">' + er.catIcon('飲食') + '</span><span class="catchip-name">飲食</span>') === 0, 'chip shows icon then name');
  assert.ok(chip[4].indexOf('▾') > 0, 'chip shows the caret');
  assert.ok(/data-ef="type"/.test(html), 'the 收支 select is unchanged');
  html = er.editRow(Object.assign({}, txn, { cat: '' }));
  assert.ok(html.indexOf('aria-label="類別：未分類，點擊更改"') >= 0, 'a blank category reads 未分類');
  html = er.editRow(Object.assign({}, txn, { cat: '新類別' }));
  assert.ok(html.indexOf(er.IC.q) >= 0, 'an unmapped category shows the q icon on the chip');
  const deleting = load(PANEL_FNS.concat(['isSplitTxn', 'chargedOf', 'splitMark', 'typeColor', 'delBtn', 'mailLink', 'selOpts', 'editRow']), {
    openSplit: null, isRowDeleting: () => true
  });
  assert.ok(/<button type="button" class="catchip" data-catpick="[^"]*" data-id="[^"]*" aria-label="[^"]*" disabled>/.test(deleting.editRow(txn)),
    'a deleting row renders the chip disabled');

  // ---- Settings: neutral 30px tile between the handle and the name, not focusable
  const list = { innerHTML: '' };
  const st = load(PANEL_FNS.concat(['settingsCategories', 'renderSettingsCategories']), {
    CATEGORY_LIST: ['飲食', '新類別'], CATEGORY_SHOWN: null, CATEGORY_SAVE_PENDING: false,
    document: { getElementById: id => id === 'settings-category-list' ? list : null }
  });
  st.renderSettingsCategories();
  const srows = list.innerHTML.match(/<li class="settings-row">[\s\S]*?<\/li>/g);
  assert.strictEqual(srows.length, 2, 'one row per category');
  srows.forEach((r, i) => {
    assert.ok(/<\/button><span class="ctile s30 neutral" aria-hidden="true"><svg[\s\S]*?<\/svg><\/span><span class="settings-name">/.test(r),
      'Settings row ' + i + ': tile sits between the handle and the name');
  });
  assert.ok(srows[1].indexOf(st.IC.q) >= 0, 'an unmapped Settings category shows the q icon');

  // ---- picker: contents, current mark, pick, cancel
  function picker(extras) {
    const d = doc();
    const fns = load(PANEL_FNS.concat(['catPickCells', 'openCatPicker', 'closeCatPicker', 'catPickEscape',
      'paintAddCat', 'openAddCatPicker', 'openRowCatPicker']), Object.assign({ document: d, CATPICK: null }, extras));
    fns.doc = d;
    return fns;
  }
  function cells(p) {
    return (p.doc.nodes['catpick-grid'].innerHTML.match(/<button type="button" class="catpick-cell[^>]*>/g) || [])
      .map(b => ({ value: /data-catval="([^"]*)"/.exec(b)[1], current: / aria-current="true"/.test(b), on: /catpick-cell on"/.test(b) }));
  }
  const edits = [];
  const row = Object.assign({}, txn, { cat: '交通' });
  const p = picker({
    textTxn: id => (id === txn.id ? row : null), isRowDeleting: () => false,
    distinctCats: () => ['未分類', '飲食', '交通', '新類別'],
    applyEdit: (id, field, value) => edits.push([id, field, value])
  });
  // A repaint replaces the chip, so focus return re-queries #app for the row's chip.
  const chipNode = node('chip'); chipNode.attrs['data-catpick'] = txn.id;
  const otherChip = node('other'); otherChip.attrs['data-catpick'] = 'other-row';
  p.doc.getElementById('app').children = [otherChip, chipNode];
  p.openRowCatPicker(txn.id);
  assert.ok(p.doc.nodes.catPickOverlay.ops.indexOf('+on') >= 0, 'the picker opens');
  assert.deepStrictEqual(cells(p).map(c => c.value), ['未分類', '飲食', '交通', '新類別'], 'edit picker: 未分類 first, then distinctCats() order');
  assert.deepStrictEqual(cells(p).filter(c => c.current).map(c => c.value), ['交通'], 'only the current value carries aria-current');
  assert.deepStrictEqual(cells(p).filter(c => c.on).map(c => c.value), ['交通'], 'only the current value carries the accent class');
  assert.ok(/<span class="ctile s34 neutral"/.test(p.doc.nodes['catpick-grid'].innerHTML), 'cells hold 34px neutral tiles');
  assert.strictEqual(p.doc.nodes['catpick-sub'].textContent, '星巴克 · $120', 'title context: merchant and amount');
  assert.strictEqual(p.doc.nodes['catpick-sub'].hidden, false, 'the context line is shown for an existing row');

  p.catPickEscape({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.deepStrictEqual(edits, [], 'Esc closes without a change');
  assert.ok(p.doc.nodes.catPickOverlay.ops.indexOf('-on') >= 0, 'Esc closes the picker');
  assert.strictEqual(p.CATPICK, null, 'no picker state after close');
  assert.strictEqual(chipNode.focused, 1, 'focus returns to the row\'s chip on close');
  assert.strictEqual(otherChip.focused, 0, 'and not to another row\'s chip');

  p.openRowCatPicker(txn.id);
  p.closeCatPicker();
  assert.deepStrictEqual(edits, [], 'a scrim close (no value) changes nothing');

  p.openRowCatPicker(txn.id);
  p.closeCatPicker('交通');
  assert.deepStrictEqual(edits, [], 'picking the current value is a no-op close');

  p.openRowCatPicker(txn.id);
  p.closeCatPicker('未分類');
  assert.deepStrictEqual(edits, [[txn.id, 'cat', '未分類']], 'a pick saves through applyEdit(id,"cat",value)');

  let escStopped = 0;
  p.catPickEscape({ key: 'Escape', preventDefault() {}, stopPropagation() { escStopped++; } });
  assert.strictEqual(escStopped, 0, 'Esc with no picker open is left to the other handlers');
  p.openRowCatPicker(txn.id);
  p.catPickEscape({ key: 'Escape', preventDefault() {}, stopPropagation() { escStopped++; } });
  assert.strictEqual(escStopped, 1, 'Esc on an open picker stops there, so the dialog behind it stays open');

  const blocked = picker({ textTxn: () => row, isRowDeleting: () => true, distinctCats: () => ['未分類'] });
  blocked.openRowCatPicker(txn.id);
  assert.strictEqual(blocked.CATPICK, null, 'a deleting row cannot open the picker');

  // ---- add-dialog path: hidden #a-cat value, '' for 未分類
  const a = picker({ realCats: () => ['飲食', '交通'] });
  a.doc.getElementById('a-cat').value = '';
  a.paintAddCat();
  assert.strictEqual(a.doc.nodes['a-catchip'].attrs['aria-label'], '類別：未分類，點擊更改', 'the add chip starts on 未分類');
  a.openAddCatPicker();
  assert.deepStrictEqual(cells(a).map(c => c.value), ['未分類', '飲食', '交通'], 'add picker: 未分類 first, then realCats() order');
  assert.deepStrictEqual(cells(a).filter(c => c.current).map(c => c.value), ['未分類'], 'add picker marks 未分類 by default');
  assert.strictEqual(a.doc.nodes['catpick-sub'].hidden, true, 'the add picker has no transaction context line');
  a.closeCatPicker('交通');
  assert.strictEqual(a.doc.nodes['a-cat'].value, '交通', 'an add pick lands in #a-cat');
  assert.ok(a.doc.nodes['a-catchip'].innerHTML.indexOf('<span class="catchip-name">交通</span>') >= 0, 'and repaints the chip');
  assert.strictEqual(a.doc.nodes['a-catchip'].attrs['aria-label'], '類別：交通，點擊更改', 'and its label');
  assert.ok(a.doc.nodes['a-catchip'].focused >= 1, 'focus returns to the add chip');
  a.openAddCatPicker();
  a.closeCatPicker('未分類');
  assert.strictEqual(a.doc.nodes['a-cat'].value, '', '未分類 writes a blank category, as the empty <option> did');

  // ---- attach(): the row chip opens the picker for its row key; a disabled chip does nothing
  const chipEl = node('chip'); chipEl.attrs['data-catpick'] = txn.id;
  const app = { querySelectorAll: sel => (sel === '[data-catpick]' ? [chipEl] : []), querySelector: () => null };
  const opened = [];
  const at = load(['attach'], {
    document: { getElementById: id => (id === 'app' ? app : null), querySelector: () => null, querySelectorAll: () => [] },
    openRowCatPicker: id => opened.push(id)
  });
  at.attach();
  let stopped = 0;
  chipEl.onclick.call(chipEl, { stopPropagation() { stopped++; } });
  assert.deepStrictEqual(opened, [txn.id], 'a chip tap opens the picker for its row');
  assert.strictEqual(stopped, 1, 'the tap does not toggle the row card behind it');
  chipEl.disabled = true;
  chipEl.onclick.call(chipEl, { stopPropagation() {} });
  assert.strictEqual(opened.length, 1, 'a disabled chip cannot open the picker');

  // ---- markup contract
  assert.ok(/<input type="hidden" id="a-cat" value="">/.test(HTML), '#a-cat is the hidden value holder submitAdd() reads');
  assert.ok(!/<select id="a-cat"/.test(HTML), 'the add-dialog 類別 <select> is gone');
  assert.ok(/<div class="overlay" id="catPickOverlay">\s*<div class="modal catpick" role="dialog" aria-modal="true" aria-labelledby="catpick-title">/.test(HTML),
    'the picker is a static modal dialog outside #app');
  assert.ok(/<h3 id="catpick-title">選擇類別<\/h3>/.test(HTML), 'picker title');
  assert.ok(/document\.addEventListener\('keydown',catPickEscape,true\)/.test(SCRIPT), 'the picker Esc runs in the capture phase');
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_category_icons');
} else {
  module.exports = { run };
}
