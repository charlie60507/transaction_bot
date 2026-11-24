// =======================================================================
//   Subscriptions — pure detection of recurring monthly charges and their changes
// =======================================================================
//
// No SpreadsheetApp or LINE dependency, like weekly_cfo.js: callers pass plain transactions in
// the shape getDashboardData returns ({ y, m, d, hm, type, amount, cat, merchant, rowId }; a
// `date: 'YYYY-MM-DD'` field is accepted instead of y / m / d). The three public functions are
// reachable from linebot/ through the `Ledger` library.
//
// ToolPanel.html carries a copy of the functions from SUB_FLOOR down to subscriptionDetect (the
// page recomputes the 定期訂閱 panel and the month-end estimate from its own rows after every
// in-page edit, and Apps Script cannot serve this file to the page). test/dashboard_subscriptions.js
// requires the two copies to be textually identical and to return identical output.
//
// Rules (the settled definitions of the subscription-change issue):
//   - input: consumption rows (支出, or 轉帳 with a category other than blank / 未分類) dated
//     SUB_FLOOR or later, at their displayed amount (my consumption when split);
//   - merchant key: subscriptionKey();
//   - qualifying triple: 3 consecutive charges of one key, every amount within ±5% of the
//     triple's median, both gaps 26–35 days;
//   - active as of D (charges dated ≤ D only): a qualifying triple among the key's last 6
//     charges, and D ≤ newest charge + newest gap + 7 days;
//   - a dismissed key is not a subscription anywhere.
// Day counts are calendar-day differences of the already-localised y/m/d, never timestamps.

var SUB_FLOOR = '2025-10-01';
var SUB_KEY_LEN = 20;
var SUB_TOLERANCE_PCT = 5;
var SUB_GAP_MIN = 26;
var SUB_GAP_MAX = 35;
var SUB_GRACE_DAYS = 7;
var SUB_WINDOW = 6;

/** The merchant key: trimmed, a trailing run of digits, whitespace and #*- stripped, trimmed
 *  again, first 20 characters; case preserved. When fewer than 2 characters remain, the trimmed
 *  original's first 20 characters instead, so a reference code such as X12345 never becomes X. */
function subscriptionKey(merchant) {
  var s = String(merchant == null ? '' : merchant).trim();
  var k = Array.from(s.replace(/[\d\s#*\-]+$/, '').trim()).slice(0, SUB_KEY_LEN).join('');
  return Array.from(k).length < 2 ? Array.from(s).slice(0, SUB_KEY_LEN).join('') : k;
}

function subDay_(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) throw new Error('date must be YYYY-MM-DD');
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

function subYmd_(t) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(t.date || ''))) return String(t.date);
  if (t.y && t.m && t.d) return t.y + '-' + ('0' + t.m).slice(-2) + '-' + ('0' + t.d).slice(-2);
  return '';
}

function subIsConsumption_(t) {
  var cat = String(t.cat || '').trim();
  return t.type === '支出' || (t.type === '轉帳' && cat !== '' && cat !== '未分類');
}

/** Whether `amount` lies within ±5% of `ref`, in integer-safe arithmetic. */
function subNear_(amount, ref) {
  return Math.abs(amount - ref) * 100 <= ref * SUB_TOLERANCE_PCT;
}

/** Charges per key, each list ordered by date, then time, then row id, then input order.
 *  Dismissed keys (trimmed, exact match) are left out entirely. */
function subCharges_(transactions, dismissed) {
  var skip = {};
  (dismissed || []).forEach(function (k) {
    k = String(k == null ? '' : k).trim();
    if (k) skip[k] = true;
  });
  var byKey = {};
  var keys = [];
  (transactions || []).forEach(function (t, i) {
    if (!t || !subIsConsumption_(t)) return;
    var ymd = subYmd_(t);
    if (!ymd || ymd < SUB_FLOOR) return;
    var key = subscriptionKey(t.merchant);
    if (!key || skip[key]) return;
    if (!byKey[key]) { byKey[key] = []; keys.push(key); }
    byKey[key].push({ day: subDay_(ymd), date: ymd, hm: String(t.hm || ''), id: String(t.rowId || t.id || ''), seq: i,
      amount: Number(t.amount) || 0, name: String(t.merchant == null ? '' : t.merchant).trim() });
  });
  keys.forEach(function (k) {
    byKey[k].sort(function (a, b) {
      if (a.day !== b.day) return a.day - b.day;
      if (a.hm !== b.hm) return a.hm < b.hm ? -1 : 1;
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return a.seq - b.seq;
    });
  });
  keys.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  return { byKey: byKey, keys: keys };
}

/** The median of the triple starting at charges[i] when it qualifies, else 0. */
function subTriple_(charges, i) {
  var a = [charges[i].amount, charges[i + 1].amount, charges[i + 2].amount].sort(function (x, y) { return x - y; });
  var med = a[1];
  if (!(med > 0) || !subNear_(a[0], med) || !subNear_(a[2], med)) return 0;
  var g1 = charges[i + 1].day - charges[i].day;
  var g2 = charges[i + 2].day - charges[i + 1].day;
  if (g1 < SUB_GAP_MIN || g1 > SUB_GAP_MAX || g2 < SUB_GAP_MIN || g2 > SUB_GAP_MAX) return 0;
  return med;
}

/** One key's state as of day `day`, counting only charges dated on or before it: null when no
 *  qualifying triple exists among its last 6 charges, otherwise the most recent qualifying
 *  triple's start index and median (the reference), the newest and previous charge, the newest
 *  gap, and whether the key is active. */
function subStateAt_(charges, day) {
  var n = 0;
  while (n < charges.length && charges[n].day <= day) n++;
  if (n < 3) return null;
  var from = Math.max(0, n - SUB_WINDOW);
  for (var i = n - 3; i >= from; i--) {
    var ref = subTriple_(charges, i);
    if (!ref) continue;
    var last = charges[n - 1];
    var prev = charges[n - 2];
    var gap = last.day - prev.day;
    return { n: n, triple: i, reference: ref, last: last, prev: prev, gap: gap,
      active: day <= last.day + gap + SUB_GRACE_DAYS };
  }
  return null;
}

/** The active, non-dismissed subscriptions as of `asOf` ('YYYY-MM-DD'), largest amount first:
 *  { subscriptions: [{ key, name, amount, reference, lastDate }] }. `name` is the newest charge's
 *  merchant text, `amount` the newest charge's amount, `reference` the median of the most recent
 *  qualifying triple. */
function subscriptionDetect(input) {
  input = input || {};
  var day = subDay_(input.asOf);
  var c = subCharges_(input.transactions, input.dismissed);
  var out = [];
  c.keys.forEach(function (key) {
    var s = subStateAt_(c.byKey[key], day);
    if (s && s.active) {
      out.push({ key: key, name: s.last.name, amount: s.last.amount, reference: s.reference, lastDate: s.last.date });
    }
  });
  out.sort(function (a, b) { return (b.amount - a.amount) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0); });
  return { subscriptions: out };
}

var SUB_EVENT_ORDER = { missed: 0, price: 1, 'new': 2 };

/**
 * The change events of one report week, weekStart..weekEnd inclusive ('YYYY-MM-DD'). Each event
 * fires only in the week in which it happens, so nothing has to remember what was already sent:
 *   missed — active at the end of the previous week, not active at the end of this one, and no
 *            charge inside the week (the deadline, previous charge + last gap + 7 days, passed);
 *   price  — the newest charge is inside the week, is not part of the most recent qualifying
 *            triple, comes 26–35 days after the previous charge, differs from the reference by
 *            more than 5%, and the previous charge was within 5% of it (so it fires once);
 *   new    — active at the end of the week and not at the end of the previous week (a stopped
 *            subscription that comes back is new again).
 * Returns [{ type, key, name, amount, reference, date }]: for `missed`, `amount` and `date` are
 * the last charge seen; otherwise the newest charge.
 */
function subscriptionWeekEvents(input) {
  input = input || {};
  var ws = subDay_(input.weekStart);
  var we = subDay_(input.weekEnd);
  if (we < ws) throw new Error('weekEnd is before weekStart');
  var c = subCharges_(input.transactions, input.dismissed);
  var events = [];
  c.keys.forEach(function (key) {
    var charges = c.byKey[key];
    var before = subStateAt_(charges, ws - 1);
    var after = subStateAt_(charges, we);
    var was = !!(before && before.active);
    var is = !!(after && after.active);
    var inWeek = charges.some(function (x) { return x.day >= ws && x.day <= we; });
    function ev(type, s) {
      return { type: type, key: key, name: s.last.name, amount: s.last.amount, reference: s.reference, date: s.last.date };
    }
    if (was && !is && !inWeek) events.push(ev('missed', before));
    if (is && !was) events.push(ev('new', after));
    if (is && after.last.day >= ws && after.n - 1 > after.triple + 2 &&
        after.gap >= SUB_GAP_MIN && after.gap <= SUB_GAP_MAX &&
        !subNear_(after.last.amount, after.reference) && subNear_(after.prev.amount, after.reference)) {
      events.push(ev('price', after));
    }
  });
  events.sort(function (a, b) {
    return (SUB_EVENT_ORDER[a.type] - SUB_EVENT_ORDER[b.type]) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  });
  return events;
}
