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
  'cat', 'merchant', 'bank', 'last4', 'link', 'posted'];

function row(overrides) {
  return Object.assign({
    id: 'msg-a|1000|120|1234|0', rowId: '', y: 2026, m: 8, d: 12, hm: '09:00', type: '支出',
    amount: 120, charged: 120, mine: null, cat: '飲食', merchant: '星巴克',
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

const PANEL_FNS = ['txnsSignature', 'adoptTxns', 'ackTxns', 'txnById', 'nextMutation', 'isStale', 'settle',
  'refreshTxns', 'focusKey', 'focusMatches', 'focusIndex', 'repaint', 'revertTxn', 'applyEdit',
  'ensureTextRowKey', 'textTxn', 'textRowKey', 'resolveTextRowId', 'rawDraftKey', 'draftKey',
  'textRowLineage', 'dropTextRowState', 'reconcileTextRowIds', 'preservePendingAddRows',
  'beginRowWrite', 'endRowWrite', 'enqueueRowWrite', 'resumeRowWrites', 'cancelRowWrites',
  'textDraft', 'draftValue', 'captureDraft', 'hasActiveComposition',
  'textWriteQueue', 'textInputMatches', 'syncTextCopies', 'nextTextRequestToken',
  'beginComposition', 'endComposition', 'cancelTextDraft', 'consumeTextCancel',
  'isImeKeyEvent', 'handleTextKeydown', 'normalizedTextValue', 'issueTextSave', 'drainTextWrite',
  'saveTextDraft', 'trySendRowCommit', 'commitRow', 'applySplit', 'bulkPost',
  'submitAdd', 'openDelModal', 'confirmDelete', 'cancelDeleteIntent', 'trySendDelete', 'closeDelModal', 'closeAddModal',
  'chargedOf', 'isSplitTxn', 'fmt'];

function harness(initial, opts) {
  opts = opts || {};
  const renders = { n: 0 };
  const toasts = [];
  const scrolls = [];
  const timers = [];
  const rec = { calls: [], deletes: [], adds: [], reads: [] };
  const doc = opts.document || domStub(ADD_FORM);
  const fns = loadFns(PANEL_FNS, {
    TXNS: serverCopy(initial || []),
    MUTATION_SEQ: 0, INFLIGHT: 0, STALE_DROPPED: false, REFRESHING: false,
    TEXT_DRAFTS: {}, TEXT_DRAFT_REVISIONS: {}, TEXT_REQUEST_TOKENS: {}, TEXT_WRITE_QUEUES: {},
    TEXT_CANCEL_BLURS: {}, ROW_COMMIT_INTENTS: {}, ACTIVE_COMPOSITIONS: {}, PENDING_REPAINT: false,
    COMPOSITION_FLUSH_SCHEDULED: false, TEXT_ROW_SERIAL: 0, TEXT_REMOVED_ROW_KEYS: {},
    PENDING_ADD_ROWS: {}, ROW_ACTIVE_WRITES: {}, ROW_DELETE_INTENTS: {}, ROW_WRITE_FIFOS: {},
    pendingDelId: null, pendingDelRowKey: null, delBusy: false, openSplit: null,
    google: { script: { run: recordingRun(rec) } },
    render: function () { renders.n++; if (opts.onRender) opts.onRender(); },
    toast: function (msg, isErr) { toasts.push({ msg: msg, err: !!isErr }); },
    setTimeout: function (fn) { timers.push(fn); return timers.length; },
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
  fns.flushTimers = function () { while (timers.length) timers.shift()(); };
  return fns;
}

const ADD_FORM = {
  'a-date': '2026-08-12', 'a-amt': '80', 'a-time': '', 'a-type': '支出',
  'a-source': '現金', 'a-mer': '午餐', 'a-cat': '飲食'
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

function duplicateTextDom(id, field, initial) {
  const selector = '[data-emer="' + id + '"]';
  const nodes = [0, 1].map(function () { return { value: initial, defaultValue: initial }; });
  return {
    nodes: nodes,
    activeElement: null,
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function (sel) {
      if (sel === selector) return nodes;
      if (field === 'merchant' && sel.indexOf('[data-emer]') >= 0) return nodes;
      return [];
    }
  };
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
  assert.strictEqual(tick.calls[0].wantTxns, 'recent', 'the edit asks for the fresh (recent-window) data in the same call');
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

  // ---- IME-aware drafts: composition defers destructive repaint and flushes once ----
  ['merchant'].forEach(function (field) {
    const h = harness(base);
    const initial = '買晚餐';
    const finalValue = initial + '餐廳';
    h.beginComposition(base[0].id, field, initial);
    h.captureDraft(base[0].id, field, finalValue);
    h.repaint();
    h.repaint();
    assert.strictEqual(h.renders.n, 0, field + ': repaint is deferred while composition is active');
    assert.strictEqual(h.PENDING_REPAINT, true, field + ': repeated repaint requests coalesce');
    h.endComposition(base[0].id, field, finalValue);
    assert.strictEqual(h.renders.n, 0, field + ': compositionend does not detach the input synchronously');
    h.flushTimers();
    assert.strictEqual(h.renders.n, 1, field + ': the queued repaint flushes exactly once');
    assert.strictEqual(h.draftValue(base[0], field), finalValue,
      field + ': rebuilt copies resolve the same logical draft value');
    assert.strictEqual(h.draftValue(Object.assign({}, base[0]), field), finalValue,
      field + ': draft identity is transaction plus field, not a DOM-copy index');
  });

  // A trailing input after compositionend runs before the queued repaint and becomes the value
  // rendered into every copy, rather than being lost with the detached native input.
  const trailing = harness(base);
  trailing.beginComposition(base[0].id, 'merchant', '買晚餐');
  trailing.repaint();
  trailing.endComposition(base[0].id, 'merchant', '買晚餐餐');
  trailing.captureDraft(base[0].id, 'merchant', '買晚餐餐廳');
  trailing.flushTimers();
  assert.strictEqual(trailing.draftValue(base[0], 'merchant'), '買晚餐餐廳',
    'the final post-composition input is captured before the queued repaint');

  // A separate write can change the composite transaction id while Chromium still owns an IME
  // composition. The logical draft, composition lock and next save must follow that row identity.
  const rekeyDuringIme = harness(base);
  const REKEYED_ID = base[0].id.replace('|120|', '|999|');
  const LOGICAL_ROW = rekeyDuringIme.textRowKey(base[0].id);
  rekeyDuringIme.beginComposition(LOGICAL_ROW, 'merchant', '組字');
  rekeyDuringIme.captureDraft(LOGICAL_ROW, 'merchant', '組字完成');
  const rekeyedRows = serverCopy(base);
  rekeyedRows[0].amount = 999; rekeyedRows[0].id = REKEYED_ID;
  assert.strictEqual(rekeyDuringIme.adoptTxns(rekeyedRows), true, 'the id-changing list is adopted');
  assert.strictEqual(rekeyDuringIme.resolveTextRowId(LOGICAL_ROW), REKEYED_ID,
    'the DOM-bound logical row resolves to the server id that replaced it');
  assert.strictEqual(rekeyDuringIme.draftValue(rekeyDuringIme.TXNS[0], 'merchant'), '組字完成',
    'the live draft moves to the new composite id');
  rekeyDuringIme.repaint();
  assert.strictEqual(rekeyDuringIme.renders.n, 0, 'the migrated composition still defers repaint');
  rekeyDuringIme.endComposition(LOGICAL_ROW, 'merchant', '組字完成');
  rekeyDuringIme.flushTimers();
  assert.strictEqual(rekeyDuringIme.renders.n, 1, 'ending composition through the old DOM id flushes once');
  rekeyDuringIme.saveTextDraft(LOGICAL_ROW, 'merchant');
  assert.strictEqual(rekeyDuringIme.calls[0].id, REKEYED_ID,
    'the next write uses the authoritative id rather than the detached DOM id');

  // Occurrence ids can be recycled inside one duplicate group: after row 1 changes amount,
  // row 2 may inherit row 1's old string id. Client-only keys preserve identity by sheet order.
  const dupRows = [
    row({ id: 'same|1000|100|1234|0', amount: 100, merchant: '第一列' }),
    row({ id: 'same|1000|100|1234|1', amount: 100, merchant: '第二列' })
  ];
  const duplicateRekey = harness(dupRows);
  const firstLogical = duplicateRekey.textRowKey(dupRows[0].id);
  const secondLogical = duplicateRekey.textRowKey(dupRows[1].id);
  duplicateRekey.captureDraft(firstLogical, 'merchant', '第一列草稿');
  duplicateRekey.captureDraft(secondLogical, 'merchant', '第二列草稿');
  const shifted = serverCopy(dupRows);
  shifted[0].amount = 200; shifted[0].id = 'same|1000|200|1234|0';
  shifted[1].id = 'same|1000|100|1234|0';
  duplicateRekey.adoptTxns(shifted);
  assert.strictEqual(duplicateRekey.TXNS[0]._textKey, firstLogical,
    'the changed first duplicate keeps the first logical editor despite losing its old id');
  assert.strictEqual(duplicateRekey.TXNS[1]._textKey, secondLogical,
    'the second duplicate does not steal the first row identity when it inherits that id string');
  assert.strictEqual(duplicateRekey.draftValue(duplicateRekey.TXNS[0], 'merchant'), '第一列草稿');
  assert.strictEqual(duplicateRekey.draftValue(duplicateRekey.TXNS[1], 'merchant'), '第二列草稿');
  duplicateRekey.saveTextDraft(secondLogical, 'merchant');
  assert.strictEqual(duplicateRekey.calls[0].id, shifted[1].id,
    'the second draft writes to the second row after occurrence renumbering');
  duplicateRekey.openDelModal(secondLogical);
  assert.strictEqual(duplicateRekey.pendingDelRowKey, secondLogical,
    'a delete click from stale DOM keeps targeting its logical row after occurrence renumbering');
  assert.strictEqual(duplicateRekey.document.getElementById('d-mer').textContent, '第二列草稿',
    'the delete confirmation describes the intended row, not the row that inherited its old id');

  const threeDupes = [
    row({ id: 'del|1000|100|1234|0', amount: 100, merchant: '刪除列' }),
    row({ id: 'del|1000|100|1234|1', amount: 100, merchant: '保留二' }),
    row({ id: 'del|1000|100|1234|2', amount: 100, merchant: '保留三' })
  ];
  const deleteReconcile = harness(threeDupes);
  const keepSecond = deleteReconcile.textRowKey(threeDupes[1].id);
  const keepThird = deleteReconcile.textRowKey(threeDupes[2].id);
  deleteReconcile.captureDraft(keepSecond, 'merchant', '第二列草稿');
  deleteReconcile.captureDraft(keepThird, 'merchant', '第三列草稿');
  deleteReconcile.pendingDelId = threeDupes[0].id;
  deleteReconcile.pendingDelRowKey = deleteReconcile.textRowKey(threeDupes[0].id);
  deleteReconcile.confirmDelete();
  const afterDelete = serverCopy(threeDupes.slice(1));
  afterDelete[0].id = 'del|1000|100|1234|0'; afterDelete[1].id = 'del|1000|100|1234|1';
  deleteReconcile.deletes[0].success({ ok: true, txns: afterDelete });
  assert.strictEqual(deleteReconcile.TXNS[0]._textKey, keepSecond,
    'deleting the first duplicate does not shift row 2 logical state onto row 3');
  assert.strictEqual(deleteReconcile.TXNS[1]._textKey, keepThird,
    'the last duplicate retains its own logical state after occurrence renumbering');
  assert.strictEqual(deleteReconcile.draftValue(deleteReconcile.TXNS[0], 'merchant'), '第二列草稿');
  assert.strictEqual(deleteReconcile.draftValue(deleteReconcile.TXNS[1], 'merchant'), '第三列草稿');

  // Delete is bound to the client row, not the occurrence string visible when the modal opened,
  // and waits for an in-flight amount write that can renumber every duplicate in the group.
  const deleteAfterRekey = harness(threeDupes);
  const deleteLogical = deleteAfterRekey.textRowKey(threeDupes[1].id);
  deleteAfterRekey.applyEdit(deleteLogical, 'amount', 200);
  deleteAfterRekey.pendingDelId = threeDupes[1].id;
  deleteAfterRekey.pendingDelRowKey = deleteLogical;
  deleteAfterRekey.confirmDelete();
  assert.strictEqual(deleteAfterRekey.deletes.length, 0, 'delete waits for the row write already in flight');
  const amountShifted = serverCopy(threeDupes);
  amountShifted[1].amount = 200; amountShifted[1].id = 'del|1000|200|1234|0';
  amountShifted[2].id = 'del|1000|100|1234|1';
  deleteAfterRekey.calls[0].success({ ok: true, txns: amountShifted });
  assert.strictEqual(deleteAfterRekey.deletes.length, 1, 'delete dispatches after the amount response is adopted');
  assert.strictEqual(deleteAfterRekey.deletes[0].arg.id, 'del|1000|200|1234|0',
    'delete resolves the intended logical row to its current server id, not the recycled occurrence id');

  const fifoBase = serverCopy(base);
  fifoBase[0].rowId = 'uuid-row-a';
  const fifo = harness(fifoBase);
  const fifoKey = fifo.textRowKey(fifoBase[0].id);
  fifo.applyEdit(fifoKey, 'amount', 999);
  fifo.applyEdit(fifoKey, 'cat', '交通');
  assert.strictEqual(fifo.calls.length, 1, 'same-row writes are dispatched one at a time');
  assert.strictEqual(fifo.calls[0].id, 'uuid-row-a', 'row writes use the immutable UUID');
  const amountOnly = serverCopy(fifoBase); amountOnly[0].amount = 999;
  fifo.calls[0].success({ ok: true, txns: amountOnly });
  assert.strictEqual(fifo.calls.length, 2, 'the next same-row write starts only after the first response');
  assert.strictEqual(fifo.calls[1].patch.cat, '交通');
  assert.strictEqual(fifo.TXNS[0].cat, '交通', 'an older acknowledgement cannot erase the queued optimistic value');

  const fifoThenDelete = harness(fifoBase);
  const fifoDeleteKey = fifoThenDelete.textRowKey(fifoBase[0].id);
  fifoThenDelete.applyEdit(fifoDeleteKey, 'amount', 999);
  fifoThenDelete.applyEdit(fifoDeleteKey, 'cat', '交通');
  fifoThenDelete.pendingDelId = fifoBase[0].id;
  fifoThenDelete.pendingDelRowKey = fifoDeleteKey;
  fifoThenDelete.confirmDelete();
  assert.strictEqual(fifoThenDelete.deletes.length, 0,
    'delete waits while the first same-row write is active and a second is queued');
  fifoThenDelete.calls[0].success({ ok: true, txns: amountOnly });
  assert.strictEqual(fifoThenDelete.calls.length, 2, 'the queued write starts before delete is reconsidered');
  assert.strictEqual(fifoThenDelete.deletes.length, 0,
    'delete cannot overtake the second same-row write between FIFO entries');
  const bothEdits = serverCopy(amountOnly); bothEdits[0].cat = '交通';
  fifoThenDelete.calls[1].success({ ok: true, txns: bothEdits });
  assert.strictEqual(fifoThenDelete.deletes.length, 1,
    'delete dispatches only after every queued same-row write settles');
  assert.strictEqual(fifoThenDelete.deletes[0].arg.id, 'uuid-row-a');

  const recordThenDelete = harness(base);
  const recordDeleteKey = recordThenDelete.textRowKey(base[0].id);
  recordThenDelete.captureDraft(recordDeleteKey, 'merchant', '先存再刪');
  recordThenDelete.saveTextDraft(recordDeleteKey, 'merchant');
  recordThenDelete.commitRow(recordDeleteKey, true);
  recordThenDelete.pendingDelId = base[0].id;
  recordThenDelete.pendingDelRowKey = recordDeleteKey;
  recordThenDelete.confirmDelete();
  assert.strictEqual(recordThenDelete.deletes.length, 0, 'delete waits behind the active text save and queued Record');
  const savedBeforeRecord = serverCopy(base); savedBeforeRecord[0].merchant = '先存再刪';
  recordThenDelete.calls[0].success({ ok: true, txns: savedBeforeRecord });
  assert.strictEqual(recordThenDelete.calls.length, 2, 'the pre-existing Record advances despite the later delete intent');
  const recordedBeforeDelete = serverCopy(savedBeforeRecord); recordedBeforeDelete[0].posted = true;
  recordThenDelete.calls[1].success({ ok: true, txns: recordedBeforeDelete });
  assert.strictEqual(recordThenDelete.deletes.length, 1, 'delete advances after the queued Record settles');

  const newerTextThenDelete = harness(base);
  const newerTextKey = newerTextThenDelete.textRowKey(base[0].id);
  newerTextThenDelete.captureDraft(newerTextKey, 'merchant', '第一版');
  newerTextThenDelete.saveTextDraft(newerTextKey, 'merchant');
  newerTextThenDelete.captureDraft(newerTextKey, 'merchant', '刪除前最後一版');
  newerTextThenDelete.saveTextDraft(newerTextKey, 'merchant');
  newerTextThenDelete.pendingDelId = base[0].id;
  newerTextThenDelete.pendingDelRowKey = newerTextKey;
  newerTextThenDelete.confirmDelete();
  assert.strictEqual(newerTextThenDelete.deletes.length, 0,
    'delete waits for an active text save and its newer pending revision');
  const firstTextAck = serverCopy(base); firstTextAck[0].merchant = '第一版';
  newerTextThenDelete.calls[0].success({ ok: true, txns: firstTextAck });
  assert.strictEqual(newerTextThenDelete.calls.length, 2,
    'the revision queued before delete confirmation still enters the row FIFO');
  assert.strictEqual(newerTextThenDelete.calls[1].patch.merchant, '刪除前最後一版');
  assert.strictEqual(newerTextThenDelete.deletes.length, 0,
    'delete cannot overtake the final pending text revision');
  const finalTextAck = serverCopy(base); finalTextAck[0].merchant = '刪除前最後一版';
  newerTextThenDelete.calls[1].success({ ok: true, txns: finalTextAck });
  assert.strictEqual(newerTextThenDelete.deletes.length, 1,
    'delete dispatches after the last pre-confirmation text revision is durable');

  const failedTextBase = serverCopy(base); failedTextBase[0].rowId = 'uuid-row-a';
  const failedTextThenDelete = harness(failedTextBase);
  const failedTextKey = failedTextThenDelete.textRowKey(failedTextBase[0].id);
  failedTextThenDelete.captureDraft(failedTextKey, 'merchant', '第一版');
  failedTextThenDelete.saveTextDraft(failedTextKey, 'merchant');
  failedTextThenDelete.captureDraft(failedTextKey, 'merchant', '寫入失敗的最後一版');
  failedTextThenDelete.saveTextDraft(failedTextKey, 'merchant');
  failedTextThenDelete.pendingDelId = failedTextBase[0].id;
  failedTextThenDelete.pendingDelRowKey = failedTextKey;
  failedTextThenDelete.confirmDelete();
  const failedFirstAck = serverCopy(failedTextBase); failedFirstAck[0].merchant = '第一版';
  failedTextThenDelete.calls[0].success({ ok: true, txns: failedFirstAck });
  failedTextThenDelete.calls[1].failure(new Error('write failed'));
  assert.strictEqual(failedTextThenDelete.deletes.length, 0,
    'a failed final text revision cancels delete instead of archiving stale text');
  assert.strictEqual(failedTextThenDelete.ROW_DELETE_INTENTS[failedTextKey], undefined);
  assert.strictEqual(failedTextThenDelete.delBusy, false, 'the row remains available for a deliberate retry');
  assert.ok(failedTextThenDelete.textTxn(failedTextKey), 'the row is retained after the protected write fails');

  // Every asynchronous callback that can rebuild the transaction panel goes through repaint(),
  // so an unrelated add/delete/bulk response cannot detach an active native IME node.
  function assertAsyncRepaintDefers(name, issue, resolve) {
    const h = harness(base);
    issue(h);
    const before = h.renders.n;
    h.beginComposition(base[0].id, 'merchant', '輸入中');
    resolve(h);
    assert.strictEqual(h.renders.n, before, name + ': callback repaint is deferred during composition');
    assert.strictEqual(h.PENDING_REPAINT, true, name + ': callback records one pending repaint');
    h.endComposition(base[0].id, 'merchant', '輸入完成');
    h.flushTimers();
    assert.strictEqual(h.renders.n, before + 1, name + ': deferred repaint flushes once after composition');
  }
  assertAsyncRepaintDefers('add success', function (h) { h.submitAdd(); },
    function (h) { h.adds[0].success({ id: 'manual-9', hm: '' }); });
  assertAsyncRepaintDefers('add failure', function (h) { h.submitAdd(); },
    function (h) { h.adds[0].failure(new Error('boom')); });
  assertAsyncRepaintDefers('delete success', function (h) {
    h.pendingDelId = base[1].id; h.pendingDelRowKey = h.textRowKey(base[1].id); h.confirmDelete();
  }, function (h) { h.deletes[0].success({ ok: true, txns: serverCopy([base[0]]) }); });
  assertAsyncRepaintDefers('bulk failure', function (h) { h.bulkPost([base[1].id]); },
    function (h) { h.calls[0].failure(new Error('boom')); });

  const addTyping = harness(base);
  addTyping.submitAdd();
  const optimistic = addTyping.TXNS[addTyping.TXNS.length - 1];
  const optimisticLogical = addTyping.textRowKey(optimistic.id);
  addTyping.beginComposition(optimisticLogical, 'merchant', '回覆前輸入');
  addTyping.adds[0].success({ id: 'manual-9', hm: '' });
  assert.strictEqual(addTyping.resolveTextRowId(optimisticLogical), 'manual-9',
    'the optimistic manual row keeps its logical key when the server id arrives');
  assert.strictEqual(addTyping.draftValue(optimistic, 'merchant'), '回覆前輸入',
    'typing begun before add success survives the id replacement');
  addTyping.endComposition(optimisticLogical, 'merchant', '回覆前輸入');
  addTyping.flushTimers();
  addTyping.saveTextDraft(optimisticLogical, 'merchant');
  assert.strictEqual(addTyping.calls[0].id, 'manual-9', 'the preserved manual-row draft saves by the final id');

  const addBlurBeforeAck = harness(base);
  addBlurBeforeAck.submitAdd();
  const pendingManual = addBlurBeforeAck.TXNS[addBlurBeforeAck.TXNS.length - 1];
  const pendingManualKey = addBlurBeforeAck.textRowKey(pendingManual.id);
  addBlurBeforeAck.captureDraft(pendingManualKey, 'merchant', '先輸入再回覆');
  addBlurBeforeAck.saveTextDraft(pendingManualKey, 'merchant');
  assert.strictEqual(addBlurBeforeAck.calls.length, 0,
    'blur before add acknowledgement queues text instead of writing the temporary id');
  addBlurBeforeAck.adds[0].success({ id: 'manual-10', hm: '' });
  assert.strictEqual(addBlurBeforeAck.calls.length, 1, 'the queued text drains when the final id arrives');
  assert.strictEqual(addBlurBeforeAck.calls[0].id, 'manual-10');
  assert.strictEqual(addBlurBeforeAck.calls[0].patch.merchant, '先輸入再回覆');

  const addTextDeleteBeforeAck = harness(base);
  addTextDeleteBeforeAck.submitAdd();
  const textDeletePending = addTextDeleteBeforeAck.TXNS[addTextDeleteBeforeAck.TXNS.length - 1];
  const textDeletePendingKey = addTextDeleteBeforeAck.textRowKey(textDeletePending.id);
  addTextDeleteBeforeAck.captureDraft(textDeletePendingKey, 'merchant', '新增後要保留的文字');
  addTextDeleteBeforeAck.saveTextDraft(textDeletePendingKey, 'merchant');
  addTextDeleteBeforeAck.pendingDelId = textDeletePending.id;
  addTextDeleteBeforeAck.pendingDelRowKey = textDeletePendingKey;
  addTextDeleteBeforeAck.confirmDelete();
  addTextDeleteBeforeAck.adds[0].success({
    id: 'manual-10b|3000|80||0', rowId: 'uuid-manual-10b', hm: '', y: 2026, m: 8, d: 12
  });
  assert.strictEqual(addTextDeleteBeforeAck.calls.length, 1,
    'pending manual text is written after UUID acknowledgement even when delete is confirmed');
  assert.strictEqual(addTextDeleteBeforeAck.calls[0].id, 'uuid-manual-10b');
  assert.strictEqual(addTextDeleteBeforeAck.deletes.length, 0,
    'pending manual delete waits for the pre-confirmation text write');
  addTextDeleteBeforeAck.calls[0].success({ ok: true });
  assert.strictEqual(addTextDeleteBeforeAck.deletes.length, 1,
    'pending manual delete starts only after its final text is durable');
  assert.strictEqual(addTextDeleteBeforeAck.deletes[0].arg.id, 'uuid-manual-10b');

  const addTextDeleteFailure = harness(base);
  addTextDeleteFailure.submitAdd();
  const failingManual = addTextDeleteFailure.TXNS[addTextDeleteFailure.TXNS.length - 1];
  const failingManualKey = addTextDeleteFailure.textRowKey(failingManual.id);
  addTextDeleteFailure.captureDraft(failingManualKey, 'merchant', '不能遺失的文字');
  addTextDeleteFailure.saveTextDraft(failingManualKey, 'merchant');
  addTextDeleteFailure.pendingDelId = failingManual.id;
  addTextDeleteFailure.pendingDelRowKey = failingManualKey;
  addTextDeleteFailure.confirmDelete();
  addTextDeleteFailure.adds[0].success({
    id: 'manual-10c|3000|80||0', rowId: 'uuid-manual-10c', hm: '', y: 2026, m: 8, d: 12
  });
  addTextDeleteFailure.calls[0].failure(new Error('write failed'));
  assert.strictEqual(addTextDeleteFailure.deletes.length, 0,
    'a pending manual row is not deleted when its final text fails to persist');
  assert.strictEqual(addTextDeleteFailure.ROW_DELETE_INTENTS[failingManualKey], undefined);
  assert.strictEqual(addTextDeleteFailure.delBusy, false);
  assert.ok(addTextDeleteFailure.textTxn(failingManualKey),
    'the acknowledged manual row remains visible so the owner can retry');

  const addRecordBeforeAck = harness(base);
  addRecordBeforeAck.submitAdd();
  const recordPending = addRecordBeforeAck.TXNS[addRecordBeforeAck.TXNS.length - 1];
  const recordPendingKey = addRecordBeforeAck.textRowKey(recordPending.id);
  addRecordBeforeAck.captureDraft(recordPendingKey, 'merchant', '待回覆說明');
  addRecordBeforeAck.commitRow(recordPendingKey, false);
  assert.strictEqual(addRecordBeforeAck.calls.length, 0,
    'Record intent also waits while the manual row has only a temporary id');
  addRecordBeforeAck.adds[0].success({ id: 'manual-11', hm: '' });
  assert.strictEqual(addRecordBeforeAck.calls.length, 1, 'the queued Record drains after add acknowledgement');
  assert.strictEqual(addRecordBeforeAck.calls[0].id, 'manual-11');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(addRecordBeforeAck.calls[0].patch)), {
    posted: false, merchant: '待回覆說明'
  });

  const addEditBeforeAck = harness(base);
  addEditBeforeAck.submitAdd();
  const editPending = addEditBeforeAck.TXNS[addEditBeforeAck.TXNS.length - 1];
  const editPendingKey = addEditBeforeAck.textRowKey(editPending.id);
  addEditBeforeAck.applyEdit(editPendingKey, 'amount', 125);
  assert.strictEqual(addEditBeforeAck.calls.length, 0,
    'a discrete edit waits while the manual row has only a temporary id');
  addEditBeforeAck.adds[0].success({
    id: 'manual-13|3000|80||0', rowId: 'uuid-manual-13', hm: '', y: 2026, m: 8, d: 12
  });
  assert.strictEqual(addEditBeforeAck.calls.length, 1, 'the queued discrete edit resumes after add acknowledgement');
  assert.strictEqual(addEditBeforeAck.calls[0].id, 'uuid-manual-13');
  assert.strictEqual(addEditBeforeAck.calls[0].patch.amount, 125);

  const addSplitBeforeAck = harness(base);
  addSplitBeforeAck.submitAdd();
  const splitPending = addSplitBeforeAck.TXNS[addSplitBeforeAck.TXNS.length - 1];
  const splitPendingKey = addSplitBeforeAck.textRowKey(splitPending.id);
  addSplitBeforeAck.applySplit(splitPendingKey, '25');
  assert.strictEqual(addSplitBeforeAck.calls.length, 0,
    'a split waits while the manual row has only a temporary id');
  addSplitBeforeAck.adds[0].success({
    id: 'manual-14|3000|80||0', rowId: 'uuid-manual-14', hm: '', y: 2026, m: 8, d: 12
  });
  assert.strictEqual(addSplitBeforeAck.calls.length, 1, 'the queued split resumes after add acknowledgement');
  assert.strictEqual(addSplitBeforeAck.calls[0].id, 'uuid-manual-14');
  assert.strictEqual(addSplitBeforeAck.calls[0].patch.mine, 25);

  const addQueuedEditFailure = harness(base);
  addQueuedEditFailure.submitAdd();
  const failedEditPending = addQueuedEditFailure.TXNS[addQueuedEditFailure.TXNS.length - 1];
  const failedEditKey = addQueuedEditFailure.textRowKey(failedEditPending.id);
  addQueuedEditFailure.applyEdit(failedEditKey, 'cat', '交通');
  assert.strictEqual(addQueuedEditFailure.INFLIGHT, 2, 'the add and queued edit are both tracked mutations');
  addQueuedEditFailure.adds[0].failure(new Error('add failed'));
  assert.strictEqual(addQueuedEditFailure.calls.length, 0, 'a failed add never dispatches its queued temp-id edit');
  assert.strictEqual(addQueuedEditFailure.INFLIGHT, 0, 'cancelling a queued edit settles its mutation accounting');
  assert.strictEqual(addQueuedEditFailure.ROW_WRITE_FIFOS[failedEditKey], undefined,
    'a failed add discards its dormant row-write queue');

  // Another write can adopt a snapshot containing the final manual row before addTxn's own
  // callback runs. The pending-add map keeps the temp logical identity and joins it to that row.
  const addSnapshotRace = harness(base);
  addSnapshotRace.submitAdd();
  const racedTemp = addSnapshotRace.TXNS[addSnapshotRace.TXNS.length - 1];
  const racedTempKey = addSnapshotRace.textRowKey(racedTemp.id);
  addSnapshotRace.captureDraft(racedTempKey, 'merchant', '快照期間輸入');
  addSnapshotRace.saveTextDraft(racedTempKey, 'merchant');
  const snapshotWithFinal = serverCopy(base).concat([
    row({ id: 'manual-12|3000|80||0', y: 2026, m: 8, d: 18, amount: 80, charged: 80,
      merchant: '午餐', bank: '現金', last4: '', posted: true })
  ]);
  addSnapshotRace.adoptTxns(snapshotWithFinal);
  assert.ok(addSnapshotRace.TXNS.some(function (t) { return t._textKey === racedTempKey; }),
    'an unrelated authoritative snapshot cannot evict the pending optimistic identity');
  addSnapshotRace.adds[0].success({ id: 'manual-12|3000|80||0', hm: '', y: 2026, m: 8, d: 18 });
  assert.strictEqual(addSnapshotRace.calls.length, 1, 'queued text drains after the callback joins the final row');
  assert.strictEqual(addSnapshotRace.calls[0].id, 'manual-12|3000|80||0');
  assert.strictEqual(addSnapshotRace.calls[0].patch.merchant, '快照期間輸入');
  assert.strictEqual(addSnapshotRace.TXNS.filter(function (t) { return t.id === 'manual-12|3000|80||0'; }).length, 1,
    'joining the acknowledged row removes the detached optimistic duplicate');

  const addDeleteFailureDom = domStub(ADD_FORM);
  const addDeleteFailure = harness(base, { document: addDeleteFailureDom });
  addDeleteFailure.submitAdd();
  const failedPending = addDeleteFailure.TXNS[addDeleteFailure.TXNS.length - 1];
  const failedPendingKey = addDeleteFailure.textRowKey(failedPending.id);
  addDeleteFailure.pendingDelId = failedPending.id;
  addDeleteFailure.pendingDelRowKey = failedPendingKey;
  addDeleteFailure.confirmDelete();
  assert.strictEqual(addDeleteFailure.delBusy, true, 'confirmed delete stays pending while add is unresolved');
  assert.strictEqual(addDeleteFailure.deletes.length, 0, 'temporary ids are never sent to deleteTxn');
  assert.strictEqual(addDeleteFailureDom.getElementById('d-ok').disabled, true);
  addDeleteFailure.adds[0].failure(new Error('add failed'));
  assert.strictEqual(addDeleteFailure.delBusy, false, 'add failure releases the global delete guard');
  assert.strictEqual(addDeleteFailure.ROW_DELETE_INTENTS[failedPendingKey], undefined,
    'add failure removes the stranded delete intent');
  assert.strictEqual(addDeleteFailureDom.getElementById('d-ok').disabled, false,
    'add failure re-enables the delete confirmation button');
  assert.strictEqual(addDeleteFailure.pendingDelId, null);
  assert.strictEqual(addDeleteFailure.pendingDelRowKey, null);

  // Enter/Escape belong to the IME while composition is active. keyCode 229 is the fallback
  // used by browsers that do not expose KeyboardEvent.isComposing reliably.
  [
    { key: 'Enter', isComposing: true },
    { key: 'Escape', keyCode: 229 }
  ].forEach(function (event) {
    let prevented = 0, blurred = 0;
    const input = { value: '組字中', defaultValue: '原值', blur: function () { blurred++; } };
    event.preventDefault = function () { prevented++; };
    trailing.handleTextKeydown(event, input, base[0].id, 'merchant');
    assert.strictEqual(prevented, 0, event.key + ': IME keydown is not intercepted');
    assert.strictEqual(blurred, 0, event.key + ': IME keydown does not blur the editor');
    assert.strictEqual(input.value, '組字中', event.key + ': IME keydown does not reset the draft');
  });
  let normalPrevented = 0, normalBlurred = 0;
  trailing.captureDraft(base[0].id, 'merchant', 'edited');
  const normalInput = { value: 'edited', defaultValue: base[0].merchant, blur: function () { normalBlurred++; } };
  trailing.handleTextKeydown({ key: 'Escape', preventDefault: function () { normalPrevented++; } }, normalInput,
    base[0].id, 'merchant');
  assert.strictEqual(normalPrevented, 1, 'ordinary Escape is still handled');
  assert.strictEqual(normalBlurred, 1, 'ordinary Escape still blurs');
  assert.strictEqual(normalInput.value, base[0].merchant, 'ordinary Escape restores the committed value');

  // Escape cancels the logical draft, not just the visible node. The synthetic change/blur that
  // follows browser blur must therefore have nothing left to save.
  ['merchant'].forEach(function (field) {
    const original = base[0][field];
    const dom = duplicateTextDom(base[0].id, field, original);
    const h = harness(base, { document: dom });
    h.captureDraft(base[0].id, field, '  不要儲存  ');
    const input = dom.nodes[0]; input.blur = function () {};
    h.handleTextKeydown({ key: 'Escape', preventDefault: function () {} }, input, base[0].id, field);
    if (!h.consumeTextCancel(base[0].id, field)) h.applyEdit(base[0].id, field, input.value);
    if (!h.consumeTextCancel(base[0].id, field)) h.saveTextDraft(base[0].id, field);
    assert.strictEqual(h.textDraft(base[0].id, field), null, field + ': Escape deletes the dirty draft');
    assert.strictEqual(h.calls.length, 0, field + ': following change/blur does not save the cancelled value');
    assert.ok(dom.nodes.every(function (node) { return node.value === original; }),
      field + ': every mounted copy returns to the committed value');
  });

  const activeCancelDom = duplicateTextDom(base[0].id, 'merchant', base[0].merchant);
  const activeCancel = harness(base, { document: activeCancelDom });
  activeCancel.captureDraft(base[0].id, 'merchant', '先送出的值');
  activeCancel.saveTextDraft(base[0].id, 'merchant');
  const activeInput = activeCancelDom.nodes[0]; activeInput.blur = function () {};
  activeCancel.handleTextKeydown({ key: 'Escape', preventDefault: function () {} }, activeInput,
    base[0].id, 'merchant');
  const firstAck = serverCopy(base); firstAck[0].merchant = '先送出的值';
  activeCancel.calls[0].success({ ok: true, txns: firstAck });
  assert.strictEqual(activeCancel.calls.length, 2,
    'Escape queues a compensating restore when the dirty value is already in flight');
  assert.strictEqual(activeCancel.calls[1].patch.merchant, base[0].merchant,
    'the compensating write restores the pre-draft committed value');

  // The amount corrector (data-ef="amount") shares the Escape handler, but only merchant has
  // mounted copies to keep in step. Escape on the amount must restore the committed amount into
  // the focused input alone: textInputMatches queries nothing, so a merchant copy of the same row
  // is never overwritten with the amount.
  const amountQueries = [];
  const merchantCopy = { value: base[0].merchant, defaultValue: base[0].merchant };
  const amountDom = {
    activeElement: null,
    getElementById: function () { return null; },
    querySelector: function (sel) { amountQueries.push(sel); return null; },
    querySelectorAll: function (sel) { amountQueries.push(sel); return [merchantCopy]; }
  };
  const amountEsc = harness(base, { document: amountDom });
  assert.deepStrictEqual(Array.from(amountEsc.textInputMatches(base[0].id, 'amount')), [],
    'textInputMatches returns no copies for the amount field');
  assert.strictEqual(amountQueries.length, 0, 'textInputMatches queries nothing for the amount field');
  amountEsc.captureDraft(base[0].id, 'amount', '999');
  let amountPrevented = 0, amountBlurred = 0;
  const amountInput = { value: '999', defaultValue: String(base[0].amount),
    blur: function () { amountBlurred++; } };
  amountEsc.handleTextKeydown({ key: 'Escape', preventDefault: function () { amountPrevented++; } },
    amountInput, base[0].id, 'amount');
  assert.strictEqual(amountInput.value, String(base[0].amount), 'amount Escape restores the committed amount');
  assert.strictEqual(amountPrevented, 1, 'amount Escape is handled');
  assert.strictEqual(amountBlurred, 1, 'amount Escape blurs the corrector');
  assert.strictEqual(amountEsc.textDraft(base[0].id, 'amount'), null, 'amount Escape drops the dirty draft');
  assert.strictEqual(amountQueries.length, 0, 'amount Escape makes no DOM query for copies');
  assert.strictEqual(merchantCopy.value, base[0].merchant, 'amount Escape leaves a merchant copy untouched');
  assert.strictEqual(merchantCopy.defaultValue, base[0].merchant,
    'amount Escape leaves a merchant copy default untouched');

  // ---- an old save acknowledgement cannot clear characters typed while it was in flight ----
  ['merchant'].forEach(function (field) {
    const h = harness(base);
    h.captureDraft(base[0].id, field, '第一版');
    h.saveTextDraft(base[0].id, field);
    h.captureDraft(base[0].id, field, '第二版');
    const ack = serverCopy(base); ack[0][field] = '第一版';
    h.calls[0].success({ ok: true, txns: ack });
    assert.strictEqual(h.textDraft(base[0].id, field).value, '第二版',
      field + ': an older acknowledgement leaves the newer draft dirty');
    assert.strictEqual(h.draftValue(base[0], field), '第二版',
      field + ': the newer draft overlays the adopted server value');
  });

  const supersededFailure = harness(base);
  supersededFailure.captureDraft(base[0].id, 'merchant', '第一版');
  supersededFailure.saveTextDraft(base[0].id, 'merchant');
  supersededFailure.captureDraft(base[0].id, 'merchant', '第二版');
  supersededFailure.calls[0].failure(new Error('old request failed'));
  assert.strictEqual(supersededFailure.TXNS[0].merchant, '第一版',
    'a superseded failure does not roll back the newer edit lifecycle');
  assert.strictEqual(supersededFailure.draftValue(base[0], 'merchant'), '第二版',
    'a superseded failure leaves newer typing visible');
  assert.strictEqual(supersededFailure.toasts.length, 1,
    'typing alone does not hide a current request failure; only a newer request supersedes it');

  // ---- field writes are serial and intermediate pending revisions are coalesced ----
  const serial = harness(base);
  serial.captureDraft(base[0].id, 'merchant', ' 第一版 ');
  serial.saveTextDraft(base[0].id, 'merchant');
  serial.captureDraft(base[0].id, 'merchant', ' 第二版 ');
  serial.saveTextDraft(base[0].id, 'merchant');
  serial.captureDraft(base[0].id, 'merchant', ' 最終版 ');
  serial.saveTextDraft(base[0].id, 'merchant');
  assert.strictEqual(serial.calls.length, 1, 'only one Apps Script field write is active at a time');
  assert.strictEqual(serial.calls[0].patch.merchant, '第一版', 'field commits preserve trimming semantics');
  const firstSaved = serverCopy(base); firstSaved[0].merchant = '第一版';
  serial.calls[0].success({ ok: true, txns: firstSaved });
  assert.strictEqual(serial.calls.length, 2, 'the queue drains after the active write completes');
  assert.strictEqual(serial.calls[1].patch.merchant, '最終版', 'intermediate revisions coalesce to the newest value');
  assert.ok(!serial.calls.some(function (call) { return call.patch.merchant === '第二版'; }),
    'the superseded middle revision is never sent');

  // ---- draft revisions and request tokens never repeat after delete/recreate (ABA) ----
  const aba = harness(base);
  const firstDraft = aba.captureDraft(base[0].id, 'merchant', '相同文字');
  const key = aba.draftKey(base[0].id, 'merchant');
  aba.saveTextDraft(base[0].id, 'merchant');                 // request token 1
  aba.commitRow(base[0].id, true);                           // waits behind token 1
  assert.strictEqual(aba.calls.length, 1, 'Record does not race an active field write');
  const committed = serverCopy(base);
  committed[0].merchant = '相同文字'; committed[0].posted = true;
  aba.calls[0].success({ ok: true, txns: committed });        // drains the field queue
  assert.strictEqual(aba.calls.length, 2, 'Record is issued only after the older field write settles');
  aba.calls[1].success({ ok: true, txns: committed });        // deletes the exact committed draft
  assert.strictEqual(aba.textDraft(base[0].id, 'merchant'), null, 'Record success clears its exact draft');
  const recreatedDraft = aba.captureDraft(base[0].id, 'merchant', '相同文字');
  assert.ok(recreatedDraft.revision > firstDraft.revision,
    'recreating the same value receives a newer logical revision');
  aba.saveTextDraft(base[0].id, 'merchant');                 // token 3 for the recreated draft
  assert.ok(aba.TEXT_REQUEST_TOKENS[key] > 2,
    'request tokens remain monotonic independently of draft lifetime');
  assert.strictEqual(aba.textDraft(base[0].id, 'merchant').revision, recreatedDraft.revision,
    'an ABA-recreated same-value draft retains its new identity');

  // ---- immediate Record includes the dirty merchant draft in its one authoritative patch ----
  const record = harness(base);
  record.captureDraft(base[0].id, 'merchant', '買晚餐餐廳');
  record.commitRow(base[0].id, true);
  assert.strictEqual(record.calls.length, 1, 'Record issues one request');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(record.calls[0].patch)), {
    posted: true, merchant: '買晚餐餐廳'
  }, 'Record combines posted and merchant in one patch');
  assert.strictEqual(record.TXNS[0].merchant, '買晚餐餐廳', 'Record applies merchant optimistically');

  const trimmedRecord = harness(base);
  trimmedRecord.captureDraft(base[0].id, 'merchant', '  晚餐  ');
  trimmedRecord.commitRow(base[0].id, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(trimmedRecord.calls[0].patch)), {
    posted: true, merchant: '晚餐'
  }, 'Record trims merchant only when building the committed patch');

  // Text typed after Record has gone out is a newer revision, not part of that patch. It waits
  // behind the row commit, then drains immediately against the row that remains in the model.
  const editDuringRecord = harness(base);
  editDuringRecord.captureDraft(base[0].id, 'merchant', 'Record 版本');
  editDuringRecord.commitRow(base[0].id, true);
  editDuringRecord.captureDraft(base[0].id, 'merchant', '稍後版本');
  editDuringRecord.saveTextDraft(base[0].id, 'merchant');
  assert.strictEqual(editDuringRecord.calls.length, 1, 'a newer revision waits behind Record');
  const recordAck = serverCopy(base);
  recordAck[0].merchant = 'Record 版本'; recordAck[0].posted = true;
  editDuringRecord.calls[0].success({ ok: true, txns: recordAck });
  assert.strictEqual(editDuringRecord.calls.length, 2, 'Record success drains the newer revision');
  assert.strictEqual(editDuringRecord.calls[1].patch.merchant, '稍後版本',
    'the drained write contains the text typed while Record was in flight');

  const editDuringFailedRecord = harness(base);
  editDuringFailedRecord.captureDraft(base[0].id, 'merchant', 'Record 說明');
  editDuringFailedRecord.commitRow(base[0].id, true);
  editDuringFailedRecord.captureDraft(base[0].id, 'merchant', '稍後說明');
  editDuringFailedRecord.saveTextDraft(base[0].id, 'merchant');
  editDuringFailedRecord.calls[0].failure(new Error('record failed'));
  assert.strictEqual(editDuringFailedRecord.calls.length, 2, 'Record failure also drains the newer revision');
  assert.strictEqual(editDuringFailedRecord.calls[1].patch.merchant, '稍後說明',
    'a failed Record cannot strand text entered while it was in flight');

  // Escape during Record likewise survives as a compensating write. Without this drain, the
  // Record response would leave the value the owner explicitly cancelled on the sheet.
  const cancelDuringRecord = harness(base);
  cancelDuringRecord.captureDraft(base[0].id, 'merchant', '不要保留');
  cancelDuringRecord.commitRow(base[0].id, true);
  cancelDuringRecord.cancelTextDraft(base[0].id, 'merchant');
  const cancelRecordAck = serverCopy(base);
  cancelRecordAck[0].merchant = '不要保留'; cancelRecordAck[0].posted = true;
  cancelDuringRecord.calls[0].success({ ok: true, txns: cancelRecordAck });
  assert.strictEqual(cancelDuringRecord.calls.length, 2, 'Record success drains the queued cancellation');
  assert.strictEqual(cancelDuringRecord.calls[1].patch.merchant, base[0].merchant,
    'the compensation restores the value from before the cancelled draft');

  // A different response may change the composite id while Record is in flight. The intent and
  // draft are keyed by the stable client row, so the late callback still clears the right state.
  const rekeyDuringRecord = harness(base);
  const recordLogical = rekeyDuringRecord.textRowKey(base[0].id);
  rekeyDuringRecord.captureDraft(recordLogical, 'merchant', '一起記帳');
  rekeyDuringRecord.commitRow(recordLogical, true);
  const recordRekeyed = serverCopy(base);
  recordRekeyed[0].amount = 999; recordRekeyed[0].id = REKEYED_ID;
  rekeyDuringRecord.adoptTxns(recordRekeyed);
  const recordResponse = serverCopy(recordRekeyed);
  recordResponse[0].merchant = '一起記帳'; recordResponse[0].posted = true;
  rekeyDuringRecord.calls[0].success({ ok: true, txns: recordResponse });
  assert.strictEqual(rekeyDuringRecord.ROW_COMMIT_INTENTS[recordLogical], undefined,
    'a Record callback clears its intent after an in-flight id change');
  assert.strictEqual(rekeyDuringRecord.textDraft(recordLogical, 'merchant'), null,
    'the exact committed draft is cleared through the stable row key');
  rekeyDuringRecord.captureDraft(recordLogical, 'merchant', '下一次');
  rekeyDuringRecord.commitRow(recordLogical, false);
  assert.strictEqual(rekeyDuringRecord.calls.length, 2, 'the row is not permanently blocked after rekeyed Record');
  assert.strictEqual(rekeyDuringRecord.calls[1].id, REKEYED_ID, 'the next Record uses the current server id');

  // ---- actual duplicate DOM copies share drafts and acknowledged values ----
  ['merchant'].forEach(function (field) {
    const dom = duplicateTextDom(base[0].id, field, base[0][field]);
    const h = harness(base, { document: dom });
    dom.nodes[0].value = '  同步新值  ';
    h.captureDraft(base[0].id, field, dom.nodes[0].value);
    assert.strictEqual(dom.nodes[1].value, '  同步新值  ', field + ': input mirrors into the other mounted copy');
    h.applyEdit(base[0].id, field, dom.nodes[1].value);       // stale copy commits its mirrored value
    assert.strictEqual(h.calls[0].patch[field], '同步新值', field + ': stale copy cannot overwrite the new value');
    const ack = serverCopy(base); ack[0][field] = '同步新值';
    h.calls[0].success({ ok: true, txns: ack });
    assert.ok(dom.nodes.every(function (node) {
      return node.value === '同步新值' && node.defaultValue === '同步新值';
    }), field + ': save acknowledgement updates value and defaultValue on every mounted copy');
  });

  // Blur/change can issue a text save immediately before the Record click. The combined Record
  // request supersedes it, so a late failure from that older save cannot revert or toast.
  const blurThenRecord = harness(base);
  blurThenRecord.captureDraft(base[0].id, 'merchant', '買晚餐餐廳');
  blurThenRecord.saveTextDraft(base[0].id, 'merchant');
  blurThenRecord.commitRow(base[0].id, true);
  assert.strictEqual(blurThenRecord.calls.length, 1,
    'combined Record waits instead of racing the earlier blur save');
  blurThenRecord.calls[0].failure(new Error('older blur failure'));
  assert.strictEqual(blurThenRecord.calls.length, 2,
    'combined Record drains after the older blur save settles');
  const combined = serverCopy(base);
  combined[0].merchant = '買晚餐餐廳'; combined[0].posted = true;
  blurThenRecord.calls[1].success({ ok: true, txns: combined });
  assert.strictEqual(blurThenRecord.TXNS[0].merchant, '買晚餐餐廳',
    'older blur failure cannot revert the combined Record value');
  assert.deepStrictEqual(blurThenRecord.toasts.map(function (t) { return t.msg; }),
    ['已記帳 · 從清單移除'], 'superseded blur failure cannot add a stale error toast');

  // A failed save reverts only the optimistic server-backed value. The draft remains the value
  // every rebuilt editor shows, so the owner can retry without retyping it.
  const failedDraft = harness(base);
  failedDraft.captureDraft(base[0].id, 'merchant', '買晚餐餐廳');
  failedDraft.saveTextDraft(base[0].id, 'merchant');
  failedDraft.calls[0].failure(new Error('offline'));
  assert.strictEqual(failedDraft.TXNS[0].merchant, base[0].merchant, 'failure reverts the optimistic model');
  assert.strictEqual(failedDraft.draftValue(base[0], 'merchant'), '買晚餐餐廳',
    'failure keeps the typed draft available for retry');
  assert.ok(failedDraft.toasts[failedDraft.toasts.length - 1].err, 'failure remains visible');
  const callsAfterFailure = failedDraft.calls.length;
  failedDraft.saveTextDraft(base[0].id, 'merchant');
  assert.strictEqual(failedDraft.calls.length, callsAfterFailure + 1,
    'blurring unchanged failed text retries without requiring another input event');
  assert.strictEqual(failedDraft.calls[1].patch.merchant, '買晚餐餐廳',
    'the retry resends the preserved dirty draft');

  // Binding coverage: the production attach() wires both editable field kinds to the same input
  // and composition lifecycle and routes Record through the combined commit helper.
  assert.ok(/oncompositionstart[\s\S]*beginComposition/.test(attachSrc), 'attach binds compositionstart');
  assert.ok(/oncompositionend[\s\S]*endComposition/.test(attachSrc), 'attach binds compositionend');
  assert.ok(/oninput[\s\S]*captureDraft/.test(attachSrc), 'attach captures live input');
  assert.strictEqual((attachSrc.match(/handleTextKeydown\(e,this,/g) || []).length, 2,
    'merchant and the amount corrector keydown both use the IME-aware handler');
  assert.ok(/data-emer[\s\S]*onblur=function\(\)\{[^}]*saveTextDraft\(id,'merchant'\); \}/.test(attachSrc),
    'merchant blur retries a preserved dirty draft');
  assert.ok(/commitRow\(id,!t\.posted\)/.test(attachSrc), 'Record uses the combined row commit');

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
    function (h) { h.pendingDelId = base[1].id; h.pendingDelRowKey = h.textRowKey(base[1].id); h.confirmDelete(); },
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
  del.pendingDelRowKey = del.textRowKey(base[1].id);
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
  assert.ok(/\.updateTxn\(\s*serverId,\s*\{\s*mine:\s*\(v==null\?'':v\)\s*\}\s*\)/.test(split), 'applySplit still calls updateTxn with two arguments');
  assert.ok(!/getAllTxns/.test(split), 'applySplit does not fetch the full list');
  assert.ok(/revertTxn\(\s*current\.id,\s*\{\s*mine:prevMine,\s*amount:prevAmt\s*\}\s*\)/.test(split), 'applySplit reverts by re-resolving its row');
  const bulk = extractFunction(script, 'bulkPost');
  assert.ok(/\.updateTxn\(\s*serverId,\s*\{\s*posted:true\s*\}\s*\)/.test(bulk), 'bulkPost still calls updateTxn with two arguments');
  assert.ok(!/getAllTxns/.test(bulk), 'a ten-row bulk post does not pull ten copies of the table');
  const edit = extractFunction(script, 'applyEdit');
  assert.ok(!/getAllTxns/.test(edit), 'the edit path no longer refetches after a successful write');

  // ---- the server half: opt-in list, flushed before it is read ----
  const server = fs.readFileSync(path.resolve(__dirname, '..', 'sidebar', '程式碼.js'), 'utf8');
  assert.ok(/function updateTxn\(messageId, patch, wantTxns\)/.test(server), 'the fresh list is an opt-in third parameter');
  assert.ok(/if \(wantTxns\) \{\s*SpreadsheetApp\.flush\(\);\s*if \(wantTxns === 'recent'\) return recentAck_\(sh, messageId, new Date\(\)\);\s*return \{ ok: true, txns: getAllTxns\(\) \};/.test(server),
    'pending writes are flushed before the list is read, or the page would adopt a pre-write snapshot');
  assert.ok(/\}\s*return \{ ok: true \};\s*\}/.test(server), 'the default return shape is unchanged for the two-argument call sites');
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_paid_tick_repaint');
} else {
  module.exports = { run };
}
