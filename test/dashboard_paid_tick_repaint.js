'use strict';
/*
 * Ticking 已記帳 must not repaint the panel a beat later.
 *
 * The panel is a bound Apps Script page, so none of this can be exercised against the real
 * sheet from here. What IS provable offline is the decision logic: the whole-list signature
 * that decides whether a server response changes anything on screen, the sequence guard that
 * refuses a snapshot another mutation has already superseded, and the revert path that must
 * re-resolve its row after an adoption detached the object it captured. Each function is
 * lifted out of ToolPanel.html by extract_panel and run against a stubbed google.script.run,
 * so a repaint is a counted call rather than something a human has to watch for.
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

function harness(initial) {
  const renders = { n: 0 };
  const toasts = [];
  const calls = [];
  let pending = {};
  const run = {
    withSuccessHandler: function (f) { pending.success = f; return run; },
    withFailureHandler: function (f) { pending.failure = f; return run; },
    updateTxn: function (id, patch, wantTxns) {
      calls.push({ id: id, patch: patch, wantTxns: wantTxns, success: pending.success, failure: pending.failure });
      pending = {};
    }
  };
  const fns = loadFns(
    ['txnsSignature', 'adoptTxns', 'txnById', 'nextMutation', 'isStale', 'focusKey', 'repaint', 'revertTxn', 'applyEdit'],
    {
      TXNS: serverCopy(initial || []),
      MUTATION_SEQ: 0,
      google: { script: { run: run } },
      render: function () { renders.n++; },
      toast: function (msg, isErr) { toasts.push({ msg: msg, err: !!isErr }); },
      document: { activeElement: null, querySelector: function () { return null; } },
      window: { pageXOffset: 0, pageYOffset: 0, scrollTo: function () {} }
    }
  );
  fns.renders = renders;
  fns.toasts = toasts;
  fns.calls = calls;
  return fns;
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
  assert.ok(!/var pos=this\.selectionStart/.test(script), 'the search box no longer restores focus by hand');
  assert.ok(/q\.oninput=function\(\)\{ state\.q=this\.value; repaint\(\); \};/.test(script),
    'the search box goes through the shared repaint wrapper');

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
