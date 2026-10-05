'use strict';
// The LINE webhook end to end, offline: linebot/linebot.js + line_parse.js with stubbed Ledger,
// UrlFetchApp, PropertiesService, LockService and CacheService. Every credential below is an
// obvious placeholder — this repo is public.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.resolve(__dirname, '..', 'linebot');
const SECRET = 'placeholder-webhook-secret';
const TOKEN = 'placeholder-channel-token';
const OWNER = 'U-placeholder-owner';
const STRANGER = 'U-placeholder-stranger';
const REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const T0 = Date.parse('2026-10-05T03:00:00Z');   // 11:00 in Asia/Taipei
const HOUR = 60 * 60 * 1000;

function formatDate(date, tz, fmt) {
  assert.strictEqual(tz, 'Asia/Taipei');
  const s = new Date(date.getTime() + 8 * HOUR);
  const parts = { yyyy: String(s.getUTCFullYear()), MM: String(s.getUTCMonth() + 1).padStart(2, '0'), dd: String(s.getUTCDate()).padStart(2, '0') };
  return fmt.replace(/yyyy|MM|dd/g, t => parts[t]);
}

/** A Ledger that records calls and keeps written rows in memory. `parse` maps text → entries
 *  (or throws, standing in for a Gemini failure). */
function fakeLedger(parse, accounts) {
  const st = { rows: {}, adds: [], undos: [], parses: [], seq: 0 };
  const api = {
    ledgerContext: () => ({ accounts: (accounts || ['中信', 'LINE Pay', '現金', '富邦', '國泰']).slice(), categories: ['飲食', '交通'], rules: [] }),
    ledgerParse: (text, today, acc) => { st.parses.push({ text, today, acc }); return { entries: parse(text) }; },
    ledgerCategorize: ms => ms.map(m => ({ 拉麵: '飲食', 計程車: '交通' })[m] || ''),
    ledgerAdd: entries => {
      st.adds.push(JSON.parse(JSON.stringify(entries)));
      return entries.map(e => {
        const rowId = 'row-' + (++st.seq);
        st.rows[rowId] = e;
        const p = e.date.split('-').map(Number);
        return { rowId, bank: e.account, merchant: e.merchant, amount: e.amount, cat: e.cat || '未分類', type: e.type, m: p[1], d: p[2] };
      });
    },
    ledgerUndo: id => { st.undos.push(id); if (st.rows[id]) { delete st.rows[id]; return 'deleted'; } return 'missing'; }
  };
  return { st, api };
}

function load(ledger, propsInit) {
  const clock = { now: T0 };
  const NativeDate = Date;
  class FakeDate extends NativeDate {
    constructor(...a) { super(...(a.length ? a : [clock.now])); }
    static now() { return clock.now; }
  }
  const store = Object.assign({ WEBHOOK_SECRET: SECRET, CHANNEL_ACCESS_TOKEN: TOKEN, OWNER_USER_ID: OWNER }, propsInit || {});
  const fetches = [];
  const logs = [];
  const locks = { wait: 0, release: 0 };
  let uuid = 0;
  const sandbox = {
    Date: FakeDate, JSON, Math, Object, Array, String, Number, isNaN,
    console: { log: m => logs.push(String(m)), error: m => logs.push(String(m)) },
    Ledger: ledger.api,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); },
      deleteProperty: k => { delete store[k]; },
      getProperties: () => Object.assign({}, store)
    }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { locks.wait++; }, releaseLock: () => { locks.release++; } }) },
    CacheService: { getScriptCache: () => { throw new Error('cache is not used'); } },
    UrlFetchApp: { fetch: (url, req) => { fetches.push({ url, req }); return { getResponseCode: () => 200, getContentText: () => '{}' }; } },
    Utilities: { formatDate, getUuid: () => ('0000000' + (++uuid)).slice(-8) + '-aaaa-bbbb-cccc-dddddddddddd' },
    ContentService: { createTextOutput: t => ({ text: t }) }
  };
  vm.createContext(sandbox);
  ['line_parse.js', 'linebot.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f }));

  let evtSeq = 0;
  const h = {
    clock, store, fetches, logs, locks, st: ledger.st, sandbox,
    post(events, query) {
      const e = { parameter: query === undefined ? { k: SECRET } : query, postData: { contents: JSON.stringify({ destination: 'Uplaceholder', events }) } };
      const out = sandbox.doPost(e);
      assert.strictEqual(out.text, 'OK', 'always answers 200 OK');
    },
    text(text, opts) {
      opts = opts || {};
      const id = opts.id || ('evt-' + (++evtSeq));
      return { type: 'message', webhookEventId: id, replyToken: 'rt-' + id, timestamp: clock.now,
        source: { type: 'user', userId: opts.user || OWNER }, message: { type: 'text', id: 'm' + id, text } };
    },
    postback(data, opts) {
      opts = opts || {};
      const id = opts.id || ('evt-' + (++evtSeq));
      return { type: 'postback', webhookEventId: id, replyToken: 'rt-' + id, timestamp: clock.now,
        source: { type: 'user', userId: opts.user || OWNER }, postback: { data } };
    },
    replies() {
      return fetches.map(f => {
        assert.strictEqual(f.url, REPLY_URL, 'only the reply endpoint is ever called');
        assert.strictEqual(f.req.headers.Authorization, 'Bearer ' + TOKEN);
        return JSON.parse(f.req.payload);
      });
    },
    last() { const r = h.replies(); return r[r.length - 1]; }
  };
  return h;
}

const entry = (o) => Object.assign({ date: '2026-10-05', time: '', amount: 180, merchant: '拉麵', type: '支出', accountText: '' }, o);
const flexLines = (msg) => msg.contents.body.contents.map(row => row.contents[0].text);
const flexUndo = (msg) => msg.contents.body.contents.map(row => row.contents[1] && row.contents[1].action.data);

function run() {
  // ---- AC1: one entry with a matched account ---------------------------------
  {
    const h = load(fakeLedger(() => [entry({ accountText: '中信' })]));
    h.post([h.text('中信 午餐 拉麵 180')]);
    assert.strictEqual(h.st.parses[0].today, '2026-10-05', 'today resolved in Asia/Taipei');
    assert.strictEqual(h.st.adds.length, 1);
    assert.deepStrictEqual(h.st.adds[0], [{ date: '2026-10-05', time: '', amount: 180, type: '支出', account: '中信', merchant: '拉麵', cat: '飲食' }]);
    const r = h.last();
    assert.strictEqual(r.replyToken, 'rt-evt-1');
    assert.strictEqual(r.messages.length, 1);
    assert.strictEqual(r.messages[0].type, 'flex');
    assert.deepStrictEqual(flexLines(r.messages[0]), ['已記：中信｜拉麵｜$180｜飲食｜10/5']);
    assert.deepStrictEqual(flexUndo(r.messages[0]), ['undo:row-1'], 'persistent 撤銷 postback carries the 交易 ID');
    assert.strictEqual(r.messages[0].contents.body.contents[0].contents[1].action.label, '撤銷');
    assert.ok(h.store['evt:evt-1'], 'event marked seen');
    assert.strictEqual(h.locks.wait, h.locks.release, 'lock always released');
  }

  // ---- AC2/AC3: multi-entry, no account → 現金, one locked ledgerAdd ---------
  {
    const h = load(fakeLedger(() => [entry({ merchant: '午餐', amount: 180 }), entry({ merchant: '晚餐', amount: 250 })]));
    h.post([h.text('午餐 180 晚餐 250')]);
    assert.strictEqual(h.st.adds.length, 1, 'one ledgerAdd call for the whole message');
    assert.deepStrictEqual(h.st.adds[0].map(e => e.account), ['現金', '現金']);
    assert.deepStrictEqual(flexLines(h.last().messages[0]), ['已記：現金｜午餐｜$180｜未分類｜10/5', '已記：現金｜晚餐｜$250｜未分類｜10/5']);
    assert.deepStrictEqual(flexUndo(h.last().messages[0]), ['undo:row-1', 'undo:row-2']);
  }

  // ---- AC4: unmatched account → buttons, nothing written; a tap writes once ---
  {
    const h = load(fakeLedger(() => [entry({ accountText: '重信' })]));
    h.post([h.text('重信 午餐 拉麵 180')]);
    assert.strictEqual(h.st.adds.length, 0, 'unmatched account writes nothing');
    const prompt = h.last().messages[0];
    assert.ok(/找不到帳戶「重信」/.test(prompt.text));
    const items = prompt.quickReply.items;
    assert.deepStrictEqual(items.map(i => i.action.label), ['中信', 'LINE Pay', '現金', '富邦', '國泰', '取消'], 'accounts then 取消');
    const pick = items[0].action.data;
    const cancelData = items[5].action.data;
    assert.ok(/^pick:[0-9a-z]{8}:0$/.test(pick));
    assert.ok(Object.keys(h.store).some(k => k.indexOf('pend:') === 0), 'choice kept in Script Properties');

    h.post([h.postback(pick)]);
    assert.strictEqual(h.st.adds.length, 1);
    assert.strictEqual(h.st.adds[0][0].account, '中信', 'written with the chosen account');
    assert.deepStrictEqual(flexLines(h.last().messages[0]), ['已記：中信｜拉麵｜$180｜飲食｜10/5']);

    h.post([h.postback(pick)]);
    assert.strictEqual(h.st.adds.length, 1, 'double tap writes nothing');
    assert.strictEqual(h.last().messages[0].text, '這筆已處理');
    h.post([h.postback(cancelData)]);
    assert.strictEqual(h.last().messages[0].text, '這筆已處理', 'cancel after use is a no-op');
  }
  // cancelled, then tapped
  {
    const h = load(fakeLedger(() => [entry({ accountText: '重信' })]));
    h.post([h.text('重信 午餐 拉麵 180')]);
    const items = h.last().messages[0].quickReply.items;
    h.post([h.postback(items[items.length - 1].action.data)]);
    assert.strictEqual(h.last().messages[0].text, '已取消');
    h.post([h.postback(items[0].action.data)]);
    assert.strictEqual(h.st.adds.length, 0, 'a cancelled choice writes nothing');
    assert.strictEqual(h.last().messages[0].text, '這筆已處理');
  }
  // expired (24 hours), and an unknown token
  {
    const h = load(fakeLedger(() => [entry({ accountText: '重信' })]));
    h.post([h.text('重信 午餐 拉麵 180')]);
    const pick = h.last().messages[0].quickReply.items[1].action.data;
    h.clock.now += 25 * HOUR;
    h.post([h.postback(pick)]);
    assert.strictEqual(h.st.adds.length, 0, 'an expired choice writes nothing');
    assert.strictEqual(h.last().messages[0].text, '選擇已過期，請重新傳送');
    assert.ok(!Object.keys(h.store).some(k => k.indexOf('pend:') === 0), 'expired choice pruned');
    h.post([h.postback('pick:zzzzzzzz:0')]);
    assert.strictEqual(h.last().messages[0].text, '選擇已過期，請重新傳送');
    h.post([h.postback('pick:' + pick.split(':')[1] + ':12')]);
    assert.strictEqual(h.st.adds.length, 0);
  }
  // mixed message: the matched entry is written now, the unmatched one is asked about;
  // two unmatched entries are asked one at a time.
  {
    const h = load(fakeLedger(() => [
      entry({ merchant: '拉麵', amount: 180, accountText: '中信' }),
      entry({ merchant: '計程車', amount: 250, accountText: '重信' }),
      entry({ merchant: '咖啡', amount: 90, accountText: '綠信' })
    ]));
    h.post([h.text('中信 拉麵 180 重信 計程車 250 綠信 咖啡 90')]);
    assert.strictEqual(h.st.adds.length, 1);
    assert.deepStrictEqual(h.st.adds[0].map(e => e.merchant), ['拉麵']);
    let msgs = h.last().messages;
    assert.deepStrictEqual(msgs.map(m => m.type), ['flex', 'text'], 'confirmation first, prompt last (quick reply needs the last message)');
    assert.ok(/重信/.test(msgs[1].text));
    h.post([h.postback(msgs[1].quickReply.items[2].action.data)]);
    msgs = h.last().messages;
    assert.deepStrictEqual(h.st.adds[1].map(e => [e.merchant, e.account, e.cat]), [['計程車', '現金', '交通']]);
    assert.ok(/綠信/.test(msgs[1].text), 'the reply to one choice carries the next prompt');
    h.post([h.postback(msgs[1].quickReply.items[msgs[1].quickReply.items.length - 1].action.data)]);
    assert.strictEqual(h.last().messages.length, 1, 'no more prompts after the last choice');
    assert.strictEqual(h.st.adds.length, 2);
  }
  // a model-"corrected" account (typed 重信, returned 中信) is asked about, never written as 中信
  {
    const h = load(fakeLedger(() => [entry({ accountText: '中信' })]));
    h.post([h.text('重信 午餐 拉麵 180')]);
    assert.strictEqual(h.st.adds.length, 0);
    const prompt = h.last().messages[0];
    assert.ok(prompt.quickReply);
    assert.ok(prompt.text.indexOf('「中信」') === -1, "the model's corrected account is not echoed");
    assert.ok(/找不到訊息中的帳戶/.test(prompt.text), 'the prompt says the typed account was not found');
    assert.deepStrictEqual(prompt.quickReply.items.map(i => i.action.label), ['中信', 'LINE Pay', '現金', '富邦', '國泰', '取消'],
      'buttons and 取消 are unchanged');
  }
  // more than 12 accounts → the 12 nearest plus 取消, and the reply says so
  {
    const many = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8', 'I9', 'J0', 'K1', 'L2', 'M3', '中信'];
    const h = load(fakeLedger(() => [entry({ accountText: '重信' })], many));
    h.post([h.text('重信 拉麵 180')]);
    const p = h.last().messages[0];
    assert.strictEqual(p.quickReply.items.length, 13, "LINE's 13-item cap");
    assert.strictEqual(p.quickReply.items[0].action.label, '中信');
    assert.strictEqual(p.quickReply.items[12].action.label, '取消');
    assert.ok(/最接近的 12 個/.test(p.text));
  }

  // ---- AC5: no verifiable amount → nothing written, one example line ----------
  [
    () => [entry({ amount: null })],
    () => [entry({ amount: 180 })],                                   // text says 一百八
    () => [entry({ amount: 180, accountText: '中信' }), entry({ amount: null, merchant: '晚餐' })],
    () => []
  ].forEach((parse, i) => {
    const h = load(fakeLedger(parse));
    h.post([h.text('中信 午餐 一百八 晚餐')]);
    assert.strictEqual(h.st.adds.length, 0, 'not-understood case ' + i + ' writes nothing');
    assert.ok(/看不懂/.test(h.last().messages[0].text) && /中信 午餐 拉麵 180/.test(h.last().messages[0].text));
  });

  // ---- AC9: Gemini failure → error reply, nothing written ----------------------
  {
    const h = load(fakeLedger(() => { throw new Error('Gemini HTTP 503'); }));
    h.post([h.text('午餐 180')]);
    assert.strictEqual(h.st.adds.length, 0);
    assert.ok(/記帳失敗/.test(h.last().messages[0].text));
  }
  // a sheet failure after parsing is reported, not swallowed silently
  {
    const led = fakeLedger(() => [entry({})]);
    led.api.ledgerAdd = () => { throw new Error('找不到 Transactions 工作表'); };
    const h = load(led);
    h.post([h.text('午餐 180')]);
    assert.ok(/處理失敗/.test(h.last().messages[0].text));
    assert.ok(h.store['evt:evt-1'], 'a failed event is still marked seen, so a redelivery cannot double-write');
  }

  // ---- AC7: undo ---------------------------------------------------------------
  {
    const h = load(fakeLedger(() => [entry({ accountText: '中信' })]));
    h.post([h.text('中信 午餐 拉麵 180')]);
    const undo = flexUndo(h.last().messages[0])[0];
    h.post([h.postback(undo)]);
    assert.deepStrictEqual(h.st.undos, ['row-1']);
    assert.strictEqual(h.last().messages[0].text, '已撤銷');
    h.post([h.postback(undo)]);
    assert.strictEqual(h.last().messages[0].text, '這筆已不存在', 'already undone');
    h.clock.now += 400 * 24 * HOUR;
    h.post([h.postback('undo:row-999')]);
    assert.strictEqual(h.last().messages[0].text, '這筆已不存在', 'deleted elsewhere; no time limit on asking');
  }

  // ---- AC8: duplicate hint for the auto-imported cards ------------------------
  {
    const h = load(fakeLedger(() => [entry({ accountText: '富邦', merchant: '超商', amount: 60 })]));
    h.post([h.text('富邦 超商 60')]);
    assert.deepStrictEqual(flexLines(h.last().messages[0]), ['已記：富邦｜超商｜$60｜未分類｜10/5（這張卡會自動匯入，可能重複）']);
  }

  // ---- AC10: a redelivered webhookEventId is ignored ---------------------------
  {
    const h = load(fakeLedger(() => [entry({})]));
    const evt = h.text('午餐 180', { id: 'same-id' });
    h.post([evt]);
    h.post([evt]);
    h.post([evt, evt]);
    assert.strictEqual(h.st.adds.length, 1, 'one row');
    assert.strictEqual(h.fetches.length, 1, 'one reply');
    h.clock.now += 8 * 24 * HOUR;
    h.post([h.text('x')]);   // any call prunes
    assert.ok(!h.store['evt:same-id'], 'seen events are pruned after 7 days');
  }

  // ---- AC11: stranger, missing or wrong secret → no write, no reply -----------
  {
    const h = load(fakeLedger(() => [entry({})]));
    h.post([h.text('午餐 180', { user: STRANGER })]);
    h.post([h.postback('undo:row-1', { user: STRANGER })]);
    h.post([h.text('午餐 180')], {});
    h.post([h.text('午餐 180')], { k: 'wrong' });
    h.post([h.text('午餐 180')], { k: SECRET + 'x' });
    h.post([h.text('午餐 180')], { k: '' });
    assert.strictEqual(h.st.adds.length, 0);
    assert.strictEqual(h.st.undos.length, 0);
    assert.strictEqual(h.st.parses.length, 0, 'not even parsed');
    assert.strictEqual(h.fetches.length, 0, 'no reply at all');
    // no secret configured at all → nothing is honoured
    const h2 = load(fakeLedger(() => [entry({})]), { WEBHOOK_SECRET: '' });
    h2.post([h2.text('午餐 180')], { k: '' });
    assert.strictEqual(h2.fetches.length, 0);
    // malformed bodies and the console's empty Verify request
    const h3 = load(fakeLedger(() => [entry({})]));
    h3.sandbox.doPost({ parameter: { k: SECRET }, postData: { contents: 'not json' } });
    h3.post([]);
    h3.sandbox.doPost({ parameter: { k: SECRET } });
    assert.strictEqual(h3.fetches.length, 0);
  }

  // ---- AC12/13: reply only; no credential in any log ---------------------------
  {
    const led = fakeLedger(() => [entry({})]);
    const h = load(led);
    h.sandbox.UrlFetchApp.fetch = (url, req) => { h.fetches.push({ url, req }); return { getResponseCode: () => 400, getContentText: () => 'bad' }; };
    h.post([h.text('午餐 180')]);
    led.api.ledgerAdd = () => { throw new Error('boom'); };
    h.post([h.text('午餐 180')]);
    h.replies();                                            // asserts every call was the reply URL
    assert.ok(h.fetches.every(f => f.url.indexOf('/push') === -1));
    const all = h.logs.join('\n');
    [SECRET, TOKEN, OWNER].forEach(s => assert.ok(all.indexOf(s) === -1, 'a credential reached a log'));
  }

  // ---- source hygiene: no credential-shaped literals in linebot/ ----------------
  ['linebot.js', 'line_parse.js'].forEach(f => {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    assert.ok(!/U[0-9a-f]{32}/.test(src), f + ' contains a LINE userId');
    assert.ok(!/[A-Za-z0-9+/]{100,}={0,2}/.test(src), f + ' contains a long token-like literal');
    assert.ok(src.indexOf('/v2/bot/message/push') === -1, f + ' references the push endpoint');
  });
}

if (require.main === module) {
  run();
  console.log('✓ linebot_webhook');
} else {
  module.exports = { run };
}
