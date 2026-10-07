'use strict';
/*
 * Confirming a delete answers at once: the modal closes and every rendered copy of the row shows
 * an inert deleting state until deleteTxn settles, including while the delete waits behind a
 * write on the same row.
 *
 * The functions are lifted out of ToolPanel.html by extract_panel and run against a recording
 * google.script.run, so "before any server call returns" is an ordering the test controls: each
 * response lands only when the test calls its handler. render() is the real row markup
 * (editRow + categoryTxn over TXNS), captured per call, so the deleting state is asserted on
 * what would be on screen at that moment rather than on the intent map alone.
 *
 * NOT evidence of the live look: that needs the deployed dashboard.
 */
const assert = require('assert');
const { loadFns } = require('./extract_panel');

function row(overrides) {
  return Object.assign({
    id: 'msg-a|1000|120|1234|0', rowId: 'uuid-a', y: 2026, m: 8, d: 12, hm: '09:00', type: '支出',
    amount: 120, charged: 120, mine: null, cat: '飲食', merchant: '星巴克',
    bank: '富邦', last4: '1234', link: '', posted: false
  }, overrides);
}
function other(overrides) {
  return row(Object.assign({ id: 'msg-b|2000|350|5678|0', rowId: 'uuid-b', merchant: '全聯',
    amount: 350, charged: 350, last4: '5678' }, overrides));
}
function serverCopy(list) { return list.map(function (t) { return Object.assign({}, t); }); }

function recordingRun(rec) {
  let pending = {};
  function take() { const p = pending; pending = {}; return p; }
  const run = {
    withSuccessHandler: function (f) { pending.success = f; return run; },
    withFailureHandler: function (f) { pending.failure = f; return run; },
    updateTxn: function (id, patch, wantTxns) {
      const p = take(); rec.calls.push({ id: id, patch: patch, wantTxns: wantTxns, success: p.success, failure: p.failure });
    },
    deleteTxn: function (arg) { const p = take(); rec.deletes.push({ arg: arg, success: p.success, failure: p.failure }); },
    addTxn: function (fields) { const p = take(); rec.adds.push({ fields: fields, success: p.success, failure: p.failure }); },
    getAllTxns: function () { const p = take(); rec.reads.push({ success: p.success, failure: p.failure }); }
  };
  return run;
}

// Every node records its class toggles, so "the modal was closed" and "the modal was left
// alone" are both observable.
function domStub() {
  const nodes = {};
  function node(id) {
    const n = { id: id, value: '', disabled: false, hidden: false, innerHTML: '', textContent: '', ops: [] };
    n.classList = { add: function (c) { n.ops.push('+' + c); }, remove: function (c) { n.ops.push('-' + c); } };
    return n;
  }
  return {
    activeElement: null,
    getElementById: function (id) { if (!nodes[id]) nodes[id] = node(id); return nodes[id]; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
}

const PANEL_FNS = ['txnsSignature', 'adoptTxns', 'ackTxns', 'spliceAt', 'historyComplete', 'txnById', 'nextMutation', 'isStale', 'settle',
  'refreshTxns', 'focusKey', 'focusMatches', 'focusIndex', 'repaint', 'revertTxn', 'applyEdit',
  'ensureTextRowKey', 'textTxn', 'textRowKey', 'resolveTextRowId', 'rawDraftKey', 'draftKey',
  'textRowLineage', 'dropTextRowState', 'reconcileTextRowIds', 'preservePendingAddRows',
  'beginRowWrite', 'endRowWrite', 'enqueueRowWrite', 'resumeRowWrites', 'cancelRowWrites',
  'textDraft', 'draftValue', 'captureDraft', 'hasActiveComposition',
  'textWriteQueue', 'textInputMatches', 'syncTextCopies', 'nextTextRequestToken',
  'normalizedTextValue', 'issueTextSave', 'drainTextWrite',
  'saveTextDraft', 'trySendRowCommit', 'commitRow', 'applySplit', 'bulkPost',
  'isRowDeleting', 'openDelModal', 'confirmDelete', 'cancelDeleteIntent', 'trySendDelete', 'closeDelModal',
  'chargedOf', 'isSplitTxn', 'fmt', 'esc', 'splitMark', 'typeColor', 'delBtn', 'mailLink',
  'editRow', 'splitBox', 'txnRow', 'categoryTxn'];

function harness(initial) {
  const snaps = [];
  const toasts = [];
  const rec = { calls: [], deletes: [], adds: [], reads: [] };
  const doc = domStub();
  let fns = null;
  fns = loadFns(PANEL_FNS, {
    TXNS: serverCopy(initial),
    MUTATION_SEQ: 0, INFLIGHT: 0, STALE_DROPPED: false, REFRESHING: false, OLDER_FP: null,
    HISTORY: { complete: true, before: null, loadedFp: null, loading: false, failed: null },
    TEXT_DRAFTS: {}, TEXT_DRAFT_REVISIONS: {}, TEXT_REQUEST_TOKENS: {}, TEXT_WRITE_QUEUES: {},
    TEXT_CANCEL_BLURS: {}, ROW_COMMIT_INTENTS: {}, ACTIVE_COMPOSITIONS: {}, PENDING_REPAINT: false,
    COMPOSITION_FLUSH_SCHEDULED: false, TEXT_ROW_SERIAL: 0, TEXT_REMOVED_ROW_KEYS: {},
    PENDING_ADD_ROWS: {}, ROW_ACTIVE_WRITES: {}, ROW_DELETE_INTENTS: {}, ROW_WRITE_FIFOS: {},
    pendingDelId: null, pendingDelRowKey: null, openSplit: null, openCategoryTxn: null,
    selOpts: function () { return ''; }, distinctCats: function () { return ['飲食']; },
    google: { script: { run: recordingRun(rec) } },
    // The real row markup, as every view mounts it: the shared editor plus the category summary.
    render: function () {
      snaps.push(fns.TXNS.map(function (t) { return fns.editRow(t) + fns.categoryTxn(t); }).join('\n'));
    },
    toast: function (msg, isErr) { toasts.push({ msg: msg, err: !!isErr }); },
    setTimeout: function (fn) { fn(); return 1; },
    document: doc,
    window: { pageXOffset: 0, pageYOffset: 0, scrollTo: function () {} }
  });
  fns.snaps = snaps;
  fns.toasts = toasts;
  fns.calls = rec.calls;
  fns.deletes = rec.deletes;
  fns.reads = rec.reads;
  fns.doc = doc;
  fns.last = function () { return snaps[snaps.length - 1] || ''; };
  // The markup of one row (its editRow), picked out of the last render by its data-erow id.
  fns.rowHtml = function (id) {
    const t = fns.textTxn(id);
    return t ? fns.editRow(t) : '';
  };
  fns.confirm = function (id) {
    fns.openDelModal(id);
    fns.confirmDelete();
  };
  return fns;
}

function isDeletingMarkup(html, id) {
  return html.indexOf('class="erow deleting" data-erow="' + id + '"') >= 0
    || html.indexOf('class="erow done deleting" data-erow="' + id + '"') >= 0;
}

function run() {
  const base = [row(), other()];
  const A = base[0].id, B = base[1].id;

  // ---- direct path: the modal closes and the row repaints deleting before deleteTxn returns ----
  const direct = harness(base);
  direct.confirm(B);
  assert.strictEqual(direct.deletes.length, 1, 'the delete is sent');
  assert.strictEqual(direct.pendingDelRowKey, null, 'confirming closes the modal at once');
  assert.ok(direct.doc.getElementById('delOverlay').ops.slice(-1)[0] === '-on', 'the overlay is hidden on confirmation');
  assert.ok(isDeletingMarkup(direct.last(), B), 'the row is rendered deleting before any response lands');
  assert.ok(direct.last().indexOf('刪除中…') >= 0, '刪除中… stands where the 🗑 was');
  assert.ok(!isDeletingMarkup(direct.last(), A), 'the other row is untouched');

  // ---- queued path: same state from the moment of confirmation; the edit still goes first ----
  const queued = harness(base);
  const qKey = queued.textRowKey(B);
  queued.captureDraft(qKey, 'merchant', '改名後刪除');
  queued.saveTextDraft(qKey, 'merchant');
  queued.confirm(B);
  assert.strictEqual(queued.deletes.length, 0, 'the delete waits behind the merchant write');
  assert.strictEqual(queued.pendingDelRowKey, null, 'the modal closes even though nothing was sent');
  assert.ok(isDeletingMarkup(queued.last(), B), 'a queued delete shows the same deleting state');
  const renamed = serverCopy(base); renamed[1].merchant = '改名後刪除';
  queued.calls[0].success({ ok: true, txns: renamed });
  assert.strictEqual(queued.deletes.length, 1, 'the delete is sent after the edit lands');
  assert.strictEqual(queued.deletes[0].arg.id, 'uuid-b');
  assert.ok(isDeletingMarkup(queued.last(), B), 'the edit acknowledgement repaint keeps the deleting state');

  // ---- every control of a deleting row is inert, in the editor and the category summary ----
  const inert = harness(base);
  const iKey = inert.textRowKey(B);
  inert.openSplit = iKey;
  const normal = inert.rowHtml(B);
  assert.ok(normal.indexOf(' disabled') < 0, 'a normal row renders nothing disabled');
  assert.ok(normal.indexOf('data-del=') >= 0 && normal.indexOf('data-amt=') >= 0, 'and keeps its 🗑 and split controls');
  inert.ROW_DELETE_INTENTS[iKey] = { sent: true };
  const html = inert.rowHtml(B);
  [/<input class="merin"[^>]* disabled>/, /<input class="amtcor[^>]* disabled>/,
    /<select data-ef="cat"[^>]* disabled>/, /<select data-ef="type"[^>]* disabled>/,
    /<button class="erec"[^>]* disabled>/, /<input class="sin[^>]* disabled>/,
    /<button type="button" class="sbtn ok"[^>]* disabled>/].forEach(function (re) {
    assert.ok(re.test(html), 'deleting row renders disabled: ' + re);
  });
  assert.ok(html.indexOf('data-del=') < 0, 'the 🗑 button is gone');
  assert.ok(html.indexOf('data-amt=') < 0, 'the split amount is plain text, not a button');
  assert.ok(html.indexOf('<span class="txdeleting" role="status">刪除中…</span>') >= 0, 'the 刪除中… label replaces it');
  assert.ok(html.indexOf('aria-busy="true"') >= 0, 'the row announces itself busy');
  const t = inert.textTxn(B);
  assert.ok(inert.categoryTxn(t).indexOf('class="txn-toggle deleting"') >= 0, 'the category summary shows the state too');
  t.posted = true;
  assert.ok(isDeletingMarkup(inert.editRow(t), B), 'a recorded row being deleted is marked deleting as well');

  // ---- repaints and list adoptions keep the state; it is derived, not stored on the row ----
  const adopt = harness(base);
  adopt.confirm(B);
  const sameList = serverCopy(base); sameList[0].cat = '交通';
  adopt.adoptTxns(sameList); adopt.repaint();
  assert.notStrictEqual(adopt.textTxn(B), null);
  assert.ok(isDeletingMarkup(adopt.last(), B), 'an adopted list keeps the deleting state');

  // ---- success, including a response settle drops as stale: the row never comes back ----
  const ok = harness(base);
  ok.confirm(B);
  ok.applyEdit(A, 'posted', true);                        // supersedes the delete's list
  ok.deletes[0].success({ ok: true, txns: serverCopy(base) });
  assert.strictEqual(ok.txnById(B), null, 'a stale delete response still removes the row locally');
  assert.ok(ok.last().indexOf('data-erow="' + B + '"') < 0, 'the deleted row is not on screen');
  assert.strictEqual(ok.toasts.slice(-1)[0].msg, '已刪除');
  const acked = serverCopy([base[0]]); acked[0].posted = true;
  ok.calls[0].success({ ok: true, txns: acked });
  assert.strictEqual(ok.txnById(B), null, 'and the next adoption does not resurrect it');

  // ---- failure: the row returns to normal and editable; nothing re-arms the closed modal ----
  const fail = harness(base);
  fail.confirm(B);
  fail.deletes[0].failure(new Error('找不到該筆交易'));
  assert.strictEqual(fail.ROW_DELETE_INTENTS[fail.textRowKey(B)], undefined, 'the deleting state is cleared');
  assert.ok(fail.txnById(B), 'the row is still listed');
  assert.ok(!isDeletingMarkup(fail.last(), B), 'it repaints normal');
  assert.ok(fail.rowHtml(B).indexOf('data-del=') >= 0 && fail.rowHtml(B).indexOf(' disabled') < 0, 'and editable');
  assert.deepStrictEqual(fail.toasts.slice(-1)[0], { msg: '刪除失敗:找不到該筆交易', err: true });
  assert.strictEqual(fail.pendingDelRowKey, null, 'the modal is not re-armed');
  assert.strictEqual(fail.doc.getElementById('delOverlay').ops.indexOf('+on'), 0, 'and not reopened');
  assert.strictEqual(fail.doc.getElementById('delOverlay').ops.lastIndexOf('+on'), 0);

  // ---- a write failure cancels the queued delete and leaves an unrelated open modal alone ----
  const cancel = harness(base);
  cancel.applyEdit(B, 'amount', 999);
  cancel.confirm(B);
  assert.strictEqual(cancel.deletes.length, 0);
  cancel.openDelModal(A);                                 // the owner moves on to another row
  const opsBefore = cancel.doc.getElementById('delOverlay').ops.length;
  cancel.calls[0].failure(new Error('寫入失敗'));
  assert.strictEqual(cancel.ROW_DELETE_INTENTS[cancel.textRowKey(B)], undefined, 'the queued delete is cancelled');
  assert.strictEqual(cancel.deletes.length, 0, 'and never sent');
  assert.ok(!isDeletingMarkup(cancel.last(), B), 'the row returns to normal');
  assert.strictEqual(cancel.pendingDelRowKey, cancel.textRowKey(A), 'the other row\'s modal is still armed');
  assert.strictEqual(cancel.doc.getElementById('delOverlay').ops.length, opsBefore, 'and still open');

  // ---- two deletes in flight at once: the second is not dropped ----
  const two = harness(base);
  two.confirm(B);
  two.confirm(A);
  assert.strictEqual(two.deletes.length, 2, 'both deletes are sent');
  assert.ok(isDeletingMarkup(two.last(), A) && isDeletingMarkup(two.last(), B), 'both rows show the deleting state');
  two.deletes[0].success({ ok: true, txns: serverCopy([base[0]]) });
  assert.ok(isDeletingMarkup(two.last(), A), 'the first success leaves the second still deleting');
  two.deletes[1].success({ ok: true, txns: [] });
  assert.strictEqual(two.TXNS.length, 0, 'both complete');

  // ---- 整天記帳 leaves a deleting row out before its optimistic tick ----
  const bulk = harness(base);
  bulk.applyEdit(B, 'cat', '交通');
  bulk.confirm(B);                                        // queued behind the category write
  const callsBefore = bulk.calls.length;
  bulk.bulkPost([A, B]);
  assert.strictEqual(bulk.textTxn(B).posted, false, 'the deleting row is not ticked optimistically');
  assert.strictEqual(bulk.textTxn(A).posted, true, 'the other row is');
  assert.strictEqual(bulk.calls.length, callsBefore + 1, 'only the other row is written');
  assert.strictEqual(bulk.calls[bulk.calls.length - 1].patch.posted, true);
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_delete_feedback');
} else {
  module.exports = { run };
}
