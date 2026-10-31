// =======================================================================
//   Weekly CFO — pure calculation and Gemini-safe wording
// =======================================================================
//
// This file deliberately has no SpreadsheetApp or LINE dependency. The Ledger facade reads the
// sheet once and passes plain values here; offline fixtures exercise this same production code.

var WCFO_TZ = 'Asia/Taipei';
var WCFO_BASE_FLOOR = '2025-10';
var WCFO_WEEK_HISTORY = 12;
var WCFO_MONTH_HISTORY = 12;
var WCFO_CATEGORY_MULTIPLIER = 1.5;
var WCFO_CATEGORY_MIN_EXCESS = 1000;
var WCFO_LARGE_MIN_AMOUNT = 3000;
var WCFO_LARGE_MULTIPLIER = 3;
var WCFO_NEW_MERCHANT_MIN_AMOUNT = 1000;
var WCFO_MAX_OBSERVATIONS = 2;

function wcfoDay_(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) throw new Error('reportDate must be YYYY-MM-DD');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (wcfoYmd_(d) !== m[0]) throw new Error('reportDate is not a calendar date');
  return d;
}

function wcfoYmd_(d) {
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

function wcfoAddDays_(d, n) { return new Date(d.getTime() + n * 86400000); }
function wcfoYm_(d) { return wcfoYmd_(d).slice(0, 7); }
function wcfoAddMonths_(key, n) {
  const p = key.split('-');
  const t = Number(p[0]) * 12 + Number(p[1]) - 1 + n;
  return Math.floor(t / 12) + '-' + ('0' + (t % 12 + 1)).slice(-2);
}
function wcfoDaysInMonth_(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function wcfoMedian_(values) {
  if (!values.length) return 0;
  const a = values.slice().sort(function (x, y) { return x - y; });
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}
function wcfoRound_(n) { return Math.round(Number(n) || 0); }

function wcfoTxnDate_(t) {
  if (t && /^\d{4}-\d{2}-\d{2}$/.test(String(t.date || ''))) return String(t.date);
  if (t && t.y && t.m && t.d) return t.y + '-' + ('0' + t.m).slice(-2) + '-' + ('0' + t.d).slice(-2);
  return '';
}

function wcfoIsConsumption_(t) {
  const cat = String((t && (t.cat != null ? t.cat : t.category)) || '').trim();
  return t && (t.type === '支出' || (t.type === '轉帳' && cat !== '' && cat !== '未分類'));
}
function wcfoIsRefund_(t) { return t && t.type === '收入' && String(t.cat || t.category || '') === '退款'; }
function wcfoCategory_(t) { return String((t && (t.cat != null ? t.cat : t.category)) || '未分類').trim() || '未分類'; }
function wcfoMerchantKey_(name) {
  return String(name || '').trim().replace(/[\d\s#*\-]+$/g, '').trim().slice(0, 20).toLocaleLowerCase();
}
function wcfoRowIdentity_(t, i) { return String((t && (t.rowId || t.id)) || ('row-' + i)); }

function wcfoIsoWeek_(monday) {
  const thursday = wcfoAddDays_(monday, 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const firstMonday = wcfoAddDays_(jan4, 1 - jan4Dow);
  const week = Math.floor((monday.getTime() - firstMonday.getTime()) / (7 * 86400000)) + 1;
  return year + '-W' + ('0' + week).slice(-2);
}

function wcfoNormalizeTransactions_(transactions, projectNames) {
  const projects = {};
  (projectNames || []).forEach(function (p) { projects[String(p.name != null ? p.name : p)] = true; });
  return (transactions || []).map(function (t, i) {
    const date = wcfoTxnDate_(t);
    const cat = wcfoCategory_(t);
    return {
      date: date,
      amount: Number(t.amount) || 0,
      merchant: String(t.merchant || '').trim() || '未命名交易',
      merchantKey: wcfoMerchantKey_(t.merchant),
      category: cat,
      type: String(t.type || '支出'),
      rowIdentity: wcfoRowIdentity_(t, i),
      consumption: wcfoIsConsumption_(t),
      refund: wcfoIsRefund_(t),
      project: !!projects[cat]
    };
  }).filter(function (t) { return /^\d{4}-\d{2}-\d{2}$/.test(t.date); });
}

function wcfoSum_(list) { return list.reduce(function (s, t) { return s + t.amount; }, 0); }
function wcfoIn_(t, start, end) { return t.date >= start && t.date <= end; }

function wcfoMonthlyTotals_(txns) {
  const out = {};
  txns.forEach(function (t) {
    const key = t.date.slice(0, 7);
    const o = out[key] || (out[key] = { gross: 0, refunds: 0, daily: 0, projects: {} });
    if (t.consumption) {
      if (t.project) o.projects[t.category] = (o.projects[t.category] || 0) + t.amount;
      else o.gross += t.amount;
    } else if (t.refund) o.refunds += t.amount;
  });
  Object.keys(out).forEach(function (k) { out[k].daily = out[k].gross - out[k].refunds; });
  return out;
}

function wcfoBaseline_(monthKey, monthly, setting) {
  setting = setting || { mode: 'median', amount: null };
  if (setting.mode === 'budget' && Number(setting.amount) > 0) {
    return { amount: wcfoRound_(setting.amount), source: 'budget', months: 0 };
  }
  const keys = [];
  for (let i = WCFO_MONTH_HISTORY; i >= 1; i--) {
    const key = wcfoAddMonths_(monthKey, -i);
    if (key >= WCFO_BASE_FLOOR) keys.push(key);
  }
  if (!keys.length) return null;
  const values = keys.map(function (k) { return monthly[k] ? monthly[k].daily : 0; });
  return { amount: wcfoRound_(wcfoMedian_(values)), source: 'median', months: keys.length };
}

function wcfoWeeklyCategoryBuckets_(txns, weekStart) {
  const buckets = [];
  for (let i = WCFO_WEEK_HISTORY; i >= 1; i--) {
    const start = wcfoAddDays_(weekStart, -7 * i);
    const end = wcfoAddDays_(start, 6);
    const cats = {};
    txns.forEach(function (t) {
      if (t.consumption && !t.project && wcfoIn_(t, wcfoYmd_(start), wcfoYmd_(end))) {
        cats[t.category] = (cats[t.category] || 0) + t.amount;
      }
    });
    buckets.push(cats);
  }
  return buckets;
}

function wcfoCandidateSort_(a, b) {
  return (b.excess - a.excess) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    String(a.rowIdentity || '').localeCompare(String(b.rowIdentity || '')) || String(a.type).localeCompare(String(b.type));
}

function wcfoCandidates_(txns, weekStart, weekEnd) {
  const ws = wcfoYmd_(weekStart), we = wcfoYmd_(weekEnd);
  const week = txns.filter(function (t) { return wcfoIn_(t, ws, we); });
  const daily = week.filter(function (t) { return t.consumption && !t.project; });
  const buckets = wcfoWeeklyCategoryBuckets_(txns, weekStart);
  const byCategory = {};
  daily.forEach(function (t) { (byCategory[t.category] || (byCategory[t.category] = [])).push(t); });
  const out = [];

  Object.keys(byCategory).forEach(function (cat) {
    const rows = byCategory[cat];
    const total = wcfoSum_(rows);
    const median = wcfoMedian_(buckets.map(function (b) { return b[cat] || 0; }));
    const excess = total - median;
    if (total > WCFO_CATEGORY_MULTIPLIER * median && excess >= WCFO_CATEGORY_MIN_EXCESS) {
      const named = rows.slice().sort(function (a, b) { return b.amount - a.amount || wcfoCandidateSort_(a, b); })[0];
      out.push({ type: 'category-anomaly', category: cat, amount: wcfoRound_(total), median: wcfoRound_(median),
        excess: wcfoRound_(excess), merchant: named.merchant, date: named.date, rowIdentity: named.rowIdentity,
        merchantKeys: named.merchantKey ? [named.merchantKey] : [] });
    }
  });

  const historyStart = wcfoYmd_(new Date(Date.UTC(weekStart.getUTCFullYear() - 1, weekStart.getUTCMonth(), weekStart.getUTCDate())));
  const historyEnd = wcfoYmd_(wcfoAddDays_(weekStart, -1));
  daily.forEach(function (t) {
    const history = txns.filter(function (h) {
      return h.consumption && !h.project && h.category === t.category && wcfoIn_(h, historyStart, historyEnd);
    }).map(function (h) { return h.amount; });
    const median = wcfoMedian_(history);
    if (t.amount >= WCFO_LARGE_MIN_AMOUNT && t.amount >= WCFO_LARGE_MULTIPLIER * median) {
      out.push({ type: 'large-charge', category: t.category, amount: wcfoRound_(t.amount), median: wcfoRound_(median),
        excess: wcfoRound_(t.amount - median), merchant: t.merchant, date: t.date, rowIdentity: t.rowIdentity,
        merchantKeys: t.merchantKey ? [t.merchantKey] : [] });
    }
    if (!t.merchantKey || t.amount < WCFO_NEW_MERCHANT_MIN_AMOUNT) return;
    const seen = txns.some(function (h) {
      return h.consumption && h.merchantKey === t.merchantKey && wcfoIn_(h, historyStart, historyEnd);
    });
    if (!seen) out.push({ type: 'new-merchant', category: t.category, amount: wcfoRound_(t.amount), median: 0,
      excess: wcfoRound_(t.amount), merchant: t.merchant, date: t.date, rowIdentity: t.rowIdentity,
      merchantKeys: [t.merchantKey] });
  });

  out.sort(wcfoCandidateSort_);
  const selected = [], usedRows = {}, usedMerchants = {};
  out.forEach(function (c) {
    if (selected.length >= WCFO_MAX_OBSERVATIONS || usedRows[c.rowIdentity]) return;
    if ((c.merchantKeys || []).some(function (k) { return usedMerchants[k]; })) return;
    selected.push(c);
    usedRows[c.rowIdentity] = true;
    (c.merchantKeys || []).forEach(function (k) { usedMerchants[k] = true; });
  });
  return selected;
}

/**
 * Pure calculator. `reportDate` is the Monday on which the report is sent; all calculations end
 * at the preceding Sunday. Transactions use the same plain shape returned to ToolPanel.html.
 */
function weeklyCfoCalculate(input) {
  input = input || {};
  const reportDate = wcfoDay_(input.reportDate);
  const dow = reportDate.getUTCDay() || 7;
  if (dow !== 1) throw new Error('reportDate must be Monday');
  const weekEnd = wcfoAddDays_(reportDate, -1);
  const weekStart = wcfoAddDays_(weekEnd, -6);
  const projects = input.projects || [];
  const txns = wcfoNormalizeTransactions_(input.transactions, projects);
  const ws = wcfoYmd_(weekStart), we = wcfoYmd_(weekEnd);
  const monthKey = wcfoYm_(weekEnd);
  const monthStart = monthKey + '-01';
  const monthRows = txns.filter(function (t) { return wcfoIn_(t, monthStart, we); });
  const weekRows = txns.filter(function (t) { return wcfoIn_(t, ws, we); });
  const weekDailyGross = wcfoSum_(weekRows.filter(function (t) { return t.consumption && !t.project; }));
  const weekRefunds = wcfoSum_(weekRows.filter(function (t) { return t.refund; }));
  const monthDailyGross = wcfoSum_(monthRows.filter(function (t) { return t.consumption && !t.project; }));
  const monthRefunds = wcfoSum_(monthRows.filter(function (t) { return t.refund; }));
  const projectTotal = wcfoSum_(weekRows.filter(function (t) { return t.consumption && t.project; }));
  const elapsedDays = weekEnd.getUTCDate();
  const monthDays = wcfoDaysInMonth_(weekEnd.getUTCFullYear(), weekEnd.getUTCMonth() + 1);
  const monthToDate = monthDailyGross - monthRefunds;
  const hasRecordedDailyConsumption = monthRows.some(function (t) { return t.consumption && !t.project; });
  const projection = elapsedDays > 0 && hasRecordedDailyConsumption ? wcfoRound_(monthToDate / elapsedDays * monthDays) : null;
  const monthly = wcfoMonthlyTotals_(txns);
  const baseline = wcfoBaseline_(monthKey, monthly, input.baseline);
  const observations = wcfoCandidates_(txns, weekStart, weekEnd);
  const subscriptionEvents = (input.verifiedSubscriptions || []).filter(function (e) { return e && e.verified === true; });
  const overspending = !!(projection != null && baseline && projection > baseline.amount);
  return {
    reportDate: wcfoYmd_(reportDate), weekKey: wcfoIsoWeek_(weekStart),
    week: { start: ws, end: we, daily: wcfoRound_(weekDailyGross - weekRefunds), refunds: wcfoRound_(weekRefunds), project: wcfoRound_(projectTotal) },
    month: { key: monthKey, elapsedDays: elapsedDays, daysInMonth: monthDays, daily: wcfoRound_(monthToDate), projection: projection },
    baseline: baseline,
    overspending: overspending,
    observations: observations,
    subscriptionEvents: subscriptionEvents
  };
}

function wcfoFormatNumber_(n) { return wcfoRound_(n).toLocaleString('en-US'); }

/** Deterministic Traditional-Chinese fallback. Every number comes from `facts`. */
function weeklyCfoFallbackCopy(facts) {
  let conclusion = '本週支出大致平穩';
  if (facts.overspending) conclusion = '照目前速度，本月可能超過日常比較基準';
  else if (facts.observations.length) conclusion = '本週有值得留意的消費變化';
  const explanations = facts.observations.map(function (o) {
    if (o.type === 'category-anomaly') return o.category + '本週 NT$' + wcfoFormatNumber_(o.amount) + '，主要來自' + o.merchant;
    if (o.type === 'large-charge') return o.merchant + '單筆 NT$' + wcfoFormatNumber_(o.amount) + '，高於這類平常金額';
    return '首次出現的商家' + o.merchant + '，本週 NT$' + wcfoFormatNumber_(o.amount);
  });
  return { conclusion: conclusion, explanations: explanations, source: 'computed' };
}

function wcfoNumericTokens_(text) {
  return (String(text || '').match(/-?\d[\d,]*(?:\.\d+)?%?/g) || []).map(function (s) {
    return s.replace(/,/g, '').replace(/%$/, '');
  });
}

const WCFO_CONCLUSION_MAX_CHARS = 60;
const WCFO_EXPLANATION_MAX_CHARS = 120;

/** All numeric tokens in Gemini output must occur in the serialized computed facts. */
function weeklyCfoValidateGeminiCopy(facts, copy) {
  if (!copy || typeof copy.conclusion !== 'string' || !Array.isArray(copy.explanations)) return false;
  if (copy.explanations.some(function (s) { return typeof s !== 'string'; })) return false;
  if (!copy.conclusion.trim() || copy.conclusion.length > WCFO_CONCLUSION_MAX_CHARS) return false;
  if (copy.explanations.some(function (s) { return !s.trim() || s.length > WCFO_EXPLANATION_MAX_CHARS; })) return false;
  const observations = Array.isArray(facts && facts.observations) ? facts.observations : [];
  if (!observations.length && copy.conclusion !== weeklyCfoFallbackCopy(facts).conclusion) return false;
  if (copy.explanations.length !== observations.length) return false;
  if (copy.explanations.some(function (text, i) {
    const merchant = String((observations[i] && observations[i].merchant) || '').trim();
    return !merchant || text.indexOf(merchant) < 0;
  })) return false;
  const allowed = {};
  wcfoNumericTokens_(JSON.stringify(facts)).forEach(function (n) { allowed[n] = true; });
  return wcfoNumericTokens_(copy.conclusion + '\n' + copy.explanations.join('\n')).every(function (n) { return !!allowed[n]; });
}
