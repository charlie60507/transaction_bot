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

  // A split cleared to '' on the wire is a change against a row whose split was null. Note what
  // this does NOT prove: adoptTxns coerces mine to a number, so '' reaches the signature as 0 and
  // the two are told apart by that coercion, not by the signature's null handling. Every string
  // field getAllTxns returns is String()-coerced server-side and `mine` is the only nullable one,
  // so a signature that conflated null with '' would be indistinguishable here on purpose.
  const nulled = harness(base);
  assert.strictEqual(nulled.adoptTxns(serverCopy(base).map(function (t, i) {
    return i === 0 ? Object.assign({}, t, { mine: '' }) : t;
  })), true, 'a split cleared on the wire is adopted as a change');

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
  // A value carrying a quote or a backslash would need CSS escaping; the selector is abandoned
  // rather than handed to querySelector half-formed (which throws, and takes the repaint with it).
  assert.strictEqual(keys.focusKey({ tagName: 'INPUT', id: '', attributes: [{ name: 'data-id', value: 'a"b' }] }),
    null, 'a value needing CSS escaping gives up instead of building a malformed selector');
  assert.strictEqual(keys.focusKey({ tagName: 'INPUT', id: '', attributes: [{ name: 'data-id', value: 'a' + String.fromCharCode(92) + 'b' }] }),
    null, 'and so does a backslash');
  // .length, not deepStrictEqual: the empty list is built inside the sandbox, so its Array
  // prototype is not this file's.
  assert.strictEqual(
    keys.focusMatches({ querySelectorAll: function () { throw new Error('bad selector'); } }, 'input[data-id="x"]').length,
    0, 'a selector the DOM rejects yields no matches rather than aborting the repaint');
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

  // ---- a MULTI-ROW bulk post supersedes the very refetch it just armed ----
  // INFLIGHT===0 is not proof the page is quiescent. bulkPost settles row i and issues row i+1
  // SYNCHRONOUSLY in the same handler, so the refetch settle() arms while row i is coming home is
  // already superseded before its own response can return. Dropping it there and waiting for the
  // next settle strands the page on the PRE-EDIT row key — nothing settles after the last row —
  // which is exactly the 找不到該筆交易 the debt exists to prevent. The read has to re-book ITSELF.
  const third = other({ id: 'msg-c|3000|60|9999|0', merchant: '7-11', amount: 60, charged: 60 });
  function bulkBase() { return [base[0], base[1], third]; }
  // What the sheet looked like BEFORE the bulk post, with the amount edit already applied: the
  // list the armed read is answered with. Adopting it would un-post the rows just ticked.
  function preBulkList() {
    const l = serverCopy(bulkBase());
    l[0].amount = 999; l[0].id = EDITED_ID;
    return l;
  }
  function settledList() {
    return preBulkList().map(function (t, i) { return i === 0 ? t : Object.assign({}, t, { posted: true }); });
  }
  const multi = harness(bulkBase());
  multi.applyEdit(base[0].id, 'amount', 999);                  // seq 1, still in flight
  multi.bulkPost([base[1].id, third.id]);                      // seq 2 goes out; the third row waits
  assert.strictEqual(multi.calls.length, 2, 'bulk post writes one row at a time');
  multi.calls[0].success({ ok: true, txns: preBulkList() });    // superseded amount edit — dropped
  assert.strictEqual(multi.reads.length, 0, 'the debt waits while a bulk row is still in flight');
  multi.calls[1].success({ ok: true });                        // settles row 1 AND issues row 2
  assert.strictEqual(multi.reads.length, 1, 'the debt arms a refetch the moment INFLIGHT hits zero');
  assert.strictEqual(multi.calls.length, 3, 'and the next bulk row goes out in that same handler');
  multi.calls[2].success({ ok: true });                        // the last row: nothing settles after it
  multi.reads[0].success(preBulkList());                       // the read was stale before it returned
  assert.strictEqual(multi.TXNS[1].posted, true, 'a superseded read does not un-post the bulk rows');
  assert.strictEqual(multi.TXNS[2].posted, true, 'a superseded read does not un-post the bulk rows');
  assert.strictEqual(multi.reads.length, 2,
    'a refetch that is superseded on arrival re-books itself — no later settle is coming');
  multi.reads[1].success(settledList());
  assert.strictEqual(multi.TXNS[0].id, EDITED_ID,
    'the page converges on the post-edit row key the next write has to send');
  assert.strictEqual(multi.reads.length, 2, 'and the retry that adopted a current list stops there');

  // ---- every counter-bumping call site settles on FAILURE too ----
  // A rejected write must book its end as well, or INFLIGHT never returns to zero and the debt a
  // dropped list left behind is never repaid — the page keeps the stale row key for good.
  function debtPaidByFailedMutation(name, issue, reject) {
    const h = harness(base);
    h.applyEdit(base[0].id, 'amount', 999);                    // seq 1
    issue(h);                                                  // seq 2, from the site under test
    h.calls[0].success({ ok: true, txns: editedList() });       // superseded — booked, not adopted
    assert.strictEqual(h.reads.length, 0, name + ': the debt waits for the in-flight write');
    reject(h);                                                 // that write is REJECTED
    assert.strictEqual(h.reads.length, 1, name + ': a rejected write settles, so the debt is repaid');
    h.reads[0].success(editedList());
    assert.strictEqual(h.TXNS[0].id, EDITED_ID, name + ': and the page ends on the post-edit row key');
  }
  const boom = function (h, take) { return function () { take(h).failure(new Error('boom')); }; };
  debtPaidByFailedMutation('applyEdit',
    function (h) { h.applyEdit(base[1].id, 'posted', true); },
    function (h) { boom(h, function (x) { return x.calls[1]; })(); });
  debtPaidByFailedMutation('applySplit',
    function (h) { h.applySplit(base[1].id, '50'); },
    function (h) { boom(h, function (x) { return x.calls[1]; })(); });
  debtPaidByFailedMutation('bulkPost',
    function (h) { h.bulkPost([base[1].id]); },
    function (h) { boom(h, function (x) { return x.calls[1]; })(); });
  debtPaidByFailedMutation('submitAdd',
    function (h) { h.submitAdd(); },
    function (h) { boom(h, function (x) { return x.adds[0]; })(); });
  debtPaidByFailedMutation('confirmDelete',
    function (h) { h.pendingDelId = base[1].id; h.confirmDelete(); },
    function (h) { boom(h, function (x) { return x.deletes[0]; })(); });

  // ---- the refetch's own bookkeeping: one read at a time, re-booked when it cannot be used ----
  // A read that FAILS leaves the debt outstanding for the next settle to retry.
  const retry = harness(base);
  retry.applyEdit(base[0].id, 'amount', 999);                  // seq 1
  retry.applySplit(base[1].id, '50');                          // seq 2 supersedes it
  retry.calls[0].success({ ok: true, txns: editedList() });     // dropped and booked
  retry.calls[1].success({ ok: true });                        // settles at zero → read #1
  assert.strictEqual(retry.reads.length, 1, 'the drop is repaid with one read');
  retry.reads[0].failure(new Error('offline'));
  assert.strictEqual(retry.reads.length, 1, 'a failed read does not retry on the spot');
  retry.applySplit(base[1].id, '60');                          // the next mutation, adopting no list
  retry.calls[2].success({ ok: true });
  assert.strictEqual(retry.reads.length, 2, 'a failed read is re-booked and retried by the next settle');
  retry.reads[1].success(editedList());
  assert.strictEqual(retry.TXNS[0].id, EDITED_ID, 'the retried read is what converges the page');

  // A read already in flight is never duplicated: a second drop rides on the one that is out.
  const once = harness(base);
  once.applyEdit(base[0].id, 'amount', 999);                   // seq 1
  once.applySplit(base[1].id, '50');                           // seq 2
  once.calls[0].success({ ok: true, txns: editedList() });      // dropped and booked
  once.calls[1].success({ ok: true });                         // → read #1, in flight from here on
  assert.strictEqual(once.reads.length, 1, 'one read for the first drop');
  once.applyEdit(base[0].id, 'posted', true);                  // seq 3
  once.applySplit(base[1].id, '70');                           // seq 4 supersedes it
  once.calls[2].success({ ok: true, txns: editedList() });      // a SECOND drop, while read #1 is out
  once.calls[3].success({ ok: true });                         // settles at zero → would refetch
  assert.strictEqual(once.reads.length, 1, 'a read already in flight is not duplicated');
  once.reads[0].success(serverCopy(base));                     // superseded on arrival
  assert.strictEqual(once.reads.length, 2, 'the in-flight read carries both drops and re-issues once');
  assert.strictEqual(once.TXNS[0].id, base[0].id, 'the superseded read is not adopted');
  once.reads[1].success(editedList());
  assert.strictEqual(once.TXNS[0].id, EDITED_ID, 'and the page still converges on the post-edit key');

  // ---- the recovered list reaches the SCREEN, and the debt it paid is CLEARED ----
  // Two properties the rest of this fixture only ever observed through TXNS, which is not what
  // the owner looks at. Adopting the refetch is half the recovery; repainting it is the other
  // half — a page holding the corrected list behind a pre-refetch screen is the same 找不到該筆
  // 交易 for the human, who has no refresh control to force the render. And the debt has to be
  // cleared when the read GOES OUT, not only when a later response happens to carry a list:
  // bulk rows carry none, so an uncleared debt turns every subsequent settle into another full
  // read of the table — the per-row refetch bulkPost exists to avoid, arriving by the back door.
  const paid = harness(bulkBase());
  paid.applyEdit(base[0].id, 'amount', 999);                   // seq 1
  paid.applySplit(base[1].id, '50');                           // seq 2 supersedes it
  paid.calls[0].success({ ok: true, txns: preBulkList() });     // dropped and booked
  paid.calls[1].success({ ok: true });                         // settles at zero → the debt's read
  assert.strictEqual(paid.reads.length, 1, 'the drop is repaid with one read');
  const beforeRecovery = paid.renders.n;
  paid.reads[0].success(preBulkList());                        // current on arrival → adopted
  assert.strictEqual(paid.TXNS[0].id, EDITED_ID, 'the recovered list is adopted');
  assert.strictEqual(paid.renders.n, beforeRecovery + 1,
    'and it is REPAINTED: a recovery that differs from the panel must reach the screen, not just TXNS');

  // Read budget, stated as the property rather than as a number: a bulk post that follows a PAID
  // debt pulls ZERO lists, however many rows it writes. Each extra row must cost one write and
  // nothing else — the budget is flat in N, not one read per row.
  const BULK_IDS = [base[1].id, third.id, EDITED_ID];   // every row the recovered list holds
  const readsAfterDebt = paid.reads.length;
  const writesBeforeBulk = paid.calls.length;
  paid.bulkPost(BULK_IDS);
  for (let i = 0; i < BULK_IDS.length; i++) {
    const c = paid.calls[writesBeforeBulk + i];
    assert.ok(c, 'bulk row ' + (i + 1) + ' is written');
    assert.strictEqual(c.wantTxns, undefined, 'bulk row ' + (i + 1) + ' asks for no list');
    c.success({ ok: true });                                   // settles, then issues the next row
  }
  assert.strictEqual(paid.calls.length, writesBeforeBulk + BULK_IDS.length,
    'a bulk post is exactly one write per row');
  assert.strictEqual(paid.reads.length - readsAfterDebt, 0,
    'and pays for no read at all once the debt is paid — an N-row bulk post pulls 0 copies of the list, not N');
  assert.ok(paid.TXNS.every(function (t) { return t.posted; }), 'every bulk row is posted');

  // ---- a superseded read does NOT go straight back out while a write is still in flight ----
  // The re-book is unconditional; re-ISSUING on the spot is not. Reading the table while a write
  // is out fetches a list that is already behind that write, so it can only come home stale and
  // ask again. The debt is remembered instead and goes out once, when the write has landed.
  const gated = harness(bulkBase());
  gated.applyEdit(base[0].id, 'amount', 999);                  // seq 1
  gated.applySplit(base[1].id, '50');                          // seq 2 supersedes it
  gated.calls[0].success({ ok: true, txns: preBulkList() });    // dropped and booked
  gated.calls[1].success({ ok: true });                        // settles at zero → read #1 (seq 2)
  assert.strictEqual(gated.reads.length, 1, 'the drop is repaid with one read');
  gated.applySplit(base[1].id, '60');                          // seq 3, WHILE read #1 is out
  gated.reads[0].success(preBulkList());                       // stale on arrival, INFLIGHT is 1
  assert.strictEqual(gated.reads.length, 1,
    'a superseded read is re-booked, not re-issued, while a mutation is still in flight');
  assert.strictEqual(gated.TXNS[0].id, base[0].id, 'and the superseded list is not adopted');
  gated.calls[2].success({ ok: true });                        // that write lands → INFLIGHT zero
  assert.strictEqual(gated.reads.length, 2, 'the re-booked debt goes out exactly once after it');
  gated.reads[1].success(preBulkList());
  assert.strictEqual(gated.TXNS[0].id, EDITED_ID, 'and the page converges on the post-edit row key');
  assert.strictEqual(gated.reads.length, 2, 'the read that adopted a current list stops there');

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
  // Behaviourally first — the recording stub captures the third argument, so "asks for no list"
  // is an observation rather than a whitespace-exact match on the file's text.
  const arity = harness(base);
  arity.applySplit(base[0].id, '50');
  assert.strictEqual(arity.calls[0].wantTxns, undefined, 'applySplit asks for no list');
  arity.calls[0].success({ ok: true });
  arity.bulkPost([base[1].id]);
  assert.strictEqual(arity.calls[1].wantTxns, undefined, 'a bulk row asks for no list');
  arity.calls[1].success({ ok: true });
  assert.strictEqual(arity.reads.length, 0, 'and an ordinary run of either pays for no extra read');

  const split = extractFunction(script, 'applySplit');
  assert.ok(/\.updateTxn\(\s*id,\s*\{\s*mine:\s*\(v==null\?'':v\)\s*\}\s*\)/.test(split), 'applySplit still calls updateTxn with two arguments');
  assert.ok(!/getAllTxns/.test(split), 'applySplit does not fetch the full list');
  assert.ok(/revertTxn\(\s*id,\s*\{\s*mine:prevMine,\s*amount:prevAmt\s*\}\s*\)/.test(split), 'applySplit reverts by re-resolving its row');
  const bulk = extractFunction(script, 'bulkPost');
  assert.ok(/\.updateTxn\(\s*todo\[i\],\s*\{\s*posted:true\s*\}\s*\)/.test(bulk), 'bulkPost still calls updateTxn with two arguments');
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
