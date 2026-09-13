'use strict';
const assert = require('assert');
const { loadFns } = require('./extract_panel');

function node(value) {
  return {
    value: value === undefined ? '' : value,
    innerHTML: '',
    classList: { add: function () {}, remove: function () {} }
  };
}

function form(values) {
  const nodes = {};
  Object.keys(values || {}).forEach(function (id) { nodes[id] = node(values[id]); });
  nodes.addOverlay = nodes.addOverlay || node();
  return {
    nodes: nodes,
    getElementById: function (id) { if (!nodes[id]) nodes[id] = node(); return nodes[id]; }
  };
}

function recordingRun(calls) {
  let success, failure;
  const run = {
    withSuccessHandler: function (fn) { success = fn; return run; },
    withFailureHandler: function (fn) { failure = fn; return run; },
    addTxn: function (fields) { calls.push({ fields: fields, success: success, failure: failure }); }
  };
  return run;
}

const FIELDS = {
  'a-date': '2026-08-18', 'a-time': '', 'a-amt': '80', 'a-type': '支出',
  'a-source': '現金', 'a-mer': '午餐', 'a-cat': '飲食', 'a-tag': ''
};

function submitHarness(opts) {
  opts = opts || {};
  const calls = [], renders = [], toasts = [];
  const doc = form(Object.assign({}, FIELDS, opts.fields || {}));
  const fns = loadFns(['closeAddModal', 'submitAdd'], {
    document: doc,
    addHeatDate: opts.contextual === false ? null : '2026-08-12',
    state: Object.assign({ scope: '2026-07', selYear: 2026, selMonth: 7 }, opts.state || {}),
    openHeatDay: opts.openHeatDay === undefined ? '2026-7-5' : opts.openHeatDay,
    TXNS: [], MUTATION_SEQ: 0,
    nextMutation: function () { return ++fns.MUTATION_SEQ; },
    settle: function () {},
    render: function () { renders.push(true); },
    toast: function (message, error) { toasts.push({ message: message, error: !!error }); },
    google: { script: { run: recordingRun(calls) } }
  });
  fns.calls = calls; fns.renders = renders; fns.toasts = toasts; fns.doc = doc;
  return fns;
}

function run() {
  const modalDoc = form({
    'a-date': '', 'a-time': '19:40', 'a-cat': '', 'a-tag': 'old', 'a-source': '',
    'a-amt': '9', 'a-mer': 'old'
  });
  const modal = loadFns(['openAddModal', 'closeAddModal'], {
    document: modalDoc, addHeatDate: null, NOW: { year: 2026, month: 8, day: 14 },
    realCats: function () { return ['飲食']; }, distinctBanks: function () { return ['現金']; },
    esc: function (x) { return String(x); }
  });
  modal.openAddModal('2026-08-20');
  assert.strictEqual(modalDoc.nodes['a-date'].value, '2026-08-20', 'heatmap open uses the cell date');
  assert.strictEqual(modalDoc.nodes['a-time'].value, '', 'heatmap open clears stale time');
  assert.strictEqual(modal.addHeatDate, '2026-08-20', 'heatmap context is explicit');
  modalDoc.nodes['a-time'].value = '08:15';
  modal.openAddModal(null);
  assert.strictEqual(modalDoc.nodes['a-date'].value, '2026-08-14', 'page add returns to today');
  assert.strictEqual(modalDoc.nodes['a-time'].value, '', 'page add also clears stale time');
  assert.strictEqual(modal.addHeatDate, null, 'page add replaces heatmap context');

  const same = submitHarness();
  same.submitAdd();
  assert.strictEqual(same.calls.length, 1, 'contextual add writes once');
  assert.deepStrictEqual(
    { scope: same.state.scope, year: same.state.selYear, month: same.state.selMonth, day: same.openHeatDay },
    { scope: '2026-08', year: 2026, month: 8, day: '2026-8-18' },
    'optimistic render targets the final editable date'
  );
  assert.strictEqual(same.TXNS[0].d, 18, 'optimistic row is visible under the final date');
  same.calls[0].success({ id: 'manual-1', hm: '09:05', y: 2026, m: 8, d: 19 });
  assert.deepStrictEqual(
    { id: same.TXNS[0].id, hm: same.TXNS[0].hm, d: same.TXNS[0].d, day: same.openHeatDay },
    { id: 'manual-1', hm: '09:05', d: 19, day: '2026-8-19' },
    'server identity, time, date, and selected detail are reconciled together'
  );

  const otherMonth = submitHarness({ fields: { 'a-date': '2026-09-02' } });
  otherMonth.submitAdd();
  assert.deepStrictEqual(
    { scope: otherMonth.state.scope, year: otherMonth.state.selYear, month: otherMonth.state.selMonth, day: otherMonth.openHeatDay },
    { scope: '2026-09', year: 2026, month: 9, day: '2026-9-2' },
    'edited date in another month switches the heatmap before the optimistic render'
  );

  const failed = submitHarness();
  failed.submitAdd();
  failed.calls[0].failure(new Error('offline'));
  assert.strictEqual(failed.TXNS.length, 0, 'failed add removes its optimistic row');
  assert.deepStrictEqual(
    { scope: failed.state.scope, year: failed.state.selYear, month: failed.state.selMonth, day: failed.openHeatDay },
    { scope: '2026-07', year: 2026, month: 7, day: '2026-7-5' },
    'failed add restores the previous month and detail selection'
  );
  assert.ok(failed.toasts[0].error && failed.toasts[0].message.indexOf('新增失敗:') === 0,
    'failed add keeps the existing visible error toast');

  const page = submitHarness({ contextual: false });
  page.submitAdd();
  assert.deepStrictEqual(
    { scope: page.state.scope, year: page.state.selYear, month: page.state.selMonth, day: page.openHeatDay },
    { scope: '2026-07', year: 2026, month: 7, day: '2026-7-5' },
    'page-level add does not acquire heatmap navigation effects'
  );

  let stopped = 0, opened = null;
  const button = { getAttribute: function () { return '2026-08-20'; } };
  const cell = { getAttribute: function () { return '2026-8-20'; } };
  const app = {
    querySelectorAll: function (selector) {
      if (selector === '[data-hadd]') return [button];
      if (selector === '.cell[data-hday]') return [cell];
      return [];
    },
    querySelector: function () { return null; }
  };
  const attached = loadFns(['attach'], {
    document: { getElementById: function (id) { return id === 'app' ? app : null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; } },
    state: { tab: 'analysis' }, openHeatDay: null,
    openAddModal: function (date) { opened = date; }, render: function () {}
  });
  attached.attach();
  button.onclick({ stopPropagation: function () { stopped++; } });
  assert.strictEqual(stopped, 1, 'heatmap add stops the cell click');
  assert.strictEqual(opened, '2026-08-20', 'pointer/native button click opens the matching date');
  assert.strictEqual(attached.openHeatDay, null, 'heatmap add does not toggle populated-day detail');
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_heatmap_add');
} else {
  module.exports = { run };
}
