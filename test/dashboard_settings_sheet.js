'use strict';
/*
 * #69: the Settings sheet — 帳戶 / 類別 tabs and drag-to-reorder categories.
 *
 *   1. reorderList(list, from, to) returns a new array and never mutates its input; dropIndex(from, dy,
 *      rowHeight, count) is clamped to [0, count-1].
 *   2. Every open starts on 帳戶, with both add rows collapsed and empty, even after closing on 類別.
 *      The tab counts equal the rendered rows; 類別 never counts 未分類.
 *   3. A drag ends in exactly one setCategoryOrder call for a move, and none for a drop at the origin,
 *      a cancel (pointercancel) or Esc — and Esc during a drag leaves Settings open.
 *   4. Keyboard ↑/↓ debounces to one save; closing Settings inside the debounce sends it at once, once.
 *   5. A pointerdown on a handle starts no drag while a keyboard save is armed or a save is in flight.
 *   6. Esc precedence: drag, then the expanded add row, then closing the sheet.
 */
const assert = require('assert');
const fs = require('fs');
const { loadFns, PANEL } = require('./extract_panel');

const list = v => Array.from(v);

// ---------------------------------------------------------------- 1. pure helpers
function testPure() {
  const fns = loadFns(['reorderList', 'dropIndex']);
  const cats = ['飲食', '交通', '娛樂', '購物'];
  const frozen = cats.slice();

  assert.deepStrictEqual(list(fns.reorderList(cats, 0, 3)), ['交通', '娛樂', '購物', '飲食'], '(1) first row to last');
  assert.deepStrictEqual(list(fns.reorderList(cats, 3, 0)), ['購物', '飲食', '交通', '娛樂'], '(1) last row to first');
  assert.deepStrictEqual(list(fns.reorderList(cats, 1, 2)), ['飲食', '娛樂', '交通', '購物'], '(1) one place down');
  assert.deepStrictEqual(list(fns.reorderList(cats, 2, 2)), cats, '(1) same index is the same order');
  assert.deepStrictEqual(list(fns.reorderList(cats, 1, 99)), ['飲食', '娛樂', '購物', '交通'], '(1) an out-of-range target is clamped to the end');
  assert.deepStrictEqual(list(fns.reorderList(cats, 2, -5)), ['娛樂', '飲食', '交通', '購物'], '(1) and to the start');
  assert.deepStrictEqual(list(fns.reorderList(cats, 9, 0)), cats, '(1) an out-of-range source changes nothing');
  assert.notStrictEqual(fns.reorderList(cats, 0, 0), cats, '(1) a new array is returned');
  assert.deepStrictEqual(cats, frozen, '(1) the input is never mutated');

  const h = 47;
  assert.strictEqual(fns.dropIndex(0, 0, h, 4), 0, '(1) no movement stays put');
  assert.strictEqual(fns.dropIndex(0, 3 * h, h, 4), 3, '(1) first row to last');
  assert.strictEqual(fns.dropIndex(3, -3 * h, h, 4), 0, '(1) last row to first');
  assert.strictEqual(fns.dropIndex(1, 0.4 * h, h, 4), 1, '(1) less than half a row does not move');
  assert.strictEqual(fns.dropIndex(1, 0.6 * h, h, 4), 2, '(1) more than half a row moves one');
  assert.strictEqual(fns.dropIndex(1, 1e6, h, 4), 3, '(1) an out-of-range dy downwards clamps to the last index');
  assert.strictEqual(fns.dropIndex(2, -1e6, h, 4), 0, '(1) an out-of-range dy upwards clamps to 0');
  assert.strictEqual(fns.dropIndex(0, 50, 0, 4), 0, '(1) a zero row height does not move');
  assert.strictEqual(fns.dropIndex(0, 50, h, 0), 0, '(1) an empty list gives 0');
}

// ---------------------------------------------------------------- fake DOM
function el(id, doc) {
  const attrs = {};
  const classes = new Set();
  const node = {
    id, hidden: false, value: '', innerHTML: '', textContent: '', className: '', disabled: false, scrollTop: 0,
    style: {}, children: [],
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    hasAttribute(k) { return k in attrs; },
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    focus() { doc.activeElement = node; },
    contains(other) { return other === node || node.children.indexOf(other) >= 0; },
    closest() { return null; },
    querySelector() { return null; },
    getBoundingClientRect() { return { top: 0, bottom: 600, height: 47 }; }
  };
  return node;
}

/** Settings' DOM, the functions under test, and a recorded google.script.run. */
function sheet(opts) {
  opts = opts || {};
  const doc = { activeElement: null };
  const nodes = {};
  const get = id => nodes[id] || (nodes[id] = el(id, doc));
  doc.getElementById = get;
  ['account', 'category'].forEach(kind => {
    const form = get('settings-' + kind + '-form');
    form.children.push(get('settings-' + kind + '-name'), get('settings-' + kind + '-create'));
    form.hidden = true;
  });
  get('settings-panel-categories').hidden = true;
  get('settings-tabs').setAttribute('data-active', 'accounts');
  // Handles are looked up by index on the list; hand back one stable fake per index.
  const handles = {};
  get('settings-category-list').querySelector = sel => {
    const m = /data-cat-idx="(-?\d+)"/.exec(sel);
    if (!m || Number(m[1]) < 0) return null;
    const h = handles[m[1]] || (handles[m[1]] = el('handle-' + m[1], doc));
    h.setAttribute('data-cat-idx', m[1]);
    return h;
  };

  const timers = {};
  let nextTimer = 1;
  const calls = [];
  let pending = {};
  const run = {
    withSuccessHandler(f) { pending.success = f; return run; },
    withFailureHandler(f) { pending.failure = f; return run; },
    setCategoryOrder(l) { calls.push({ list: list(l), success: pending.success, failure: pending.failure }); pending = {}; }
  };
  const fns = loadFns([
    'reorderList', 'dropIndex', 'settingsCategories', 'sameList', 'setSettingsTab', 'settingsTabKeydown',
    'setSettingsStatus', 'setSettingsAdd', 'openSettingsAdd', 'renderSettingsAccounts', 'renderSettingsCategories',
    'categoryHandle', 'focusedCategory', 'focusCategory', 'announceCategory', 'saveCategoryOrder',
    'categoryHandleKeydown', 'flushCategoryKeySave', 'canStartCategoryDrag', 'categoryPointerDown',
    'categoryPointerMove', 'placeCategoryDrag', 'categoryAutoScroll', 'endCategoryDrag', 'openSettingsModal', 'closeSettingsModal',
    'settingsEscape'
  ], {
    CATEGORY_LIST: opts.cats || ['飲食', '交通', '娛樂'],
    CATEGORY_SHOWN: null,
    CATEGORY_SAVE_PENDING: false,
    CATEGORY_KEY_TIMER: null,
    CATEGORY_DRAG: null,
    ACCOUNT_CREATE_PENDING: false,
    SETTINGS_STATUS_TIMER: null,
    document: doc,
    esc: s => String(s),
    distinctBanks: () => opts.banks || ['土銀', '玉山'],
    render() {},
    toast() {},
    requestAnimationFrame() {},
    setTimeout(fn) { const id = nextTimer++; timers[id] = fn; return id; },
    clearTimeout(id) { delete timers[id]; },
    google: { script: { run } }
  });
  return {
    fns, doc, get, calls, timers, handles,
    fire() { const ids = Object.keys(timers); ids.forEach(id => { const f = timers[id]; delete timers[id]; f(); }); },
    armed: () => Object.keys(timers).length
  };
}

const key = (k, target) => {
  const e = { key: k, target, prevented: false, preventDefault() { e.prevented = true; } };
  return e;
};
const onHandle = (s, i) => {
  const h = s.get('settings-category-list').querySelector('[data-cat-idx="' + i + '"]');
  return { closest: () => h };
};

// ---------------------------------------------------------------- 2. tabs and open path
function testOpenResetsTab() {
  const s = sheet();
  const { fns, get } = s;
  const ov = get('settingsOverlay');

  fns.openSettingsModal();
  assert.ok(ov.classList.contains('on'), '(2) Settings opens');
  fns.setSettingsTab('categories');
  assert.strictEqual(get('settings-tab-categories').getAttribute('aria-selected'), 'true', '(2) 類別 is selected');
  assert.strictEqual(get('settings-panel-accounts').hidden, true, '(2) only one panel is visible');
  assert.strictEqual(get('settings-panel-categories').hidden, false);
  get('settings-body').scrollTop = 200;
  fns.setSettingsTab('categories');
  assert.strictEqual(get('settings-body').scrollTop, 0, '(2) switching tabs scrolls the body to the top');

  // Leave 類別 with its add row open and typed into, then close and reopen.
  fns.setSettingsAdd('category', true);
  get('settings-category-name').value = '寵物';
  get('settings-category-name').classList.add('bad');
  fns.closeSettingsModal();
  assert.ok(!ov.classList.contains('on'), '(2) Settings closes');
  fns.setSettingsAdd('account', true);
  get('settings-account-name').value = 'x';

  fns.openSettingsModal();
  assert.strictEqual(get('settings-tabs').getAttribute('data-active'), 'accounts', '(2) reopening starts on 帳戶');
  assert.strictEqual(get('settings-tab-accounts').getAttribute('aria-selected'), 'true', '(2) 帳戶 is aria-selected');
  assert.strictEqual(get('settings-tab-categories').getAttribute('aria-selected'), 'false', '(2) 類別 is not');
  assert.strictEqual(get('settings-tab-accounts').getAttribute('tabindex'), '0', '(2) the active tab is the tab stop');
  assert.strictEqual(get('settings-tab-categories').getAttribute('tabindex'), '-1');
  assert.strictEqual(get('settings-panel-accounts').hidden, false, '(2) the 帳戶 panel is shown');
  assert.strictEqual(get('settings-panel-categories').hidden, true, '(2) the 類別 panel is hidden');
  ['account', 'category'].forEach(kind => {
    assert.strictEqual(get('settings-' + kind + '-form').hidden, true, '(2) the ' + kind + ' add row is collapsed');
    assert.strictEqual(get('settings-' + kind + '-add').hidden, false, '(2) its ＋ row is shown');
    assert.strictEqual(get('settings-' + kind + '-name').value, '', '(2) its input is cleared');
  });
  assert.ok(!get('settings-category-name').classList.contains('bad'), '(2) .bad is cleared');

  assert.strictEqual(get('settings-account-count').textContent, 2, '(2) 帳戶 count equals the rendered rows');
  assert.strictEqual((get('settings-account-list').innerHTML.match(/<li/g) || []).length, 2);
  assert.strictEqual(get('settings-category-count').textContent, 3, '(2) 類別 count equals the sortable rows');
  assert.strictEqual(get('settings-category-list').innerHTML.indexOf('未分類'), -1, '(2) 未分類 is not a row');

  // ←/→ on a focused tab switches.
  const e = key('ArrowRight');
  fns.settingsTabKeydown(e);
  assert.ok(e.prevented, '(2) the arrow key is consumed');
  assert.strictEqual(get('settings-tabs').getAttribute('data-active'), 'categories', '(2) → switches to 類別');
  assert.strictEqual(s.doc.activeElement, get('settings-tab-categories'), '(2) focus follows the tab');
  fns.settingsTabKeydown(key('ArrowLeft'));
  assert.strictEqual(get('settings-tabs').getAttribute('data-active'), 'accounts', '(2) ← switches back');
}

// ---------------------------------------------------------------- 3. drag end
function testDragEnd() {
  // A move: one call with the moved order.
  let s = sheet();
  s.fns.CATEGORY_DRAG = { from: 0, to: 2, rows: [], row: null, handle: null, id: 1 };
  s.fns.endCategoryDrag(false);
  assert.strictEqual(s.calls.length, 1, '(3) a move saves exactly once');
  assert.deepStrictEqual(s.calls[0].list, ['交通', '娛樂', '飲食'], '(3) with the moved order');
  assert.strictEqual(s.fns.CATEGORY_DRAG, null, '(3) the drag is over');
  assert.strictEqual(s.get('settings-category-live').textContent, '飲食 移到第 3 位', '(3) the move is announced');
  assert.deepStrictEqual(list(s.fns.CATEGORY_LIST), ['飲食', '交通', '娛樂'], '(3) CATEGORY_LIST waits for the server');
  s.calls[0].success(['交通', '娛樂', '飲食']);
  assert.deepStrictEqual(list(s.fns.CATEGORY_LIST), ['交通', '娛樂', '飲食'], '(3) and then adopts its answer');
  s.fns.endCategoryDrag(false);
  assert.strictEqual(s.calls.length, 1, '(3) a second end with no drag does nothing');

  // A drop at the origin.
  s = sheet();
  s.fns.CATEGORY_DRAG = { from: 1, to: 1, rows: [], row: null, handle: null, id: 1 };
  s.fns.endCategoryDrag(false);
  assert.strictEqual(s.calls.length, 0, '(3) a no-op drop saves nothing');

  // A cancel (pointercancel) after moving.
  s = sheet();
  s.fns.CATEGORY_DRAG = { from: 0, to: 2, rows: [], row: null, handle: null, id: 1 };
  s.fns.endCategoryDrag(true);
  assert.strictEqual(s.calls.length, 0, '(3) a cancel saves nothing');
  assert.strictEqual(s.fns.CATEGORY_DRAG, null);

  // Esc mid-drag: cancels the drag only, Settings stays open.
  s = sheet();
  s.fns.openSettingsModal();
  s.fns.CATEGORY_DRAG = { from: 0, to: 2, rows: [], row: null, handle: null, id: 1 };
  const e = key('Escape');
  s.fns.settingsEscape(e);
  assert.ok(e.prevented, '(3) Esc is consumed');
  assert.strictEqual(s.fns.CATEGORY_DRAG, null, '(3) Esc cancels the drag');
  assert.strictEqual(s.calls.length, 0, '(3) and saves nothing');
  assert.ok(s.get('settingsOverlay').classList.contains('on'), '(3) Settings stays open');

  // A pointer drag end to end through the handlers: down on row 0, move past two rows, up.
  s = sheet();
  const listEl = s.get('settings-category-list');
  s.fns.renderSettingsCategories();
  const rows = [0, 1, 2].map(i => Object.assign(el('row-' + i, s.doc), { offsetTop: i * 47 }));
  listEl.children = rows;
  const handle = listEl.querySelector('[data-cat-idx="0"]');
  handle.closest = sel => sel === 'li' ? rows[0] : handle;
  let captured = null;
  handle.setPointerCapture = id => { captured = id; };
  const down = { target: handle, button: 0, pointerId: 7, clientY: 100, prevented: false, preventDefault() { down.prevented = true; } };
  s.fns.categoryPointerDown(down);
  assert.ok(down.prevented && s.fns.CATEGORY_DRAG, '(3) pointerdown on a handle starts a drag');
  assert.strictEqual(captured, 7, '(3) the handle captures the pointer');
  s.fns.categoryPointerMove({ pointerId: 7, clientY: 100 + 500 });
  assert.strictEqual(rows[0].style.transform, 'translateY(94px)', '(3) the row follows the pointer, clamped to the list');
  assert.strictEqual(rows[1].style.transform, 'translateY(-47px)', '(3) passed rows slide out of the way');
  assert.strictEqual(s.fns.CATEGORY_DRAG.to, 2);
  s.fns.categoryPointerMove({ pointerId: 8, clientY: 100 });
  assert.strictEqual(s.fns.CATEGORY_DRAG.to, 2, '(3) another pointer is ignored');
  s.fns.endCategoryDrag(false);
  assert.strictEqual(s.calls.length, 1, '(3) release saves once');
  assert.deepStrictEqual(s.calls[0].list, ['交通', '娛樂', '飲食']);
  assert.strictEqual(rows[1].style.transform, '', '(3) the shifted rows are reset');
}

// ---------------------------------------------------------------- 4. keyboard debounce
function testKeyboard() {
  let s = sheet();
  s.fns.renderSettingsCategories();
  s.fns.categoryHandleKeydown(key('ArrowUp', onHandle(s, 2)));
  s.fns.categoryHandleKeydown(key('ArrowUp', onHandle(s, 1)));
  assert.deepStrictEqual(list(s.fns.settingsCategories()), ['娛樂', '飲食', '交通'], '(4) two ↑ presses move 娛樂 to the top');
  assert.strictEqual(s.doc.activeElement, s.handles['0'], '(4) focus stays on the moved handle');
  assert.strictEqual(s.get('settings-category-live').textContent, '娛樂 移到第 1 位', '(4) each move is announced');
  assert.strictEqual(s.calls.length, 0, '(4) nothing is sent inside the debounce');
  assert.strictEqual(s.armed(), 1, '(4) one debounce timer is armed');
  s.fire();
  assert.strictEqual(s.calls.length, 1, '(4) the burst sends one save');
  assert.deepStrictEqual(s.calls[0].list, ['娛樂', '飲食', '交通']);
  s.calls[0].success(s.calls[0].list);

  // Edge: ↑ on the first row does nothing.
  const top = key('ArrowUp', onHandle(s, 0));
  s.fns.categoryHandleKeydown(top);
  assert.strictEqual(s.fns.CATEGORY_KEY_TIMER, null, '(4) ↑ on the first row arms nothing');
  assert.strictEqual(top.prevented, true, '(4) but the key is still consumed');

  // Closing inside the debounce flushes it: exactly one save, no timer left.
  s = sheet();
  s.fns.openSettingsModal();
  s.fns.categoryHandleKeydown(key('ArrowDown', onHandle(s, 0)));
  assert.strictEqual(s.calls.length, 0);
  s.fns.closeSettingsModal();
  assert.strictEqual(s.calls.length, 1, '(4) closing within 600ms still saves');
  assert.deepStrictEqual(s.calls[0].list, ['交通', '飲食', '娛樂']);
  assert.strictEqual(s.armed(), 0, '(4) the debounce timer is cleared');
  assert.strictEqual(s.fns.CATEGORY_KEY_TIMER, null);
  s.fire();
  assert.strictEqual(s.calls.length, 1, '(4) and nothing else is sent later');

  // ↓ then ↑ is a net no-op: nothing is sent.
  s = sheet();
  s.fns.categoryHandleKeydown(key('ArrowDown', onHandle(s, 0)));
  s.fns.categoryHandleKeydown(key('ArrowUp', onHandle(s, 1)));
  s.fire();
  assert.strictEqual(s.calls.length, 0, '(4) a burst that returns to the saved order sends nothing');
}

// ---------------------------------------------------------------- 5. drag blocked while pending
function testDragBlocked() {
  const tryDrag = s => {
    const listEl = s.get('settings-category-list');
    s.fns.renderSettingsCategories();
    const handle = listEl.querySelector('[data-cat-idx="1"]');
    handle.closest = () => handle;
    const down = { target: handle, button: 0, pointerId: 3, clientY: 10, prevented: false, preventDefault() { down.prevented = true; } };
    s.fns.categoryPointerDown(down);
    return down;
  };

  let s = sheet();
  s.fns.categoryHandleKeydown(key('ArrowDown', onHandle(s, 0)));
  assert.ok(s.fns.CATEGORY_KEY_TIMER, 'a keyboard save is armed');
  let down = tryDrag(s);
  assert.strictEqual(s.fns.CATEGORY_DRAG, null, '(5) no drag starts while a keyboard save is armed');
  assert.strictEqual(down.prevented, false, '(5) the pointerdown is left alone');
  assert.strictEqual(s.fns.canStartCategoryDrag(), false);

  s = sheet();
  s.fns.saveCategoryOrder(['交通', '飲食', '娛樂']);
  assert.strictEqual(s.fns.CATEGORY_SAVE_PENDING, true);
  down = tryDrag(s);
  assert.strictEqual(s.fns.CATEGORY_DRAG, null, '(5) no drag starts while a save is in flight');
  s.calls[0].failure({ message: 'x' });
  assert.strictEqual(s.fns.canStartCategoryDrag(), true, '(5) a drag can start once the save settles');
}

// ---------------------------------------------------------------- 6. Esc precedence
function testEscape() {
  const s = sheet();
  const { fns, get } = s;
  fns.openSettingsModal();
  fns.setSettingsTab('categories');
  fns.setSettingsAdd('category', true);
  assert.strictEqual(s.doc.activeElement, get('settings-category-name'), '(6) expanding focuses the input');
  fns.settingsEscape(key('Escape'));
  assert.strictEqual(get('settings-category-form').hidden, true, '(6) the first Esc collapses the add row');
  assert.strictEqual(s.doc.activeElement, get('settings-category-add'), '(6) focus returns to the ＋ row');
  assert.ok(get('settingsOverlay').classList.contains('on'), '(6) and leaves Settings open');
  fns.settingsEscape(key('Escape'));
  assert.ok(!get('settingsOverlay').classList.contains('on'), '(6) the second Esc closes Settings');
  fns.settingsEscape(key('Escape'));
  assert.ok(!get('settingsOverlay').classList.contains('on'), '(6) Esc while closed is a no-op');
}

// ---------------------------------------------------------------- markup
function testMarkup() {
  const html = fs.readFileSync(PANEL, 'utf8');
  const settings = html.match(/<div class="overlay" id="settingsOverlay">([\s\S]*?)<div class="overlay" id="delOverlay">/)[1];
  assert.ok(/class="modal settings-sheet"/.test(settings), 'the Settings dialog carries its own class');
  assert.ok(/aria-label="關閉設定"/.test(settings), 'an × close button');
  assert.ok(!/settings-close|class="macts"|>關閉</.test(settings), 'no bottom 關閉 row');
  assert.ok(/role="tablist"/.test(settings) && (settings.match(/role="tab"/g) || []).length === 2, 'two tabs');
  assert.ok((settings.match(/role="tabpanel"/g) || []).length === 2, 'two tab panels');
  assert.ok(/id="settings-status" aria-live="polite"/.test(settings), 'a polite status');
  assert.ok(/記帳時可選的付款帳戶。/.test(settings) && /按住 ⋮⋮ 拖曳排序，所有類別選單都會照這個順序。/.test(settings), 'the hints');
  assert.ok(/「未分類」固定在選單最上面，不在這裡排序。/.test(settings), 'the 未分類 footnote');
  assert.ok(/id="settings-category-name" maxlength="20"/.test(settings), 'categories keep the 20-character limit');
  assert.strictEqual(/\bdraggable\b|ondragstart|dataTransfer/.test(html), false, 'no HTML5 drag-and-drop');
  assert.ok(/touch-action: none/.test(html), 'the handle opts out of touch scrolling');

  // Shared selectors are untouched; every new rule is scoped to the Settings sheet.
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(/\.overlay \{ position: fixed; inset: 0;[^}]*align-items: flex-start;[^}]*\}/.test(css), '.overlay is unchanged');
  assert.ok(/\.modal \{ background: var\(--bg-surface\);[^}]*max-width: 460px; padding: var\(--sp4\);[^}]*\}/.test(css), '.modal is unchanged');
  const settingsRules = css.split('\n').filter(l => /settings-(sheet|grab|head|status|dot|x|tab|body|hint|group|list|row|name|handle|cat-list|acct-list|add|foot|sr|empty)/.test(l) && /\{/.test(l));
  assert.ok(settingsRules.length > 20, 'the Settings rules are present');
  settingsRules.forEach(l => {
    if (/@keyframes/.test(l)) return;
    assert.ok(/^\s*(#settingsOverlay|\.settings-sheet)/.test(l), 'scoped rule: ' + l.trim().slice(0, 60));
  });
}

const CASES = { testPure, testOpenResetsTab, testDragEnd, testKeyboard, testDragBlocked, testEscape, testMarkup };

function run() {
  Object.keys(CASES).forEach(n => CASES[n]());
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_settings_sheet');
} else {
  module.exports = { run, CASES };
}
