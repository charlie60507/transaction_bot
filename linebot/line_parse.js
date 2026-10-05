// =======================================================================
//   Pure helpers for the LINE webhook — no Apps Script service is touched
// =======================================================================
//
// Everything here is offline-testable (test/linebot_parse.js): entry validation, account
// resolution, the duplicate hint, reply text and postback encoding. linebot.js owns the I/O.

var LP_TYPES = ['支出', '收入', '轉帳'];
var LP_DEFAULT_ACCOUNT = '現金';
// Accounts the Gmail import writes on its own (the banks its parsers cover).
var LP_AUTO_IMPORTED = ['國泰', '富邦'];
var LP_DUP_HINT = '這張卡會自動匯入，可能重複';
// 13 quick-reply items is LINE's limit; the last one is always 取消.
var LP_MAX_CHOICES = 12;
var LP_EXAMPLE = '中信 午餐 拉麵 180';

/** Every number written in the message, with thousands separators removed. */
function lpNumbersIn(text) {
  const plain = String(text || '').replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  const out = [];
  const re = /\d+(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(plain))) out.push(Number(m[0]));
  return out;
}

function lpValidYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const p = String(s).split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

/**
 * Validate Gemini's entries against the message they came from.
 *
 * The whole message is "not understood" ({ ok:false }) when there are no entries, or when ANY
 * entry lacks an amount that is literally present in the message as digits — a missing amount
 * suggests the split itself is wrong, so nothing is guessed. A bad date or type is treated the
 * same way. Otherwise returns { ok:true, entries } with normalised fields.
 *
 * accountText is kept only if it occurs in the message (case-insensitive). If the model
 * returned an account the owner never typed (for example a silently "corrected" 重信 → 中信),
 * the entry is marked accountMismatch so it is treated as unmatched and asked about, never
 * written to the corrected account.
 */
function lpValidateEntries(entries, text) {
  if (!Array.isArray(entries) || !entries.length) return { ok: false };
  const numbers = lpNumbersIn(text);
  const lowerText = String(text || '').toLocaleLowerCase();
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] || {};
    const amount = typeof e.amount === 'number' ? e.amount
      : (typeof e.amount === 'string' && /^\d+(?:\.\d+)?$/.test(e.amount.replace(/,/g, '')) ? Number(e.amount.replace(/,/g, '')) : NaN);
    if (!(amount > 0) || numbers.indexOf(amount) === -1) return { ok: false };
    const date = String(e.date || '').trim();
    if (!lpValidYmd(date)) return { ok: false };
    let time = String(e.time || '').trim();
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) time = '';
    const type = String(e.type || '').trim() || '支出';
    if (LP_TYPES.indexOf(type) === -1) return { ok: false };
    const accountText = String(e.accountText || '').trim();
    const occurs = !accountText || lowerText.indexOf(accountText.toLocaleLowerCase()) !== -1;
    out.push({
      date: date, time: time, amount: amount,
      merchant: String(e.merchant || '').trim().slice(0, 100),
      type: type, accountText: accountText, accountMismatch: !occurs
    });
  }
  return { ok: true, entries: out };
}

/**
 * Resolve an entry's account against the candidate list. Literal only: exact,
 * case-insensitive, after trimming. No account named → 現金.
 * Returns { kind:'matched'|'default', account } or { kind:'unmatched' }.
 */
function lpResolveAccount(entry, candidates) {
  const typed = String(entry.accountText || '').trim();
  if (!typed) return { kind: 'default', account: LP_DEFAULT_ACCOUNT };
  if (entry.accountMismatch) return { kind: 'unmatched' };
  const want = typed.toLocaleLowerCase();
  for (let i = 0; i < candidates.length; i++) {
    if (String(candidates[i]).trim().toLocaleLowerCase() === want) return { kind: 'matched', account: candidates[i] };
  }
  return { kind: 'unmatched' };
}

function lpEditDistance(a, b) {
  a = Array.from(String(a || '').toLocaleLowerCase());
  b = Array.from(String(b || '').toLocaleLowerCase());
  let prev = [];
  for (let j = 0; j <= b.length; j++) prev.push(j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The account buttons to offer. Up to 12 candidates are shown in list order; a longer list is
 * ranked by edit distance to what was typed (ties keep list order) and cut to 12, with
 * truncated:true so the reply can say how to reach the rest.
 */
function lpChoices(typed, candidates) {
  const list = candidates.slice();
  if (list.length <= LP_MAX_CHOICES) return { shown: list, truncated: false };
  const ranked = list.map(function (name, i) { return { name: name, i: i, d: lpEditDistance(typed, name) }; })
    .sort(function (x, y) { return (x.d - y.d) || (x.i - y.i); });
  return { shown: ranked.slice(0, LP_MAX_CHOICES).map(function (r) { return r.name; }), truncated: true };
}

function lpIsAutoImported(account) {
  return LP_AUTO_IMPORTED.indexOf(String(account || '').trim()) !== -1;
}

/** `已記：<帳戶>｜<商店>｜$<金額>｜<種類或未分類>｜<M/D>`, plus the duplicate hint when due. */
function lpWrittenLine(row) {
  const line = '已記：' + row.bank + '｜' + (row.merchant || '（無說明）') + '｜$' + row.amount + '｜' +
    (row.cat || '未分類') + '｜' + row.m + '/' + row.d;
  return lpIsAutoImported(row.bank) ? line + '（' + LP_DUP_HINT + '）' : line;
}

function lpNotUnderstoodText() {
  return '看不懂這則訊息，沒有記帳。請照這樣傳：' + LP_EXAMPLE;
}

function lpErrorText() {
  return '記帳失敗：目前無法解析訊息，沒有寫入任何資料。請稍後再傳一次。';
}

/**
 * Prompt for one unmatched entry. When the model's account text does not occur in the message
 * (accountMismatch: it "corrected" a typo such as 重信 to 中信), that text is never echoed, so
 * the prompt cannot suggest an account the owner did not type.
 */
function lpPendingText(entry, truncated) {
  const what = entry.accountMismatch ? '找不到訊息中的帳戶' : '找不到帳戶「' + entry.accountText + '」';
  const head = what + '：' + (entry.merchant || '（無說明）') + ' $' + entry.amount +
    '。請選擇帳戶，或按「取消」。';
  return truncated ? head + '\n（只列出最接近的 ' + LP_MAX_CHOICES + ' 個；其他帳戶請照清單上的名稱重新傳送。）' : head;
}

// ---- postback data (LINE caps it at 300 characters) ----------------------

function lpEncodeUndo(rowId) { return 'undo:' + rowId; }
function lpEncodePick(token, index) { return 'pick:' + token + ':' + index; }
function lpEncodeCancel(token) { return 'cancel:' + token; }

/** Decode postback data, or null when it is not one of ours. */
function lpDecodePostback(data) {
  data = String(data || '');
  let m = /^undo:([A-Za-z0-9-]{1,64})$/.exec(data);
  if (m) return { action: 'undo', rowId: m[1] };
  m = /^pick:([A-Za-z0-9]{8}):(\d{1,2})$/.exec(data);
  if (m) return { action: 'pick', token: m[1], index: Number(m[2]) };
  m = /^cancel:([A-Za-z0-9]{8})$/.exec(data);
  if (m) return { action: 'cancel', token: m[1] };
  return null;
}
