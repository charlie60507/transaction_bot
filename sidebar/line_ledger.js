// =======================================================================
//   LINE ledger facade — the public library surface used by linebot/
// =======================================================================
//
// The `linebot` Apps Script project includes THIS project as a library (userSymbol `Ledger`,
// developmentMode) so that LINE-written rows go through the dashboard's own write and delete
// code and, above all, the dashboard's own script lock. A Lock taken by library code is the
// library's instance, so the import, the dashboard and LINE serialise on one lock; a copied
// writer in the other project would have taken a different lock.
//
// Library functions whose names end in `_` are invisible to includers, which is why this file
// exists: a small public facade over private helpers. `check_sidebar.js` verifies that every
// `Ledger.<fn>(` call in linebot/ resolves to a public function here.
//
// Every function that writes takes the dashboard script lock. Nothing here writes to META.

var LEDGER_TYPES_ = ['支出', '收入', '轉帳'];
var LEDGER_GEMINI_MODEL_ = 'gemini-2.5-flash';

/**
 * What the LINE side needs to resolve accounts and categories:
 *   accounts   — META!G in the owner's order, then the distinct 銀行 of the displayed rows in the
 *                dashboard picker's order (distinctBanks), de-duplicated case-insensitively;
 *   categories — META!D (種類清單);
 *   rules      — the META!A:B keyword rules, longest keyword first.
 */
function ledgerContext() {
  const ss = getSpreadsheet_();
  return {
    accounts: ledgerAccounts_(ss),
    categories: loadValidCategories_(ss),
    rules: loadCategoryRules_(ss).map(function (r) { return { keyword: r.keyword, category: r.category }; })
  };
}

/** The dashboard account picker's list, computed on the server. Mirrors ToolPanel.html's
 *  distinctBanks(): banks someone added by hand come first (most manual rows first), the rest
 *  by row count, ties in first-seen order; then META!G is put in front and the union is
 *  de-duplicated case-insensitively. */
function ledgerAccounts_(ss) {
  const configured = getAccountSources_(ss);
  const sh = ss.getSheetByName(CFG.DATA_SHEET);
  const names = [];
  if (sh && sh.getLastRow() > 1) {
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, CFG.IDX_MESSAGEID + 1).getValues();
    const all = {}, man = {}, seq = {};
    rows.forEach(function (row) {
      if (!isDisplayedTxn_(row)) return;
      const b = String(row[CFG.IDX_BANK] || '');
      if (!b) return;
      if (all[b] === undefined) { all[b] = 0; man[b] = 0; seq[b] = names.length; names.push(b); }
      all[b]++;
      if (String(row[CFG.IDX_MESSAGEID] || '').indexOf('manual-') === 0) man[b]++;
    });
    names.sort(function (a, b) {
      if ((man[a] > 0) !== (man[b] > 0)) return man[a] > 0 ? -1 : 1;
      const d = (man[a] > 0) ? man[b] - man[a] : all[b] - all[a];
      return d || seq[a] - seq[b];
    });
  }
  const seen = {};
  const out = [];
  configured.concat(names).forEach(function (name) {
    name = String(name || '').trim();
    const key = name.toLocaleLowerCase();
    if (name && !seen[key]) { seen[key] = true; out.push(name); }
  });
  return out;
}

/**
 * Parse one free-text LINE message into entries with Gemini, using the dashboard's
 * GEMINI_API_KEY. `todayYmd` is 'YYYY-MM-DD' in Asia/Taipei; `accounts` (optional) is the
 * candidate list, given to the model only so it can tell an account word from a merchant —
 * it is told to copy the account exactly as typed, and linebot/ re-checks that it did.
 *
 * Returns { entries: [{ date, time, amount, merchant, type, accountText }] }.
 * FAIL CLOSED: any HTTP error, timeout, missing key or unparseable output throws. This is the
 * opposite of the import's classifyWithGemini_, which may fail open because a missing
 * category is harmless; a guessed transaction is not.
 */
function ledgerParse(text, todayYmd, accounts) {
  text = String(text || '').trim();
  if (!text) throw new Error('empty message');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(todayYmd || ''))) throw new Error('todayYmd must be YYYY-MM-DD');
  const apiKey = CONFIG.geminiApiKey;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const prompt = ledgerPrompt_(text, todayYmd, accounts || []);
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + LEDGER_GEMINI_MODEL_ +
    ':generateContent?key=' + apiKey;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' }
    }),
    muteHttpExceptions: true
  });
  // The key is in the URL, so neither the URL nor the response body is ever logged.
  if (res.getResponseCode() !== 200) throw new Error('Gemini HTTP ' + res.getResponseCode());
  let body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { throw new Error('Gemini body is not JSON'); }
  const out = (((((body || {}).candidates || [])[0] || {}).content || {}).parts || [])[0];
  const raw = String((out && out.text) || '');
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Gemini output has no JSON object');
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch (e) { throw new Error('Gemini output is not valid JSON'); }
  if (!parsed || !Array.isArray(parsed.entries)) throw new Error('Gemini output has no entries array');
  return {
    entries: parsed.entries.map(function (e) {
      e = e || {};
      return {
        date: String(e.date == null ? '' : e.date).trim(),
        time: String(e.time == null ? '' : e.time).trim(),
        amount: e.amount,
        merchant: String(e.merchant == null ? '' : e.merchant).trim(),
        type: String(e.type == null ? '' : e.type).trim(),
        accountText: String(e.accountText == null ? '' : e.accountText).trim()
      };
    })
  };
}

function ledgerPrompt_(text, todayYmd, accounts) {
  return [
    '你是台灣個人記帳的解析器。把使用者的一則訊息拆成一筆或多筆交易。',
    '今天是 ' + todayYmd + '（Asia/Taipei）。「昨天」「前天」「上週五」等相對日期請換算成 YYYY-MM-DD；沒提到日期就是今天。',
    '只回覆 JSON，不要任何其他文字，格式：',
    '{"entries":[{"date":"YYYY-MM-DD","time":"HH:mm 或空字串","amount":數字,"merchant":"商店或說明","type":"支出|收入|轉帳","accountText":"帳戶原文或空字串"}]}',
    '規則：',
    '- 一則訊息可能有多筆（例如「午餐 180 晚餐 250」是兩筆），每筆各自一個物件。',
    '- amount 只能用訊息裡出現的阿拉伯數字，不可自行換算或猜測；找不到數字就填 null。',
    '- time 只有訊息明確寫出時間才填，否則填空字串，不要用現在時間。',
    '- type：薪水、退款、收到的錢是「收入」；自己帳戶之間移轉是「轉帳」；其他是「支出」。',
    '- accountText：訊息中代表付款帳戶或卡片的字，必須逐字照抄訊息原文，即使看起來像打錯字也不可更正；沒提到就填空字串。',
    '- 已知帳戶（僅供辨識哪個字是帳戶，不可拿來改寫原文）：' + (accounts.length ? accounts.join('、') : '（無）'),
    '',
    '訊息：',
    text
  ].join('\n');
}

/**
 * Category per merchant, in input order: the META keyword rules first (longest keyword first,
 * case-insensitive substring — matchCategory_), then the import's classifyWithGemini_ for the
 * rest. Anything not in META!D comes back as ''. Never writes a rule back to META.
 */
function ledgerCategorize(merchants) {
  merchants = (merchants || []).map(function (m) { return String(m || '').trim(); });
  const ss = getSpreadsheet_();
  const rules = loadCategoryRules_(ss);
  const valid = loadValidCategories_(ss);
  const validSet = {};
  valid.forEach(function (c) { validSet[c] = true; });
  const out = merchants.map(function (m) {
    const c = matchCategory_(m, rules);
    return (c && validSet[c]) ? c : '';
  });
  const ask = [];
  merchants.forEach(function (m, i) { if (!out[i] && m && ask.indexOf(m) === -1) ask.push(m); });
  if (ask.length && valid.length) {
    const ai = classifyWithGemini_(ask, valid) || {};
    merchants.forEach(function (m, i) {
      if (!out[i] && ai[m] && validSet[ai[m]]) out[i] = ai[m];
    });
  }
  return out;
}

/**
 * Write N entries in ONE locked call, each through addTxn's own row path, so a LINE row is a
 * dashboard manual row (manual-<uuid>, a fresh 交易 ID, ticked checkbox, date-ordered insert,
 * the no-time format). Every entry is validated before the first write, so a bad entry can
 * never leave the batch half-written.
 *
 * entries: [{ date:'YYYY-MM-DD', time:'HH:mm'|'', amount, type, account, merchant, cat }]
 * Returns, per written row: { rowId, bank, merchant, amount, cat, type, m, d }.
 */
function ledgerAdd(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('沒有要寫入的交易');
  entries.forEach(function (e, i) {
    const where = '第 ' + (i + 1) + ' 筆：';
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''))) throw new Error(where + '日期格式需為 YYYY-MM-DD');
    const time = String(e.time || '').trim();
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(where + '時間格式需為 HH:mm');
    const amount = Number(e.amount);
    if (!amount || amount <= 0) throw new Error(where + '金額需大於 0');
    if (LEDGER_TYPES_.indexOf(String(e.type || '支出')) === -1) throw new Error(where + '收支別不合法');
    if (!String(e.account || '').trim()) throw new Error(where + '缺少帳戶');
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(15 * 1000);
  try {
    const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
    if (!sh) throw new Error('找不到 Transactions 工作表');
    return entries.map(function (e) {
      const r = addTxn({
        date: e.date, time: String(e.time || '').trim(), amount: Number(e.amount),
        type: String(e.type || '支出'), source: String(e.account).trim(),
        merchant: String(e.merchant || ''), cat: String(e.cat || '')
      }, { sh: sh });
      return { rowId: r.rowId, bank: r.bank, merchant: r.merchant, amount: r.amount, cat: r.cat, type: r.type, m: r.m, d: r.d };
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Undo one LINE-written row by its 交易 ID through the dashboard delete path (copy to Deleted,
 * then delete), under the script lock. Returns 'deleted', 'already-deleted' or 'missing'.
 * No time limit: the row is found by its immutable id, never by row number.
 */
function ledgerUndo(rowId) {
  rowId = String(rowId || '').trim();
  if (!rowId) return 'missing';
  const lock = LockService.getScriptLock();
  lock.waitLock(15 * 1000);
  try {
    const ss = getSpreadsheet_();
    const sh = ss.getSheetByName(CFG.DATA_SHEET);
    if (!sh) throw new Error('找不到 Transactions 工作表');
    return deleteTxn(rowId, { ss: ss, sh: sh });
  } finally {
    lock.releaseLock();
  }
}
