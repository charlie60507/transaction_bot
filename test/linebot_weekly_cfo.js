'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = path.resolve(__dirname, '..', 'linebot', 'linebot.js');
const TOKEN = 'placeholder-channel-token';
const OWNER = 'U-placeholder-owner';
const PUSH_URL = 'https://api.line.me/v2/bot/message/push';

function report() {
  return {
    facts: {
      reportDate: '2026-10-12', weekKey: '2026-W41',
      week: { start: '2026-10-05', end: '2026-10-11', daily: 7200, refunds: 300, project: 4800 },
      month: { key: '2026-10', elapsedDays: 11, daysInMonth: 31, daily: 16800, projection: 47345 },
      baseline: { amount: 42000, source: 'median', months: 12 }, overspending: true,
      observations: [{ type: 'large-charge', amount: 5200, merchant: '很長但必須換行顯示的商家名稱', category: '個人' }], subscriptionEvents: []
    },
    copy: { conclusion: '照目前速度，本月可能超過日常比較基準', explanations: ['很長但必須換行顯示的商家名稱單筆 NT$5,200，值得留意'], source: 'computed' }
  };
}

function load() {
  const store = { CHANNEL_ACCESS_TOKEN: TOKEN, OWNER_USER_ID: OWNER };
  const fetches = [];
  const ledgerCalls = [];
  const locks = { wait: 0, release: 0 };
  const logs = [];
  const response = { code: 200 };
  const triggers = [];
  const NativeDate = Date;
  class FakeDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : ['2026-10-12T00:00:00Z'])); }
    static now() { return NativeDate.parse('2026-10-12T00:00:00Z'); }
  }
  function formatDate(date, tz, fmt) {
    assert.strictEqual(tz, 'Asia/Taipei');
    assert.strictEqual(fmt, 'yyyy-MM-dd');
    const shifted = new NativeDate(date.getTime() + 8 * 3600000);
    return shifted.getUTCFullYear() + '-' + String(shifted.getUTCMonth() + 1).padStart(2, '0') + '-' + String(shifted.getUTCDate()).padStart(2, '0');
  }
  const scriptApp = {
    WeekDay: { MONDAY: 'MONDAY' },
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: t => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
    newTrigger: handler => {
      const cfg = { handler };
      const builder = {
        timeBased() { return this; }, onWeekDay(v) { cfg.day = v; return this; }, atHour(v) { cfg.hour = v; return this; },
        nearMinute(v) { cfg.minute = v; return this; }, inTimezone(v) { cfg.tz = v; return this; },
        create() { const t = { cfg, getHandlerFunction: () => handler }; triggers.push(t); return t; }
      };
      return builder;
    }
  };
  const sandbox = {
    Date: FakeDate, JSON, Math, Number, String, Object, Array, RegExp, isNaN,
    console: { log: m => logs.push(String(m)), error: m => logs.push(String(m)) },
    Utilities: { formatDate }, ScriptApp: scriptApp,
    Ledger: { ledgerWeeklyCfo: date => { ledgerCalls.push(date); return report(); } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
      setProperty: (k, v) => { store[k] = String(v); }, deleteProperty: k => { delete store[k]; },
      getProperties: () => Object.assign({}, store)
    }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { locks.wait++; }, releaseLock: () => { locks.release++; } }) },
    UrlFetchApp: { fetch: (url, req) => { fetches.push({ url, req }); return { getResponseCode: () => response.code, getContentText: () => '{}' }; } }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), sandbox, { filename: 'linebot.js' });
  return { sandbox, store, fetches, ledgerCalls, locks, logs, response, triggers };
}

function payload(call) { return JSON.parse(call.req.payload); }
function allNodes(node, out) {
  out = out || [];
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  Object.keys(node).forEach(k => { if (Array.isArray(node[k])) node[k].forEach(x => allNodes(x, out)); else allNodes(node[k], out); });
  return out;
}

function run() {
  // Scheduled send: owner-only push, key after success, and same-week retry is a no-op.
  {
    const h = load();
    const first = h.sandbox.sendWeeklyCfoReport();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(first)), { sent: true, weekKey: '2026-W41' });
    assert.strictEqual(h.fetches.length, 1);
    assert.strictEqual(h.fetches[0].url, PUSH_URL);
    assert.strictEqual(h.fetches[0].req.headers.Authorization, 'Bearer ' + TOKEN);
    assert.strictEqual(payload(h.fetches[0]).to, OWNER, 'push destination is only the configured owner');
    assert.strictEqual(payload(h.fetches[0]).messages.length, 1, 'one compact card');
    assert.strictEqual(h.store['weekly-cfo:last-sent-week'], '2026-W41');
    const second = h.sandbox.sendWeeklyCfoReport();
    assert.strictEqual(second.sent, false);
    assert.strictEqual(h.fetches.length, 1, 'same scheduled week never sends twice');
    assert.strictEqual(h.ledgerCalls.length, 1, 'week key is checked before report computation');
    assert.strictEqual(h.locks.wait, h.locks.release, 'lock always releases');

    const card = payload(h.fetches[0]).messages[0];
    const nodes = allNodes(card);
    assert.ok(nodes.some(n => n.text && n.text.indexOf('月底推估') >= 0));
    assert.ok(nodes.some(n => n.text && n.text.indexOf('專案支出') >= 0));
    assert.ok(nodes.some(n => n.text && n.text.indexOf('很長但必須換行') >= 0 && n.wrap === true), 'merchant copy wraps');
    assert.ok(!nodes.some(n => n.type === 'button'), 'approved card has no buttons or free-text invitation');
  }

  // Failed push does not advance the key; a later scheduled retry succeeds.
  {
    const h = load();
    h.response.code = 503;
    assert.throws(() => h.sandbox.sendWeeklyCfoReport(), /LINE push HTTP 503/);
    assert.strictEqual(h.store['weekly-cfo:last-sent-week'], undefined);
    h.response.code = 200;
    assert.strictEqual(h.sandbox.sendWeeklyCfoReport().sent, true);
    assert.strictEqual(h.store['weekly-cfo:last-sent-week'], '2026-W41');
    assert.ok(h.logs.every(line => ![TOKEN, OWNER].some(secret => line.indexOf(secret) >= 0)), 'credentials never reach logs');
  }

  // Manual sender bypasses the scheduled key without reading or changing it.
  {
    const h = load();
    h.store['weekly-cfo:last-sent-week'] = '2026-W41';
    const before = h.store['weekly-cfo:last-sent-week'];
    assert.strictEqual(h.sandbox.sendWeeklyCfoReportManual().sent, true);
    assert.strictEqual(h.fetches.length, 1);
    assert.strictEqual(h.store['weekly-cfo:last-sent-week'], before);
  }

  // Installer is explicit and idempotent; duplicates are repaired without touching other triggers.
  {
    const h = load();
    const unrelated = { getHandlerFunction: () => 'otherHandler' };
    h.triggers.push(unrelated);
    assert.strictEqual(h.sandbox.installWeeklyCfoTrigger().count, 1);
    assert.strictEqual(h.triggers.filter(t => t.getHandlerFunction() === 'sendWeeklyCfoReport').length, 1);
    assert.strictEqual(h.triggers[1].cfg.day, 'MONDAY');
    assert.strictEqual(h.triggers[1].cfg.hour, 8);
    assert.strictEqual(h.triggers[1].cfg.tz, 'Asia/Taipei');
    assert.strictEqual(h.sandbox.installWeeklyCfoTrigger().installed, false);
    h.triggers.push({ getHandlerFunction: () => 'sendWeeklyCfoReport' });
    assert.strictEqual(h.sandbox.installWeeklyCfoTrigger().count, 1, 'duplicates collapse to exactly one');
    assert.ok(h.triggers.includes(unrelated), 'unrelated trigger remains');
  }
}

if (require.main === module) {
  run();
  console.log('✓ linebot_weekly_cfo');
} else module.exports = { run };
