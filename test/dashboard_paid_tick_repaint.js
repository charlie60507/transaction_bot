'use strict';
/*
 * Ticking 已記帳 must not repaint the panel a beat later.
 *
 * The panel is a bound Apps Script page, so none of this can be exercised against the real
 * sheet from here. What IS provable offline is the decision logic: the whole-list signature
 * that decides whether a server response changes anything on screen, the sequence guard that
 * refuses a snapshot another mutation has already superseded, the refetch that pays back the
 * authoritative list such a discard threw away, and the revert path that must re-resolve its
 * row after an adoption detached the object it captured. Each function is lifted out of
 * ToolPanel.html by extract_panel and run against a stubbed google.script.run, so a repaint is
 * a counted call rather than something a human has to watch for.
 *
 * repaint() is exercised the same way, against a stub DOM rather than by matching the file's
 * text: a focused control, a caret, a scroll offset, and TWO copies of one row (an opened heat
 * day and an expanded category row can both list it) so that restoring focus into the wrong
 * copy is a failure rather than an invisible coin flip.
 *
 * NOT evidence that the reported symptom is gone: that needs the deployed dashboard.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadFns, extractInlineScript, extractFunction, PANEL } = require('./extract_panel');

// Exactly the fields getAllTxns returns. Hardcoded here on purpose: if the signature is ever
// narrowed to a subset, the per-field loop below fails on the dropped field.
const SERVER_FIELDS = ['id', 'y', 'm', 'd', 'hm', 'type', 'amount', 'charged', 'mine',
  'cat', 'merchant', 'tag', 'bank', 'last4', 'link', 'posted'];

function row(overrides) {
  return Object.assign({
    id: 'msg-a|1000|120|1234|0', y: 2026, m: 8, d: 12, hm: '09:00', type: '支出',
    amount: 120, charged: 120, mine: null, cat: '飲食', merchant: '星巴克', tag: '',
    bank: '富邦', last4: '1234', link: 'https://mail/x', posted: false
  }, overrides);
}

function other(overrides) {
  return row(Object.assign({ id: 'msg-b|2000|350|5678|0', merchant: '全聯', amount: 350, charged: 350, last4: '5678' }, overrides));
}

// A fresh copy of the list, the way the server hands one over: new objects every time.
function serverCopy(list) {
  return list.map(function (t) { return Object.assign({}, t); });
}

// Every server entry point the panel reaches, recorded with its handlers so a test decides when
// — and in which order — each response lands. getAllTxns() is recorded too: the refetch that
// pays back a discarded list is a counted call, so "an ordinary run pays for no extra read" and
// "a discarded list is refetched exactly once" are both assertable.
function recordingRun(rec) {
  let pending = {};
  function take() { const p = pending; pending = {}; return p; }
  const run = {
    withSuccessHandler: function (f) { pending.success = f; return run; },
    withFailureHandler: function (f) { pending.failure = f; return run; },
    updateTxn: function (id, patch, wantTxns) {
      const p = take();
      rec.calls.push({ id: id, patch: patch, wantTxns: wantTxns, success: p.success, failure: p.failure });
    },
    deleteTxn: function (arg) { const p = take(); rec.deletes.push({ arg: arg, success: p.success, failure: p.failure }); },
    addTxn: function (fields) { const p = take(); rec.adds.push({ fields: fields, success: p.success, failure: p.failure }); },
    getAllTxns: function () { const p = take(); rec.reads.push({ success: p.success, failure: p.failure }); }
  };
  return run;
}

function fakeNode(value) {
  return {
    value: value === undefined ? '' : value, disabled: false, hidden: false,
    innerHTML: '', textContent: '', classList: { add: function () {}, remove: function () {} }
  };
}

// Enough document for the modal paths (submitAdd, confirmDelete) and nothing more: they read
// field values and toggle classes, and this fixture is about the mutation bookkeeping around
// them, not their markup.
function domStub(fields) {
  const nodes = {};
  return {
    activeElement: null,
    getElementById: function (id) { if (!nodes[id]) nodes[id] = fakeNode((fields || {})[id]); return nodes[id]; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
}

const PANEL_FNS = ['txnsSignature', 'adoptTxns', 'txnById', 'nextMutation', 'isStale', 'settle',
  'refreshTxns', 'focusKey', 'focusMatches', 'focusIndex', 'repaint', 'revertTxn', 'applyEdit',
  'applySplit', 'bulkPost', 'submitAdd', 'confirmDelete', 'closeDelModal', 'closeAddModal',
  'chargedOf', 'isSplitTxn', 'fmt'];

function harness(initial, opts) {
  opts = opts || {};
  const renders = { n: 0 };
  const toasts = [];
  const scrolls = [];
  const rec = { calls: [], deletes: [], adds: [], reads: [] };
  const doc = opts.document || domStub(ADD_FORM);
  const fns = loadFns(PANEL_FNS, {
    TXNS: serverCopy(initial || []),
    MUTATION_SEQ: 0, INFLIGHT: 0, STALE_DROPPED: false, REFRESHING: false,
    pendingDelId: null, delBusy: false, openSplit: null,
    google: { script: { run: recordingRun(rec) } },
    render: function () { renders.n++; if (opts.onRender) opts.onRender(); },
    toast: function (msg, isErr) { toasts.push({ msg: msg, err: !!isErr }); },
    document: doc,
    window: {
      pageXOffset: opts.pageX || 0, pageYOffset: opts.pageY || 0,
      scrollTo: function (x, y) { scrolls.push([x, y]); }
    }
  });
  fns.renders = renders;
  fns.toasts = toasts;
  fns.scrolls = scrolls;
  fns.calls = rec.calls;
  fns.deletes = rec.deletes;
  fns.adds = rec.adds;
  fns.reads = rec.reads;
  return fns;
}

const ADD_FORM = {
  'a-date': '2026-08-12', 'a-amt': '80', 'a-time': '', 'a-type': '支出',
  'a-source': '現金', 'a-mer': '午餐', 'a-cat': '飲食', 'a-tag': ''
};

/** One editable control. `caret` gives it a readable selection; `selectionThrows` reproduces
 *  Chromium on <input type="number">, where READING selectionStart raises InvalidStateError. */
function fakeInput(attrs, opts) {
  opts = opts || {};
  const el = {
    tagName: 'INPUT', id: opts.id || '',
    attributes: Object.keys(attrs).map(function (k) { return { name: k, value: attrs[k] }; }),
    focused: 0, ranges: [],
    focus: function () { el.focused++; },
    setSelectionRange: function (a, b) { el.ranges.push([a, b]); }
  };
  if (opts.selectionThrows) {
    const boom = function () { throw new Error('InvalidStateError'); };
    Object.defineProperty(el, 'selectionStart', { get: boom });
    Object.defineProperty(el, 'selectionEnd', { get: boom });
  } else if (opts.caret) { el.selectionStart = opts.caret[0]; el.selectionEnd = opts.caret[1]; }
  return el;
}

/** A DOM whose matches for one selector are swapped for a rebuilt set when render() runs, which
 *  is what innerHTML on #app does — including dropping focus back to <body>. */
function rebuildingDom(key, before, after) {
  const dom = {
    activeElement: before[0], matches: before,
    getElementById: function () { return null; },
    querySelector: function (sel) { return sel === key ? (dom.matches[0] || null) : null; },
    querySelectorAll: function (sel) { return sel === key ? dom.matches : []; },
    rebuild: function () { dom.matches = after; dom.activeElement = null; }
  };
  return dom;
}

function run() {
  const src = fs.readFileSync(PANEL, 'utf8');
  const script = extractInlineScript(src);

  // ---- change detection covers every returned field, an added row, a removed row, an id ----
  const base = [row(), other()];
  SERVER_FIELDS.forEach(function (field) {
    const h = harness(base);
    assert.strictEqual(h.adoptTxns(serverCopy(base)), false,
      'adopting an identical list reports no change (' + field + ')');
    const changed = serverCopy(base);
    const current = changed[0][field];
    // A value the field cannot already hold, per field type.
    if (field === 'posted') changed[0][field] = !current;
    else if (typeof current === 'number') changed[0][field] = current + 7;
    else if (current === null) changed[0][field] = 99;
    else changed[0][field] = String(current) + '-x';
    assert.strictEqual(h.adoptTxns(changed), true, 'a changed ' + field + ' reports a change');
  });

  const added = harness(base);
  assert.strictEqual(added.adoptTxns(serverCopy(base)), false, 'identical list is no change');
  assert.strictEqual(added.adoptTxns(serverCopy(base).concat([other({ id: 'msg-c|3000|50|9999|0' })])), true,
    'a newly arrived bot row reports a change, so the tick stays the de facto refresh');

  const removed = harness(base);
  assert.strictEqual(removed.adoptTxns(serverCopy([base[0]])), true, 'a removed row reports a change');

  const rekeyed = harness(base);
  assert.strictEqual(rekeyed.adoptTxns(serverCopy(base).map(function (t, i) {
    return i === 0 ? Object.assign({}, t, { id: t.id.replace('|0', '|1') }) : t;
  })), true, 'a renumbered occurrence reports a change');

  // Nulls are not conflated with the empty string, or a cleared split would look unchanged.
  const nulled = harness(base);
  assert.strictEqual(nulled.adoptTxns(serverCopy(base).map(function (t, i) {
    return i === 0 ? Object.assign({}, t, { mine: '' }) : t;
  })), true, 'null and empty string are distinguishable in the signature');

  // ---- a successful tick repaints exactly once: the optimistic render at tap time ----
  const tick = harness(base);
  tick.applyEdit(base[0].id, 'posted', true);
  assert.strictEqual(tick.renders.n, 1, 'the tap itself repaints once');
  assert.deepStrictEqual(tick.toasts.map(function (t) { return t.msg; }), ['已記帳 · 從清單移除'],
    'the success message appears at tap time, not a round trip later');
  assert.strictEqual(tick.calls.length, 1, 'one server call, not a write followed by a refetch');
  assert.strictEqual(tick.calls[0].wantTxns, true, 'the edit asks for the fresh list in the same call');
  const acked = serverCopy(base);
  acked[0].posted = true;
  tick.calls[0].success({ ok: true, txns: acked });
  assert.strictEqual(tick.renders.n, 1, 'a server result matching the prediction repaints nothing');
  assert.strictEqual(tick.TXNS[0].posted, true, 'the authoritative list is still adopted');

  // ---- a server result that disagrees does repaint ----
  const diverged = harness(base);
  diverged.applyEdit(base[0].id, 'posted', true);
  const surprise = serverCopy(base);
  surprise[0].posted = true;
  surprise.push(other({ id: 'msg-d|4000|60|1111|0' }));
  diverged.calls[0].success({ ok: true, txns: surprise });
  assert.strictEqual(diverged.renders.n, 2, 'a list that differs repaints');
  assert.strictEqual(diverged.TXNS.length, 3, 'the new row is on screen');

  // ---- a snapshot superseded by a later mutation is discarded ----
  const raced = harness(base);
  raced.applyEdit(base[0].id, 'posted', true);          // first tick, seq 1
  raced.applyEdit(base[1].id, 'posted', true);          // second tick, seq 2
  assert.strictEqual(raced.renders.n, 2, 'each tap repaints once');
  const stale = serverCopy(base);
  stale[0].posted = true;                                // knows about the first tick only
  raced.calls[0].success({ ok: true, txns: stale });
  assert.strictEqual(raced.renders.n, 2, 'a superseded snapshot repaints nothing');
  assert.strictEqual(raced.TXNS[1].posted, true, 'and it does not resurrect the second row');
  const fresh = serverCopy(base);
  fresh[0].posted = true; fresh[1].posted = true;
  raced.calls[1].success({ ok: true, txns: fresh });
  assert.strictEqual(raced.renders.n, 2, 'the superseding response agrees with the screen');
  assert.strictEqual(raced.TXNS[0].posted, true, 'both rows converge on the server state');
  assert.strictEqual(raced.TXNS[1].posted, true, 'both rows converge on the server state');

  // ---- a failed write reverts, even after an adoption detached the captured row ----
  const failed = harness(base);
  failed.applyEdit(base[0].id, 'posted', true);
  const adoptedMeanwhile = serverCopy(base);
  adoptedMeanwhile[0].posted = true;
  failed.adoptTxns(adoptedMeanwhile);                    // rebuilds TXNS from fresh objects
  assert.notStrictEqual(failed.TXNS[0], base[0], 'the row the request captured is now detached');
  failed.calls[0].failure(new Error('boom'));
  assert.strictEqual(failed.TXNS[0].posted, false, 'the revert lands on the row that is on screen');
  assert.strictEqual(failed.renders.n, 2, 'the revert is repainted');
  assert.ok(failed.toasts[failed.toasts.length - 1].err, 'the failure is reported');

  // ---- a revert whose row no longer exists still repaints ----
  const vanished = harness(base);
  vanished.applyEdit(base[0].id, 'posted', true);
  vanished.adoptTxns(serverCopy([base[1]]));
  vanished.calls[0].failure(new Error('boom'));
  assert.strictEqual(vanished.renders.n, 2, 'a row that vanished server-side still forces a repaint');

  // ---- focus identity: the restoration is generic, not a second copy of the search box's ----
  const keys = harness(base);
  assert.strictEqual(keys.focusKey({ tagName: 'INPUT', id: 'q', attributes: [] }), '#q');
  assert.strictEqual(
    keys.focusKey({ tagName: 'INPUT', id: '', attributes: [{ name: 'data-emer', value: 'msg-a|1000|120|1234|0' }] }),
    'input[data-emer="msg-a|1000|120|1234|0"]', 'a row control is named by its data attribute');
  assert.strictEqual(keys.focusKey({ tagName: 'BODY', id: '', attributes: [] }), null, 'body carries no identity');
  // The search box's own restoration is gone — checked on the handler-binding function alone, and
  // by what it does NOT mention, so it does not depend on how the line happens to be formatted.
  // What repaint() actually does with that focus is asserted below, against a stub DOM.
  const attachSrc = extractFunction(script, 'attach');
  assert.ok(/repaint\(\)/.test(attachSrc), 'the search box repaints through the shared wrapper');
  assert.ok(!/selectionStart/.test(attachSrc), 'and no longer restores its own focus and caret by hand');

  // ---- repaint(): focus, caret and scroll land on the copy that had them ----
  // editRow() is rendered from four sites and two of them can be live at once, so the data-*
  // selector matches more than one element and "the first match" is the wrong answer.
  const DUP_KEY = 'input[data-emer="' + base[0].id + '"]';
  const dupBefore = [fakeInput({ 'data-emer': base[0].id }, { caret: [2, 5] }),
                     fakeInput({ 'data-emer': base[0].id }, { caret: [2, 5] })];
  const dupAfter = [fakeInput({ 'data-emer': base[0].id }, { caret: [0, 0] }),
                    fakeInput({ 'data-emer': base[0].id }, { caret: [0, 0] })];
  const dupDom = rebuildingDom(DUP_KEY, dupBefore, dupAfter);
  dupDom.activeElement = dupBefore[1];                     // the SECOND copy is being typed in
  const dup = harness(base, { document: dupDom, pageX: 13, pageY: 421, onRender: dupDom.rebuild });
  dup.repaint();
  assert.strictEqual(dup.renders.n, 1, 'repaint renders once');
  assert.strictEqual(dupAfter[1].focused, 1, 'focus returns to the copy that had it');
  assert.strictEqual(dupAfter[0].focused, 0, 'the other copy of the same row is left alone');
  assert.deepStrictEqual(dupAfter[1].ranges, [[2, 5]], 'the caret comes back with it');
  assert.deepStrictEqual(dupAfter[0].ranges, [], 'and is not written into the wrong copy');
  assert.deepStrictEqual(dup.scrolls, [[13, 421]], 'the scroll offset is restored, not reset to the top');

  // A control whose selection cannot be read at all: Chromium throws on <input type="number">,
  // which is what the 金額 corrector and the split box are. repaint() must still render.
  const NUM_KEY = 'input[data-ef="amount"][data-id="' + base[0].id + '"]';
  const numAttrs = { 'data-ef': 'amount', 'data-id': base[0].id };
  const numBefore = [fakeInput(numAttrs, { selectionThrows: true })];
  const numAfter = [fakeInput(numAttrs, { selectionThrows: true })];
  const numDom = rebuildingDom(NUM_KEY, numBefore, numAfter);
  const num = harness(base, { document: numDom, onRender: numDom.rebuild });
  assert.doesNotThrow(function () { num.repaint(); },
    'reading selectionStart on a number input throws, and repaint() must survive it');
  assert.strictEqual(num.renders.n, 1, 'render() still runs — the probe must not abort the repaint');
  assert.strictEqual(numAfter[0].focused, 1, 'focus is still restored');
  assert.deepStrictEqual(numAfter[0].ranges, [], 'no caret is written when none could be read');

  // ---- a list discarded by the sequence guard is refetched, not lost ----
  // applySplit, bulkPost and submitAdd bump the counter and adopt no list of their own. When one
  // of them supersedes an edit, the edit's authoritative list is dropped — and because 金額 is
  // part of the composite row key, dropping it silently would leave the page holding the row's
  // PRE-EDIT id, which is the key the NEXT write sends. So the drop must be booked and repaid.
  const EDITED_ID = base[0].id.replace('|120|', '|999|');
  function editedList() {
    const l = serverCopy(base);
    l[0].amount = 999; l[0].id = EDITED_ID;
    return l;
  }
  function amountEditSupersededBy(name, issue) {
    const h = harness(base);
    h.applyEdit(base[0].id, 'amount', 999);
    assert.strictEqual(h.calls.length, 1, name + ': the amount edit is written');
    issue(h)();                                            // the other mutation goes out and lands
    assert.strictEqual(h.reads.length, 0, name + ': an ordinary run pays for no extra read');
    h.calls[0].success({ ok: true, txns: editedList() });   // superseded — must not be adopted
    assert.strictEqual(h.TXNS[0].id, base[0].id, name + ': the superseded snapshot is discarded');
    assert.strictEqual(h.reads.length, 1, name + ': and exactly one authoritative refetch is issued');
    h.reads[0].success(editedList());
    assert.strictEqual(h.TXNS[0].id, EDITED_ID,
      name + ': the page ends on the post-edit row key the next write has to send');
    return h;
  }
  amountEditSupersededBy('applySplit', function (h) {
    h.applySplit(base[1].id, '50');
    assert.strictEqual(h.calls.length, 2, 'applySplit writes the split');
    return function () { h.calls[1].success({ ok: true }); };
  });
  amountEditSupersededBy('bulkPost', function (h) {
    h.bulkPost([base[1].id]);
    assert.strictEqual(h.calls.length, 2, 'bulkPost writes its row');
    return function () { h.calls[1].success({ ok: true }); };
  });
  amountEditSupersededBy('submitAdd', function (h) {
    h.submitAdd();
    assert.strictEqual(h.adds.length, 1, 'submitAdd writes the new row');
    return function () { h.adds[0].success({ id: 'manual-9', hm: '' }); };
  });

  // ---- a superseded delete response neither resurrects rows nor strands the page ----
  const del = harness(base);
  del.pendingDelId = base[1].id;
  del.confirmDelete();
  assert.strictEqual(del.deletes.length, 1, 'the delete is written');
  del.applyEdit(base[0].id, 'posted', true);
  del.deletes[0].success({ ok: true, txns: serverCopy(base) });   // the sheet before the tick
  assert.strictEqual(del.TXNS.length, 2, 'a superseded delete response does not rebuild the list');
  assert.strictEqual(del.txnById(base[0].id).posted, true, 'and does not resurrect the pre-tick value');
  const afterTick = serverCopy([base[0]]);
  afterTick[0].posted = true;
  del.calls[0].success({ ok: true, txns: afterTick });
  assert.strictEqual(del.TXNS.length, 1, 'the superseding response brings the authoritative list');
  assert.strictEqual(del.reads.length, 0, 'which settles the debt without a second read');

  // ---- the two call sites that ignore the return value stay on two arguments ----
  const split = extractFunction(script, 'applySplit');
  assert.ok(/\.updateTxn\(id, \{ mine: \(v==null\?'':v\) \}\);/.test(split), 'applySplit still calls updateTxn with two arguments');
  assert.ok(!/getAllTxns/.test(split), 'applySplit does not fetch the full list');
  assert.ok(/revertTxn\(id, \{ mine:prevMine, amount:prevAmt \}\)/.test(split), 'applySplit reverts by re-resolving its row');
  const bulk = extractFunction(script, 'bulkPost');
  assert.ok(/\.updateTxn\(todo\[i\], \{ posted:true \}\);/.test(bulk), 'bulkPost still calls updateTxn with two arguments');
  assert.ok(!/getAllTxns/.test(bulk), 'a ten-row bulk post does not pull ten copies of the table');
  const edit = extractFunction(script, 'applyEdit');
  assert.ok(!/getAllTxns/.test(edit), 'the edit path no longer refetches after a successful write');

  // ---- the server half: opt-in list, flushed before it is read ----
  const server = fs.readFileSync(path.resolve(__dirname, '..', 'sidebar', '程式碼.js'), 'utf8');
  assert.ok(/function updateTxn\(messageId, patch, wantTxns\)/.test(server), 'the fresh list is an opt-in third parameter');
  assert.ok(/if \(wantTxns\) \{\s*SpreadsheetApp\.flush\(\);\s*return \{ ok: true, txns: getAllTxns\(\) \};/.test(server),
    'pending writes are flushed before the list is read, or the page would adopt a pre-write snapshot');
  assert.ok(/\}\s*return \{ ok: true \};\s*\}/.test(server), 'the default return shape is unchanged for the two-argument call sites');
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_paid_tick_repaint');
} else {
  module.exports = { run };
}
