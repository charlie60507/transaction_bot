'use strict';
/*
 * #62 changed HOW the two load calls work (one shared getDataRange read, 交易 ID backfill from that
 * read, arithmetic dates, JSON-string payloads) and must not change WHAT they return. This pins the
 * load responses byte for byte against captures taken from the server at 5b3edcc (before #62):
 *
 * - `olderFp` / `loadedFp` are listed literally, so a fingerprint drift names itself;
 * - every response is compared as the exact JSON text: sha256 of JSON.stringify(old object
 *   response) against sha256 of the new string response. Equal text means the parsed response
 *   deep-equals the old object, key order included.
 *
 * Fixtures: dashboard_recent_ack's and dashboard_history_split's (asc / desc / mixed), plus the
 * recent_ack sheet with 我的消費 and 交易 ID moved to other columns, and the recent_ack and history asc sheets
 * with displayed rows missing their 交易 ID (the backfill assigns uuid-1, uuid-2 in sheet order on both
 * sides, so the responses, fingerprints included, still match).
 *
 * The captures were produced by running captureAll() below against 5b3edcc's sidebar/程式碼.js
 * with 5b3edcc's own dashboard_recent_ack loadServer. Do not regenerate them from the current
 * implementation: their whole value is that they predate the change.
 */
process.env.TZ = 'Asia/Taipei';
const assert = require('assert');
const crypto = require('crypto');
const recentAck = require('./dashboard_recent_ack');
const historySplit = require('./dashboard_history_split');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/** 我的消費 (L) and 交易 ID (M) moved: a memo column at L, 交易 ID at M, 我的消費 at N. */
function movedColumns(rows) {
  return rows.map((r, i) => {
    if (r.length <= 11) return r.slice();
    return r.slice(0, 11).concat([i === 0 ? '備註' : '', r[12], r[11]]);
  });
}

/** The rows whose MessageId is in `msgs` lose their 交易 ID. */
function missingIds(rows, msgs) {
  return rows.map(r => msgs.indexOf(r[8]) >= 0 ? Object.assign(r.slice(), { 12: '' }) : r.slice());
}

function scenarios() {
  return [
    { name: 'recent_ack', rows: recentAck.fixtureRows() },
    { name: 'recent_ack moved columns', rows: movedColumns(recentAck.fixtureRows()) },
    { name: 'recent_ack missing ids', rows: missingIds(recentAck.fixtureRows(), ['a', 'd']) },
    { name: 'history asc', rows: historySplit.fixtureRows('asc') },
    { name: 'history desc', rows: historySplit.fixtureRows('desc') },
    { name: 'history mixed', rows: historySplit.fixtureRows('mixed') },
    { name: 'history asc moved columns', rows: movedColumns(historySplit.fixtureRows('asc')) },
    // An older row and a run of two adjacent recent rows (one same-day duplicate group).
    { name: 'history asc missing ids', rows: missingIds(historySplit.fixtureRows('asc'), ['nf-3', 'cathay-win']) }
  ];
}

/**
 * The load responses of one fixture, each as JSON text. `loadServer` is the loader to use (the old
 * tree's for the capture, this tree's for the test) and `text(response)` turns one response into
 * its JSON text: JSON.stringify for the old object responses, identity for the new strings. Each
 * call runs on a fresh sheet, so a backfill in one call cannot leak into the next.
 */
function capture(loadServer, EditableSheet, rows, text) {
  const fresh = () => loadServer(new EditableSheet(rows));
  const parse = res => JSON.parse(text(res));
  const whole = text(fresh().getDashboardData());
  const recent = text(fresh().getDashboardData({ sinceMonths: 13 }));
  const r = JSON.parse(recent);
  const out = { whole, recent, olderFp: JSON.parse(whole).olderFp, loadedFp: r.loadedFp === undefined ? null : r.loadedFp };
  if (r.before) {
    out.rest = text(fresh().getTxnsBefore(r.before.y, r.before.m, r.loadedFp));
    out.restStale = text(fresh().getTxnsBefore(r.before.y, r.before.m, 'stale'));
    out.restOlderFp = parse(fresh().getTxnsBefore(r.before.y, r.before.m, r.loadedFp)).olderFp;
  }
  return out;
}

function summarize(c) {
  const s = { olderFp: c.olderFp, loadedFp: c.loadedFp, whole: sha(c.whole), recent: sha(c.recent) };
  if (c.rest !== undefined) Object.assign(s, { restOlderFp: c.restOlderFp, rest: sha(c.rest), restStale: sha(c.restStale) });
  return s;
}

function captureAll(loadServer, EditableSheet, text) {
  const out = {};
  scenarios().forEach(sc => { out[sc.name] = summarize(capture(loadServer, EditableSheet, sc.rows, text)); });
  return out;
}

// Captured at 5b3edcc (see the header). Fingerprints literal, responses as sha256 of their JSON text.
const EXPECTED = {
  'recent_ack': {
    olderFp: '8878064585780462',
    loadedFp: null,
    whole: '05debc3e8960246eb640e69787b8d81c5e29eb51d3e186fec5f66d0702bac3f1',
    recent: 'c62a5fdef258a801bb6b18a0a13b2805c69d8e2cfef7768078d5c7292a794b4d'
  },
  'recent_ack moved columns': {
    olderFp: '923354348438391',
    loadedFp: null,
    whole: 'a59ef67cac4367b9c79f4127e13220ffdaa1c56bccc5b1ba7ecb3197b939f214',
    recent: 'e7ca221bce3ba8275e353c0fd8ae9b0629ea06d53012b8ad31f308d7c61a52ce'
  },
  'recent_ack missing ids': {
    olderFp: '7553391934679375',
    loadedFp: null,
    whole: 'b36b96f42e98bdd53ab2cfe0a5085327a05f914dcc371bc15a6a3ad6944c3bee',
    recent: 'ba7fd8ca0b07d2c0f489c7ac95b05ff6b682a1c705c75a75988e968686f94f7b'
  },
  'history asc': {
    olderFp: '4560067529386355',
    loadedFp: '4793811883188588',
    whole: '2e9bd29945b00a2c727c2f90c14c4e8f434d0febc7ff7528c27cd63a7ac8adfd',
    recent: 'd3f5ea130c0359e724aa831bf9b67536c79d7f5e2f94282180df33d87a0e47f7',
    restOlderFp: '4560067529386355',
    rest: 'ae45f3d4480fcb65ea20b446a9c3f6e9f92e22affe98dd191947c72042237e45',
    restStale: '76aaa10fef4022c20490299c9e6cbba9ca2fccc8274559389180bfe00f24eeed'
  },
  'history desc': {
    olderFp: '6413401577509568',
    loadedFp: '6021202445595139',
    whole: '05c53ca38347fd49fb4bb42b5c1013e463f3032c1671a9b98cb2480e0eeabcd0',
    recent: '83708fe547c42119fa4d1e73b4d019fb18efa50adeb305e2a40916c5a0ecc65b',
    restOlderFp: '6413401577509568',
    rest: '013a78f8cd1dc3b2f8f215923ce451dcb5a6c167fc467ac61ec3a4ca90e0ed77',
    restStale: 'a37c18153ecea5ebd892cc3290dd0a9c53a0fd4ad4538d62eedcc18f20208204'
  },
  'history mixed': {
    olderFp: '2593193569373755',
    loadedFp: '7484827270997669',
    whole: '8bf67a58020e7db9a69e1247485e6b3fe35d174cba62ae085ec3ed989d991b94',
    recent: '69aceb08a9a677d2ef7898e6e73cf988858db2caa528d26f22a43eba7bbe6f0a',
    restOlderFp: '2593193569373755',
    rest: '5b13a428f0f7115cf582ce72de54b3a0ef3248021766691c25daea3043ca201c',
    restStale: '8d914d5030c74ffcaf50a03427ef7019c436ffffccb5025a0ba81aa3f72f0d24'
  },
  'history asc moved columns': {
    olderFp: '4402533469847568',
    loadedFp: '5390328100406994',
    whole: '08b9726e41400ec9ffdaa0f0be8039fb774892a1dbfb65c837a3c0ad4b078291',
    recent: 'd33f64d38da0672cf3f8740919b284b519ab779282bf470672985c587526bb8d',
    restOlderFp: '4402533469847568',
    rest: '4897140d9d1f678e9191e958b0de73c12581cf1ca32c34d9180b906d1042825d',
    restStale: 'defa3a5048be8dfc50764c65a443f559019a5daaac879f1c125a2e58720f81d1'
  },
  'history asc missing ids': {
    olderFp: '2697307599299464',
    loadedFp: '3161576088928461',
    whole: 'd46cf66b19d723da26d556bc154383ea825996f39227cbb4798799fd93c595b6',
    recent: '94948a66de308a961a272f2e81101e52625b131c331878da612b82f904ebe05a',
    restOlderFp: '2697307599299464',
    rest: 'bd241adb93e3efa80e502aa0c08a3602851f5eeb070dde53399abc01d5b887c9',
    restStale: '276ac95b5405be0da444f7dac1ac6f3d73746a0e49c657a4c12270d42be68df8'
  }
};

/** #65 appended `categories` (META!D) to getDashboardData's payload as its LAST key. Strip only
 *  that key, so the rest of the text is still compared byte for byte with the 5b3edcc captures;
 *  the captures themselves stay untouched. Returns the text and whether a key was stripped. */
function stripCategories(s) {
  const obj = JSON.parse(s);
  if (!Object.prototype.hasOwnProperty.call(obj, 'categories')) return { text: s, stripped: false };
  const keys = Object.keys(obj);
  assert.strictEqual(keys[keys.length - 1], 'categories', '`categories` is the last key of the load payload');
  assert.ok(Array.isArray(obj.categories), '`categories` is an array');
  delete obj.categories;
  return { text: JSON.stringify(obj), stripped: true };
}

function testParityWithBeforeChange() {
  let stripped = 0;
  const got = captureAll(recentAck.loadServer, recentAck.EditableSheet, s => {
    assert.strictEqual(typeof s, 'string', 'the load calls return JSON strings');
    const r = stripCategories(s);
    if (r.stripped) stripped++;
    return r.text;
  });
  // getDashboardData() and getDashboardData({ sinceMonths: 13 }) per fixture carry `categories`.
  assert.strictEqual(stripped, 2 * Object.keys(EXPECTED).length, 'both getDashboardData responses carry `categories`');
  assert.deepStrictEqual(Object.keys(got), Object.keys(EXPECTED), 'every captured fixture is checked');
  Object.keys(EXPECTED).forEach(name => {
    const e = EXPECTED[name];
    const g = got[name];
    assert.strictEqual(g.olderFp, e.olderFp, name + ': olderFp equals 5b3edcc\'s');
    assert.strictEqual(g.loadedFp, e.loadedFp, name + ': loadedFp equals 5b3edcc\'s');
    assert.strictEqual(g.whole, e.whole, name + ': getDashboardData() is byte-identical to 5b3edcc\'s');
    assert.strictEqual(g.recent, e.recent, name + ': getDashboardData({ sinceMonths: 13 }) is byte-identical to 5b3edcc\'s');
    if (e.rest !== undefined) {
      assert.strictEqual(g.restOlderFp, e.restOlderFp, name + ': getTxnsBefore olderFp equals 5b3edcc\'s');
      assert.strictEqual(g.rest, e.rest, name + ': getTxnsBefore (matching loadedFp) is byte-identical to 5b3edcc\'s');
      assert.strictEqual(g.restStale, e.restStale, name + ': getTxnsBefore (stale loadedFp) is byte-identical to 5b3edcc\'s');
    } else {
      assert.strictEqual(g.rest, undefined, name + ': no partial list then, as before');
    }
  });
  // The moved-columns sheets really do move the columns the fingerprint hashes.
  assert.notStrictEqual(EXPECTED['recent_ack moved columns'].olderFp, EXPECTED.recent_ack.olderFp,
    'precondition: moving 我的消費 / 交易 ID changes the fingerprint');
}

/** The string payloads parse back to plain data: no Date anywhere (a Date would come back as a
 *  string), so the parsed object is exactly what an object response would have been. */
function testStringPayloadParse() {
  const rows = historySplit.fixtureRows('asc');
  const server = recentAck.loadServer(new recentAck.EditableSheet(rows));
  function plain(v, where) {
    assert.ok(!(v instanceof Date) && Object.prototype.toString.call(v) !== '[object Date]', where + ' is not a Date');
    if (v && typeof v === 'object') Object.keys(v).forEach(k => plain(v[k], where + '.' + k));
  }
  const responses = [server.getDashboardData(), server.getDashboardData({ sinceMonths: 13 })];
  const r = JSON.parse(responses[1]);
  responses.push(server.getTxnsBefore(r.before.y, r.before.m, r.loadedFp), server.getTxnsBefore(r.before.y, r.before.m, null));
  responses.forEach((s, i) => {
    assert.strictEqual(typeof s, 'string', 'response ' + i + ' is a string');
    const parsed = JSON.parse(s);
    plain(parsed, 'response ' + i);
    assert.strictEqual(JSON.stringify(parsed), s, 'response ' + i + ' round-trips exactly');
  });
}

const CASES = { testParityWithBeforeChange, testStringPayloadParse };

function run() {
  Object.keys(CASES).forEach(n => CASES[n]());
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_load_parity');
} else {
  module.exports = { run, CASES, scenarios, capture, captureAll };
}
