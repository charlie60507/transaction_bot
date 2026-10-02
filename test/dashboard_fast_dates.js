'use strict';
/*
 * #62 replaced one Utilities.formatDate per row with arithmetic (ymdtFormatter_). The rule: the
 * arithmetic answer must equal formatDate's, or formatDate must have been used. This checks it
 * against an Intl-backed formatDate fake (Node's tz database knows Taiwan's daylight-saving years:
 * 1945-61, 1974-75, 1979), over random instants 1900-2100, exact CFG.TZ midnights, 23:59:59.999,
 * negative epochs and text dates, and pins WHICH path each row took:
 *   - instants before 1980-01-01 always take formatDate (a fixed offset would be wrong there);
 *   - instants from 1980 on take the arithmetic path whenever the two offset probes agree;
 *   - another CFG.TZ, or a runtime whose offsets disagree, takes formatDate for every row.
 */
process.env.TZ = 'Asia/Taipei';   // the Apps Script project's timezone: `new Date(text)` parses in it
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./extract_panel');

const SERVER = path.resolve(__dirname, '..', 'sidebar', '程式碼.js');
const FROM_1980 = Date.UTC(1980, 0, 1);

// Same fake as dashboard_txn_read's: honours the timezone through Intl.
function intlFormatDate(date, tz, pattern) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).forEach(p => { parts[p.type] = p.value; });
  const tokens = {
    yyyy: parts.year, M: String(Number(parts.month)), d: String(Number(parts.day)),
    HH: parts.hour.padStart(2, '0'), mm: parts.minute.padStart(2, '0'), ss: parts.second.padStart(2, '0')
  };
  return pattern.replace(/yyyy|HH|mm|ss|M|d/g, t => tokens[t]);
}

function load(opts) {
  opts = opts || {};
  const calls = { n: 0 };
  const formatDate = opts.formatDate || intlFormatDate;
  const sandbox = {
    Date,
    CFG: { TZ: opts.tz || 'Asia/Taipei', IDX_DATE: 2 },
    Utilities: { formatDate: (d, tz, p) => { calls.n++; return formatDate(d, tz, p); } }
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(SERVER, 'utf8');
  vm.runInContext(['rowYmdt_', 'ymdtFormatter_', 'tzOffsetAt_', 'hmFromHms_'].map(n => extractFunction(src, n)).join('\n'), sandbox);
  sandbox.calls = calls;
  return sandbox;
}

// Deterministic PRNG (mulberry32), so a failure reproduces.
function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const rowsOf = cells => cells.map(c => ['', '', c]);

/** Formats every cell through one ymdtFormatter_ and checks each against the Intl fake. Returns
 *  how many rows took the arithmetic path. */
function check(server, cells, now, label, expectFast) {
  const rows = rowsOf(cells);
  const fmt = server.ymdtFormatter_(rows, now);
  let fast = 0;
  cells.forEach((cell, i) => {
    const dt = cell instanceof Date ? cell : new Date(cell);
    if (isNaN(dt.getTime())) return;
    const before = server.calls.n;
    const got = Array.from(fmt(dt, i));
    const usedFormatDate = server.calls.n - before;
    const want = intlFormatDate(dt, 'Asia/Taipei', 'yyyy-M-d-HH:mm:ss').split('-');
    assert.deepStrictEqual(got, want, label + ': ' + dt.toISOString() + ' formats as formatDate does');
    if (dt.getTime() < FROM_1980) assert.strictEqual(usedFormatDate, 1, label + ': ' + dt.toISOString() + ' (before 1980) takes formatDate');
    else if (expectFast) assert.strictEqual(usedFormatDate, 0, label + ': ' + dt.toISOString() + ' takes the arithmetic path');
    else assert.strictEqual(usedFormatDate, 1, label + ': ' + dt.toISOString() + ' takes formatDate');
    if (!usedFormatDate) fast++;
  });
  return fast;
}

const NOW = new Date('2026-10-02T03:00:00Z');

function testPreconditions() {
  // The fake really has Taiwan's daylight-saving history, so a fixed +8 there WOULD be wrong.
  assert.strictEqual(intlFormatDate(new Date('1979-07-01T00:00:00Z'), 'Asia/Taipei', 'HH'), '09', 'summer 1979 is UTC+9');
  assert.strictEqual(intlFormatDate(new Date('1955-07-01T00:00:00Z'), 'Asia/Taipei', 'HH'), '09', 'summer 1955 is UTC+9');
  assert.strictEqual(intlFormatDate(new Date('1980-07-01T00:00:00Z'), 'Asia/Taipei', 'HH'), '08', 'summer 1980 is UTC+8');
}

function testRandomInstants() {
  const r = rng(62);
  const lo = Date.UTC(1900, 0, 1), hi = Date.UTC(2100, 0, 1);
  // Several batches, so the "earliest row" probe lands on different instants, each with a random now.
  for (let batch = 0; batch < 20; batch++) {
    const cells = [];
    for (let i = 0; i < 1500; i++) cells.push(new Date(Math.floor(lo + r() * (hi - lo))));
    const now = new Date(Math.floor(FROM_1980 + r() * (hi - FROM_1980)));
    const server = load();
    const fast = check(server, cells, now, 'random batch ' + batch, true);
    assert.ok(fast > 0, 'random batch ' + batch + ': the arithmetic path was exercised');
  }
}

function testDaylightSavingYears() {
  const r = rng(1979);
  const cells = [];
  [[1945, 1962], [1974, 1976], [1979, 1980]].forEach(([a, b]) => {
    const lo = Date.UTC(a, 0, 1), hi = Date.UTC(b, 0, 1);
    for (let i = 0; i < 3000; i++) cells.push(new Date(Math.floor(lo + r() * (hi - lo))));
  });
  // Every hour across the 1979 transitions and the 1979/1980 boundary.
  for (let t = Date.UTC(1979, 5, 28); t < Date.UTC(1979, 6, 3); t += 3600000) cells.push(new Date(t));
  for (let t = Date.UTC(1979, 8, 28); t < Date.UTC(1979, 9, 3); t += 3600000) cells.push(new Date(t));
  for (let t = Date.UTC(1979, 11, 31); t < Date.UTC(1980, 0, 2); t += 60000) cells.push(new Date(t));
  // A batch that also holds modern rows: the earliest-row probe skips everything before 1980.
  cells.push(new Date('2026-09-13T04:30:15Z'), new Date('1980-01-01T00:00:00Z'));
  check(load(), cells, NOW, 'daylight-saving years', true);
}

function testEdges() {
  const cells = [];
  // Exact CFG.TZ midnights (16:00 UTC the day before) and the last millisecond of a day, in many years.
  [1900, 1950, 1969, 1970, 1979, 1980, 1999, 2000, 2024, 2026, 2038, 2099].forEach(y => {
    cells.push(new Date(Date.UTC(y, 2, 9, 16, 0, 0)));          // 10 Mar 00:00:00 Taipei
    cells.push(new Date(Date.UTC(y, 2, 9, 15, 59, 59, 999)));   // 9 Mar 23:59:59.999 Taipei
    cells.push(new Date(Date.UTC(y, 11, 31, 16, 0, 0)));        // 1 Jan 00:00:00 Taipei (year boundary)
  });
  // Negative epochs.
  cells.push(new Date(-1), new Date(-1000), new Date(-86400000), new Date(-2208988800000));
  // Text dates, parsed in the script timezone first, exactly as every caller does.
  cells.push('2026-09-10T02:05:00Z', '2026/09/13 00:00:00', '1979/07/01 12:00:00', '1960-01-01T00:00:00', 'not a date', '');
  const server = load();
  check(server, cells, NOW, 'edges', true);
  // The midnight rule survives the arithmetic path: 00:00:00 means "no time".
  const fmt = server.ymdtFormatter_(rowsOf([new Date(Date.UTC(2026, 8, 12, 16))]), NOW);
  assert.strictEqual(server.hmFromHms_(fmt(new Date(Date.UTC(2026, 8, 12, 16)))[3]), '', 'a CFG.TZ midnight still reads as no time');
  assert.strictEqual(server.hmFromHms_(fmt(new Date(Date.UTC(2026, 8, 12, 16, 0, 30)))[3]), '00:00', 'thirty seconds past it does not');
  assert.deepStrictEqual(Array.from(fmt(new Date(Date.UTC(2026, 0, 1, 1, 2, 3)))), ['2026', '1', '1', '09:02:03'],
    'M and d unpadded, HH:mm:ss zero-padded');
}

function testProbeCostAndFallbacks() {
  const cells = [new Date('2026-09-13T04:30:15Z'), new Date('2025-01-01T00:00:00Z'), new Date('1990-05-05T05:05:05Z')];
  // Two probe calls per formatter, whatever the number of rows.
  let server = load();
  server.ymdtFormatter_(rowsOf(cells), NOW);
  assert.strictEqual(server.calls.n, 2, 'the offset is derived once: two formatDate calls');

  // No row from 1980 on: no probe, every row through formatDate.
  server = load();
  check(server, [new Date('1975-03-01T00:00:00Z'), new Date('1960-01-01T00:00:00Z')], NOW, 'all before 1980', false);

  // Another CFG.TZ: never arithmetic, no probe.
  server = load({ tz: 'America/New_York' });
  const fmtNy = server.ymdtFormatter_(rowsOf(cells), NOW);
  assert.strictEqual(server.calls.n, 0, 'another timezone: no probe');
  cells.forEach(dt => {
    const before = server.calls.n;
    assert.deepStrictEqual(Array.from(fmtNy(dt)), intlFormatDate(dt, 'America/New_York', 'yyyy-M-d-HH:mm:ss').split('-'), 'another timezone: formatDate\'s answer');
    assert.strictEqual(server.calls.n - before, 1, 'another timezone: formatDate per row');
  });

  // A runtime whose offset at "now" disagrees with the earliest row's: formatDate for every row.
  const skewed = (d, tz, p) => intlFormatDate(d.getTime() === NOW.getTime() ? new Date(d.getTime() + 3600000) : d, tz, p);
  server = load({ formatDate: skewed });
  const fmtSkew = server.ymdtFormatter_(rowsOf(cells), NOW);
  cells.forEach(dt => {
    const before = server.calls.n;
    fmtSkew(dt);
    assert.strictEqual(server.calls.n - before, 1, 'disagreeing probes: formatDate per row');
  });

  // A reply that does not parse (a stub returning a fixed text) is a disagreement too.
  server = load({ formatDate: () => 'garbage' });
  const fmtBad = server.ymdtFormatter_(rowsOf(cells), NOW);
  assert.deepStrictEqual(Array.from(fmtBad(cells[0])), ['garbage'], 'unparseable probe: formatDate per row');
}

const CASES = { testPreconditions, testRandomInstants, testDaylightSavingYears, testEdges, testProbeCostAndFallbacks };

function run() {
  Object.keys(CASES).forEach(n => CASES[n]());
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_fast_dates');
} else {
  module.exports = { run, CASES };
}
