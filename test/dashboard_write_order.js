'use strict';
/*
 * Writes leave through ONE page-wide queue, in sequence order, one call at a time (#92), and every
 * patch queued behind a call that is out leaves with the next updateTxns call (#98).
 *
 * With one queue per row, two rows' writes were in flight together and raced for the server's
 * script lock: when the later row won, its snapshot still showed the earlier row unposted, the
 * page adopted it, and a row ticked 已記帳 came back as pending. Write responses now carry no
 * list at all; the page reads the list once (getRecentTxns) after the queue drains, and drops a
 * read that a later mutation superseded. These cases drive the real ToolPanel.html functions
 * against a recording google.script.run, so the test decides when each response lands and can
 * assert that the next call does not exist until the previous call's handler has run.
 *
 * Every case checks the on-screen `posted` value after EACH delivered response, not only the
 * final state.
 *
 * NOT evidence that the symptom is gone on the phone: that needs the deployed dashboard.
 */
const assert = require('assert');
const { loadFns } = require('./extract_panel');

function row(id, merchant, overrides) {
  return Object.assign({
    id: id, rowId: '', y: 2026, m: 8, d: 12, hm: '09:00', type: '支出',
    amount: 120, charged: 120, mine: null, cat: '飲食', merchant: merchant,
    bank: '富邦', last4: '1234', link: '', posted: false
  }, overrides || {});
}
const A = row('msg-a|1000|120|1234|0', '星巴克');
const B = row('msg-b|2000|350|5678|0', '全聯', { amount: 350, charged: 350, last4: '5678' });
const C = row('msg-c|3000|60|9999|0', '7-11', { amount: 60, charged: 60, last4: '9999' });
const X = row('msg-x|4000|80|4444|0', '麥當勞', { amount: 80, charged: 80, last4: '4444' });

function serverCopy(list) { return list.map(function (t) { return Object.assign({}, t); }); }

/** The sheet as the server would return it: `base` with per-id field overrides. */
function sheet(base, changes) {
  return serverCopy(base).map(function (t) { return Object.assign(t, (changes || {})[t.id] || {}); });
}

function recordingRun(rec) {
  let pending = {};
  function take() { const p = pending; pending = {}; return p; }
  const run = {
    withSuccessHandler: function (f) { pending.success = f; return run; },
    withFailureHandler: function (f) { pending.failure = f; return run; },
    updateTxns: function (items) {
      const p = take();
      rec.calls.push({ items: items, ids: Array.from(items, function (i) { return i.id; }), success: p.success, failure: p.failure });
    },
    deleteTxn: function (arg) { const p = take(); rec.deletes.push({ arg: arg, success: p.success, failure: p.failure }); },
    addTxn: function (fields) { const p = take(); rec.adds.push({ fields: fields, success: p.success, failure: p.failure }); },
    getRecentTxns: function (fp) { const p = take(); rec.reads.push({ fp: fp, success: p.success, failure: p.failure }); }
  };
  return run;
}

function fakeNode(value) {
  return {
    value: value === undefined ? '' : value, disabled: false, hidden: false,
    innerHTML: '', textContent: '', classList: { add: function () {}, remove: function () {} }
  };
}
function domStub(fields) {
  const nodes = {};
  return {
    activeElement: null,
    getElementById: function (id) { if (!nodes[id]) nodes[id] = fakeNode((fields || {})[id]); return nodes[id]; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
}
const ADD_FORM = {
  'a-date': '2026-08-12', 'a-amt': '80', 'a-time': '', 'a-type': '支出',
  'a-source': '現金', 'a-mer': '午餐', 'a-cat': '飲食'
};

const PANEL_FNS = ['txnsSignature', 'adoptTxns', 'ackTxns', 'spliceAt', 'historyComplete', 'txnById', 'nextMutation', 'isStale', 'settle',
  'refreshTxns', 'focusKey', 'focusMatches', 'focusIndex', 'repaint', 'revertTxn', 'applyEdit',
  'ensureTextRowKey', 'textTxn', 'textRowKey', 'resolveTextRowId', 'rawDraftKey', 'draftKey',
  'textRowLineage', 'dropTextRowState', 'reconcileTextRowIds', 'preservePendingAddRows',
  'beginRowWrite', 'endRowWrite', 'enqueueRowWrite', 'enqueueRowWrites', 'rowWriteBlocked', 'pumpRowWrites',
  'finishRowWrite', 'sendRowDelete', 'sendRowPatches', 'maybeRefresh', 'resumeRowWrites', 'cancelRowWrites',
  'textDraft', 'draftValue', 'captureDraft', 'hasActiveComposition',
  'textWriteQueue', 'textInputMatches', 'syncTextCopies', 'nextTextRequestToken',
  'beginComposition', 'endComposition', 'cancelTextDraft', 'consumeTextCancel',
  'isImeKeyEvent', 'handleTextKeydown', 'normalizedTextValue', 'issueTextSave', 'drainTextWrite',
  'saveTextDraft', 'trySendRowCommit', 'commitRow', 'applySplit', 'bulkPost',
  'submitAdd', 'openDelModal', 'confirmDelete', 'cancelDeleteIntent', 'trySendDelete', 'closeDelModal', 'closeAddModal',
  'chargedOf', 'isSplitTxn', 'fmt'];

function harness(initial) {
  const rec = { calls: [], deletes: [], adds: [], reads: [] };
  const toasts = [];
  const fns = loadFns(PANEL_FNS, {
    TXNS: serverCopy(initial),
    MUTATION_SEQ: 0, INFLIGHT: 0, STALE_DROPPED: false, REFRESHING: false, OLDER_FP: null,
    HISTORY: { complete: true, before: null, loadedFp: null, loading: false, failed: null },
    TEXT_DRAFTS: {}, TEXT_DRAFT_REVISIONS: {}, TEXT_REQUEST_TOKENS: {}, TEXT_WRITE_QUEUES: {},
    TEXT_CANCEL_BLURS: {}, ROW_COMMIT_INTENTS: {}, ACTIVE_COMPOSITIONS: {}, PENDING_REPAINT: false,
    COMPOSITION_FLUSH_SCHEDULED: false, TEXT_ROW_SERIAL: 0, TEXT_REMOVED_ROW_KEYS: {},
    PENDING_ADD_ROWS: {}, ROW_ACTIVE_WRITES: {}, ROW_DELETE_INTENTS: {},
    ROW_WRITE_QUEUE: { active: null, items: [] },
    pendingDelId: null, pendingDelRowKey: null, openSplit: null, addHeatDate: null,
    state: {}, openHeatDay: null, NOW: { year: 2026, month: 8, day: 12 },
    google: { script: { run: recordingRun(rec) } },
    render: function () {},
    toast: function (msg, isErr) { toasts.push({ msg: msg, err: !!isErr }); },
    setTimeout: function () { return 0; },
    document: domStub(ADD_FORM),
    window: { pageXOffset: 0, pageYOffset: 0, scrollTo: function () {} }
  });
  fns.calls = rec.calls; fns.deletes = rec.deletes; fns.adds = rec.adds; fns.reads = rec.reads;
  fns.toasts = toasts;
  fns.find = function (id) {
    for (let i = 0; i < fns.TXNS.length; i++) if (fns.TXNS[i].id === id) return fns.TXNS[i];
    return null;
  };
  fns.posted = function (id) { const t = fns.find(id); return t ? t.posted : undefined; };
  return fns;
}

/** Every item of an updateTxns call succeeds (the server's answer shape). */
function okAll(call) {
  call.success({ ok: true, results: call.items.map(function (i) { return { id: i.id, ok: true }; }) });
}
/** getRecentTxns' answer: a whole list, as the JSON string the server returns. */
function readOk(read, list) { read.success(JSON.stringify({ ok: true, txns: list, olderFp: 'fp' })); }

/** Assert every listed row shows `posted === true` right now. */
function allPosted(h, ids, when) {
  ids.forEach(function (id) {
    assert.strictEqual(h.posted(id), true, when + ': ' + id + ' is posted on screen');
  });
}
function quiet(h, name) {
  assert.strictEqual(h.INFLIGHT, 0, name + ': INFLIGHT returns to 0');
  assert.strictEqual(h.ROW_WRITE_QUEUE.active, null, name + ': no write is left active');
  assert.strictEqual(h.ROW_WRITE_QUEUE.items.length, 0, name + ': no write is left queued');
}

function run() {
  const base = [A, B, C, X];

  // ---- 1. two ticks in quick succession: B's call waits for A's handler, then one read ----
  {
    const h = harness(base);
    h.commitRow(A.id, true);
    h.commitRow(B.id, true);
    allPosted(h, [A.id, B.id], 'AC1 after both taps');
    assert.strictEqual(h.calls.length, 1, 'AC1: only A\'s write is sent while A is in flight');
    assert.deepStrictEqual(h.calls[0].ids, [A.id], 'AC1: A\'s write goes first');
    okAll(h.calls[0]);
    allPosted(h, [A.id, B.id], 'AC1 after A\'s ack');
    assert.strictEqual(h.calls.length, 2, 'AC1: B\'s write is sent from A\'s handler');
    assert.deepStrictEqual(h.calls[1].ids, [B.id], 'AC1: and it is B\'s');
    assert.strictEqual(h.reads.length, 0, 'AC1: no read while B is out');
    okAll(h.calls[1]);
    allPosted(h, [A.id, B.id], 'AC1 after B\'s ack');
    assert.strictEqual(h.reads.length, 1, 'AC1: one read once the queue has drained');
    readOk(h.reads[0], sheet(base, { [A.id]: { posted: true }, [B.id]: { posted: true } }));
    allPosted(h, [A.id, B.id], 'AC1 after the read');
    assert.strictEqual(h.STALE_DROPPED, false, 'AC1: no debt is left');
    quiet(h, 'AC1');
  }

  // ---- 2. applyEdit ticks: no write ack carries a list, so none can un-post the other row ----
  {
    const h = harness(base);
    h.applyEdit(A.id, 'posted', true);
    h.applyEdit(B.id, 'posted', true);
    assert.strictEqual(h.calls.length, 1, 'AC2: B is not sent while A is in flight');
    okAll(h.calls[0]);
    allPosted(h, [A.id, B.id], 'AC2 after A\'s ack');
    assert.strictEqual(h.reads.length, 0, 'AC2: no read while B is still out');
    okAll(h.calls[1]);
    allPosted(h, [A.id, B.id], 'AC2 after B\'s ack');
    assert.strictEqual(h.reads.length, 1, 'AC2: one read after the drain');
    readOk(h.reads[0], sheet(base, { [A.id]: { posted: true }, [B.id]: { posted: true } }));
    allPosted(h, [A.id, B.id], 'AC2 after the read');
    quiet(h, 'AC2');
  }

  // ---- 3. A's call fails: A reverts, B still goes out ----
  {
    const h = harness(base);
    h.commitRow(A.id, true);
    h.commitRow(B.id, true);
    assert.strictEqual(h.calls.length, 1, 'AC3: B\'s call does not exist before A\'s handler runs');
    h.calls[0].failure(new Error('boom'));
    assert.strictEqual(h.posted(A.id), false, 'AC3: a failed A reverts');
    assert.strictEqual(h.posted(B.id), true, 'AC3: B stays posted after A fails');
    assert.ok(h.toasts[h.toasts.length - 1].err, 'AC3: the failure is reported');
    assert.strictEqual(h.calls.length, 2, 'AC3: B still goes out after A fails');
    okAll(h.calls[1]);
    assert.strictEqual(h.posted(A.id), false, 'AC3: A matches the sheet');
    assert.strictEqual(h.posted(B.id), true, 'AC3: B matches the sheet');
    readOk(h.reads[0], sheet(base, { [B.id]: { posted: true } }));
    assert.strictEqual(h.posted(A.id), false, 'AC3: A converged');
    assert.strictEqual(h.posted(B.id), true, 'AC3: B converged');
    assert.strictEqual(h.reads.length, 1, 'AC3: one read');
    quiet(h, 'AC3');
  }

  // ---- 4. category, merchant and split edits on B while A's tick is in flight: one merged item ----
  {
    const h = harness(base);
    h.commitRow(A.id, true);
    h.applyEdit(B.id, 'cat', '交通');
    h.applyEdit(B.id, 'merchant', '全聯福利中心');
    h.applySplit(B.id, '200');
    assert.strictEqual(h.calls.length, 1, 'AC4: B\'s edits wait behind A\'s tick');
    okAll(h.calls[0]);
    assert.strictEqual(h.posted(A.id), true, 'AC4: A never shows pending after its own ack');
    assert.strictEqual(h.find(B.id).cat, '交通', 'AC4: B\'s queued edit is not undone by A\'s ack');
    assert.strictEqual(h.calls.length, 2, 'AC4: B\'s edits go out together after A\'s handler');
    assert.deepStrictEqual(h.calls[1].ids, [B.id], 'AC4: as one item for B');
    assert.deepStrictEqual(Object.keys(h.calls[1].items[0].patch).sort(), ['cat', 'merchant', 'mine'], 'AC4: the merged patch holds every field');
    okAll(h.calls[1]);
    assert.strictEqual(h.reads.length, 1, 'AC4: one read after the drain');
    readOk(h.reads[0], sheet(base, { [A.id]: { posted: true }, [B.id]: { cat: '交通', merchant: '全聯福利中心', mine: 200, amount: 200 } }));
    assert.strictEqual(h.posted(A.id), true, 'AC4: A converges posted');
    assert.strictEqual(h.find(B.id).cat, '交通', 'AC4: B converges with every edit');
    assert.strictEqual(h.find(B.id).merchant, '全聯福利中心', 'AC4: B converges with every edit');
    quiet(h, 'AC4');
  }

  // ---- 5. a single tick on C during a multi-row bulkPost ----
  {
    const h = harness(base);
    h.bulkPost([A.id, B.id]);
    h.commitRow(C.id, true);
    allPosted(h, [A.id, B.id, C.id], 'AC5 after the taps');
    assert.strictEqual(h.calls.length, 1, 'AC5: the bulk run leaves as one call');
    assert.deepStrictEqual(h.calls[0].ids, [A.id, B.id], 'AC5: holding both bulk rows');
    okAll(h.calls[0]);
    allPosted(h, [A.id, B.id, C.id], 'AC5 after the bulk call');
    assert.strictEqual(h.calls.length, 2, 'AC5: C goes out next');
    assert.deepStrictEqual(h.calls[1].ids, [C.id], 'AC5: the next call is C\'s tick');
    assert.strictEqual(h.reads.length, 0, 'AC5: no read while C is out');
    okAll(h.calls[1]);
    allPosted(h, [A.id, B.id, C.id], 'AC5 after C\'s ack');
    assert.strictEqual(h.reads.length, 1, 'AC5: one read once C settles');
    readOk(h.reads[0], sheet(base, { [A.id]: { posted: true }, [B.id]: { posted: true }, [C.id]: { posted: true } }));
    allPosted(h, [A.id, B.id, C.id], 'AC5 after the read');
    assert.strictEqual(h.reads.length, 1, 'AC5: and only one');
    quiet(h, 'AC5');
  }

  // ---- 6a. a delete on X confirmed while another row's write is in flight ----
  {
    const h = harness(base);
    h.commitRow(A.id, true);
    h.openDelModal(X.id); h.confirmDelete();
    assert.strictEqual(h.deletes.length, 0, 'AC6a: the delete waits behind A\'s write');
    okAll(h.calls[0]);
    assert.strictEqual(h.posted(A.id), true, 'AC6a: A stays posted');
    assert.strictEqual(h.deletes.length, 1, 'AC6a: the delete goes out after A was acknowledged');
    assert.strictEqual(h.reads.length, 0, 'AC6a: no read while the delete is out');
    h.deletes[0].success({ ok: true });
    assert.strictEqual(h.posted(A.id), true, 'AC6a: the delete never un-posts A');
    assert.strictEqual(h.find(X.id), null, 'AC6a: X is gone');
    assert.strictEqual(h.reads.length, 1, 'AC6a: one read after the drain');
    readOk(h.reads[0], sheet([A, B, C], { [A.id]: { posted: true } }));
    assert.strictEqual(h.posted(A.id), true, 'AC6a: A converges posted');
    assert.strictEqual(h.find(X.id), null, 'AC6a: X stays gone');
    quiet(h, 'AC6a');
  }

  // ---- 6b. a delete on X while X's own write is queued behind another row ----
  {
    const h = harness(base);
    h.commitRow(A.id, true);
    h.applyEdit(X.id, 'cat', '交通');
    h.openDelModal(X.id); h.confirmDelete();
    assert.strictEqual(h.calls.length, 1, 'AC6b: X\'s write is queued, not sent');
    assert.strictEqual(h.deletes.length, 0, 'AC6b: the delete is queued too');
    okAll(h.calls[0]);
    assert.strictEqual(h.posted(A.id), true, 'AC6b: A stays posted after its ack');
    assert.strictEqual(h.calls.length, 2, 'AC6b: X\'s write goes next');
    assert.deepStrictEqual(h.calls[1].ids, [X.id], 'AC6b: alone: the delete is a barrier');
    assert.strictEqual(h.deletes.length, 0, 'AC6b: the delete still follows X\'s write');
    okAll(h.calls[1]);
    assert.strictEqual(h.posted(A.id), true, 'AC6b: A stays posted after X\'s ack');
    assert.strictEqual(h.deletes.length, 1, 'AC6b: the delete is sent after X\'s own write');
    h.deletes[0].success({ ok: true });
    assert.strictEqual(h.find(X.id), null, 'AC6b: X is gone');
    readOk(h.reads[0], sheet([A, B, C], { [A.id]: { posted: true } }));
    assert.strictEqual(h.posted(A.id), true, 'AC6b: the read never un-posts A');
    assert.strictEqual(h.reads.length, 1, 'AC6b: one read');
    quiet(h, 'AC6b');
  }

  // ---- 6c. X's queued write fails: the queued delete is cancelled, not sent ----
  {
    const h = harness(base);
    h.commitRow(A.id, true);
    h.applyEdit(X.id, 'cat', '交通');
    h.openDelModal(X.id); h.confirmDelete();
    okAll(h.calls[0]);
    h.calls[1].success({ ok: true, results: [{ id: X.id, ok: false, error: 'boom' }] });
    assert.strictEqual(h.deletes.length, 0, 'AC6c: a delete whose earlier write failed is never sent');
    assert.strictEqual(h.ROW_DELETE_INTENTS[h.find(X.id)._textKey], undefined, 'AC6c: the row returns to normal');
    assert.strictEqual(h.find(X.id).cat, '飲食', 'AC6c: X\'s failed edit reverts');
    assert.strictEqual(h.posted(A.id), true, 'AC6c: A stays posted');
    assert.strictEqual(h.reads.length, 1, 'AC6c: one read after the drain');
    readOk(h.reads[0], sheet(base, { [A.id]: { posted: true } }));
    assert.strictEqual(h.posted(A.id), true, 'AC6c: converged');
    quiet(h, 'AC6c');
  }

  // ---- 7. a failed add cancels only its own queued writes ----
  {
    const h = harness(base);
    h.submitAdd();
    assert.strictEqual(h.adds.length, 1, 'AC7: the add is sent');
    const temp = h.TXNS[h.TXNS.length - 1];
    assert.ok(temp._pendingAdd, 'AC7: the new row is pending');
    h.applyEdit(temp.id, 'cat', '交通');               // queued at the head, blocked by the add
    h.applyEdit(A.id, 'posted', true);                 // another row's write behind it
    assert.strictEqual(h.calls.length, 0, 'AC7: the head write on the pending row blocks the queue');
    assert.strictEqual(h.posted(A.id), true, 'AC7: A is posted at tap time');
    h.adds[0].failure(new Error('boom'));
    assert.strictEqual(h.calls.length, 1, 'AC7: the other row\'s queued write still goes out');
    assert.deepStrictEqual(h.calls[0].ids, [A.id], 'AC7: and only that one');
    assert.strictEqual(h.posted(A.id), true, 'AC7: A stays posted after the add fails');
    okAll(h.calls[0]);
    readOk(h.reads[0], sheet(base, { [A.id]: { posted: true } }));
    assert.strictEqual(h.posted(A.id), true, 'AC7: A converges posted');
    assert.strictEqual(h.calls.length, 1, 'AC7: the failed add\'s write was never sent');
    quiet(h, 'AC7');
  }

  // ---- 7b. a successful add releases its queued write and the rest, in order, in one call ----
  {
    const h = harness(base);
    h.submitAdd();
    const temp = h.TXNS[h.TXNS.length - 1];
    h.applyEdit(temp.id, 'cat', '交通');
    h.applyEdit(A.id, 'posted', true);
    assert.strictEqual(h.calls.length, 0, 'AC7b: both writes wait for the add');
    h.adds[0].success({ id: 'manual-9', hm: '' });
    assert.strictEqual(h.calls.length, 1, 'AC7b: both writes leave together');
    assert.deepStrictEqual(h.calls[0].ids, ['manual-9', A.id], 'AC7b: the new row first, under its server id');
    okAll(h.calls[0]);
    readOk(h.reads[0], sheet(base, { [A.id]: { posted: true } }).concat([row('manual-9', '午餐', { amount: 80, charged: 80, cat: '交通', posted: true })]));
    assert.strictEqual(h.posted(A.id), true, 'AC7b: A converges posted');
    quiet(h, 'AC7b');
  }

  // ---- 8. three ticks: the two behind the first leave together ----
  {
    const h = harness(base);
    h.commitRow(A.id, true);
    h.commitRow(B.id, true);
    h.commitRow(C.id, true);
    allPosted(h, [A.id, B.id, C.id], 'AC8 after the taps');
    okAll(h.calls[0]);
    allPosted(h, [A.id, B.id, C.id], 'AC8 after A\'s ack');
    assert.strictEqual(h.calls.length, 2, 'AC8: B and C go out in one call');
    assert.deepStrictEqual(h.calls[1].ids, [B.id, C.id], 'AC8: in queue order');
    assert.strictEqual(h.INFLIGHT, 2, 'AC8: both are unacknowledged');
    okAll(h.calls[1]);
    allPosted(h, [A.id, B.id, C.id], 'AC8 after the second ack');
    readOk(h.reads[0], sheet(base, { [A.id]: { posted: true }, [B.id]: { posted: true }, [C.id]: { posted: true } }));
    allPosted(h, [A.id, B.id, C.id], 'AC8 after the read');
    assert.strictEqual(h.STALE_DROPPED, false, 'AC8: no debt is left');
    assert.strictEqual(h.reads.length, 1, 'AC8: one read');
    quiet(h, 'AC8');
  }

  // ---- 9. #92 order (a): a read out when a new tick is issued arrives stale and is dropped ----
  {
    const h = harness(base);
    h.commitRow(A.id, true);
    okAll(h.calls[0]);
    assert.strictEqual(h.reads.length, 1, 'AC9: the read goes out after A');
    h.commitRow(B.id, true);                            // issued while the read is out
    // The read predates B's write: it shows B pending and must not be adopted.
    readOk(h.reads[0], sheet(base, { [A.id]: { posted: true } }));
    allPosted(h, [A.id, B.id], 'AC9 after the stale read');
    assert.strictEqual(h.reads.length, 1, 'AC9: no re-read while B is out');
    okAll(h.calls[1]);
    allPosted(h, [A.id, B.id], 'AC9 after B\'s ack');
    assert.strictEqual(h.reads.length, 2, 'AC9: the debt is re-booked into one read');
    readOk(h.reads[1], sheet(base, { [A.id]: { posted: true }, [B.id]: { posted: true } }));
    allPosted(h, [A.id, B.id], 'AC9 after the read');
    quiet(h, 'AC9');
  }

  // ---- 10. #92 order (b): the later write's ack lands before the superseded read ----
  {
    const h = harness(base);
    h.commitRow(A.id, true);
    okAll(h.calls[0]);
    h.commitRow(B.id, true);
    okAll(h.calls[1]);                                   // B lands first; the old read is still out
    allPosted(h, [A.id, B.id], 'AC10 after B\'s ack');
    assert.strictEqual(h.reads.length, 1, 'AC10: no second read while one is out');
    readOk(h.reads[0], sheet(base, { [A.id]: { posted: true } }));
    allPosted(h, [A.id, B.id], 'AC10 after the stale read');
    assert.strictEqual(h.reads.length, 2, 'AC10: the dropped read is re-issued at once');
    readOk(h.reads[1], sheet(base, { [A.id]: { posted: true }, [B.id]: { posted: true } }));
    allPosted(h, [A.id, B.id], 'AC10 after the fresh read');
    quiet(h, 'AC10');
  }
}

module.exports = { run };
