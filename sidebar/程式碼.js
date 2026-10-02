// =================== ⚙️ 設定區域 ===================

const CFG = {
  SPREADSHEET_ID: '1PZfUiqaMeUHHSBi8zqEPnEgBfFXqTxKwhnQUltCb8VU',
  DATA_SHEET: 'Transactions',
  // Load-bearing, not an archive: the bot treats these rows as already-seen so a
  // deleted auto-record does not come back on the next 7-day scan. Deleting the
  // tab resurrects anything still inside that window.
  DELETED_SHEET: 'Deleted',
  META_SHEET: 'META',
  META_ACCOUNT_COL: 7,      // G: 帳戶清單 (F stays a visual spacer)
  META_ACCOUNT_HEADER: '帳戶清單',
  TZ: 'Asia/Taipei',

  // Transactions column indices (0-based)
  IDX_POSTED: 0,           // A: 已記帳 (checkbox)
  IDX_BANK: 1,
  IDX_DATE: 2,
  IDX_LAST4: 3,
  IDX_AMOUNT: 4,
  IDX_MERCHANT: 5,
  IDX_CATEGORY_AUTO: 6,    // G: 類別 (auto-parsed from email)
  IDX_LINK: 7,
  IDX_MESSAGEID: 8,        // I: MessageId (stable per-row key)
  IDX_INOUT: 9,            // J: 收支別 ("收入"/"支出"/"轉帳"; blank ⇒ 支出)
  IDX_CATEGORY_MANUAL: 10, // K: 種類(手動) — primary category

  // 我的消費: how much of the charge was actually MY consumption; blank ⇒ all of it.
  // Located by HEADER NAME, never by a fixed index. Absent header ⇒ the feature is
  // simply inert and every row reads as "all mine", i.e. exactly today's behaviour.
  HDR_MINE: '我的消費',
  HDR_ROW_ID: '交易 ID',
};

// =======================================================================
//   Menu + Web App entry
// =======================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('交易工具')
    .addItem('開啟面板', 'showPanelLauncher')
    .addToUi();
}

/** Web App entry: serve the dashboard page (injects real NOW in sheet TZ + sheet URL). */
function doGet(e) {
  const t = HtmlService.createTemplateFromFile('ToolPanel');
  t.now = nowYMD_();
  t.sheetUrl = getSpreadsheet_().getUrl();
  return t.evaluate()
    .setTitle('交易工具')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Current Y/M/D in the configured timezone, for injecting into the page. */
function nowYMD_() {
  const now = new Date();
  return {
    year:  Number(Utilities.formatDate(now, CFG.TZ, 'yyyy')),
    month: Number(Utilities.formatDate(now, CFG.TZ, 'M')),
    day:   Number(Utilities.formatDate(now, CFG.TZ, 'd'))
  };
}

/**
 * Legacy composite identifier retained for display compatibility and pre-migration fixtures.
 *
 * MessageId alone is NOT unique: a Cathay 消費彙整通知 carries several transactions and the
 * bot stamps the SAME message id on every row it produces (measured: 389 of 1017 rows share
 * an id, 130 groups, the largest 12 rows). Locating a row by message id therefore always hit
 * the FIRST row of the group, so edits to any later row silently landed on the wrong
 * transaction — 259 rows were effectively uneditable.
 *
 * New dashboard mutations use the persistent UUID in `交易 ID`. This composite can be
 * renumbered after an edit/delete and must never be used as an authoritative row identity.
 */
function txnKey_(row, occurrence) {
  const dt = row[CFG.IDX_DATE];
  const t = dt instanceof Date ? dt.getTime() : String(dt || '');
  return [String(row[CFG.IDX_MESSAGEID] || ''), t, String(row[CFG.IDX_AMOUNT] || ''),
          String(row[CFG.IDX_LAST4] || ''), String(occurrence || 0)].join('|');
}

/**
 * Normalize a composite key as it arrives from google.script.run.
 *
 * The id is `messageId|timestamp|amount|last4|occurrence`. A single string
 * argument containing `|` can arrive as an Array (one element per segment);
 * `String(array)` then comma-joins, matching nothing and throwing 找不到.
 * updateTxn never hits this because it already passes (id, patch) — two
 * arguments. Reconstruct with `|` if we got an Array; unwrap `{id}` if the
 * page sent an object.
 */
function asTxnKey_(key) {
  if (Array.isArray(key)) return key.map(function (p) { return String(p); }).join('|');
  if (key && typeof key === 'object' && key.id != null) return asTxnKey_(key.id);
  return String(key == null ? '' : key);
}

/** Same skip getAllTxns uses: blank / unparseable dates are not transactions.
 *  findRowByKey_ must skip them too, or occurrence numbers disagree — this sheet
 *  has hundreds of trailing rows whose only content is an unchecked checkbox. */
function isDisplayedTxn_(row) {
  const raw = row[CFG.IDX_DATE];
  const dt = raw instanceof Date ? raw : new Date(raw);
  return !isNaN(dt.getTime());
}

function getRowIdColIndex_(sh) {
  const cols = sh ? sh.getLastColumn() : 0;
  if (!cols) return -1;
  const headers = sh.getRange(1, 1, 1, cols).getValues()[0];
  for (let i = 0; i < headers.length; i++) if (String(headers[i] || '').trim() === CFG.HDR_ROW_ID) return i;
  return -1;
}

/** Create and backfill the immutable row UUID used by every dashboard mutation. Caller holds lock. */
function ensureRowIdColIndex_(sh) {
  let idx = getRowIdColIndex_(sh);
  // Offline fixtures intentionally omit UUID support and retain the legacy composite-key path.
  if (typeof Utilities === 'undefined' || typeof Utilities.getUuid !== 'function') return -1;
  if (idx === -1) {
    idx = sh.getLastColumn();
    sh.getRange(1, idx + 1).setValue(CFG.HDR_ROW_ID);
  }
  const count = Math.max(0, sh.getLastRow() - 1);
  if (!count) return idx;
  // Only two columns decide this: the date (is the row displayed?) and the id itself. Reading
  // the full width here made every open and every edit pay for the whole sheet once more.
  const dates = sh.getRange(2, CFG.IDX_DATE + 1, count, 1).getValues();
  const current = sh.getRange(2, idx + 1, count, 1).getValues();
  const probe = [];                               // row-like array so isDisplayedTxn_ stays the one rule
  var changed=false;
  const ids = current.map((cell, i) => {
    const id=String(cell[0] || '');
    probe[CFG.IDX_DATE] = dates[i][0];
    if(id||!isDisplayedTxn_(probe)) return [id];
    changed=true; return [Utilities.getUuid()];
  });
  if(changed){ sh.getRange(2, idx + 1, count, 1).setValues(ids); SpreadsheetApp.flush(); }
  return idx;
}

/**
 * Row number for an immutable `交易 ID`. The legacy composite fallback exists only before the
 * UUID column is migrated; once UUIDs exist, stale occurrence keys fail safely.
 * Returns -1 when nothing matches. `rows` is an optional read of the sheet the caller already
 * holds (row 2 onward, full width), so a caller that needs the rows too reads them once.
 */
function findRowByKey_(sh, key, rows) {
  key = asTxnKey_(key);
  if (!rows) {
    const last = sh.getLastRow();
    if (last <= 1) return -1;
    rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  }
  const rowIdIdx = getRowIdColIndex_(sh);
  if (rowIdIdx !== -1) {
    for (let i = 0; i < rows.length; i++) if (String(rows[i][rowIdIdx] || '') === key) return i + 2;
    // Once immutable UUIDs exist, never reinterpret an old occurrence key: a deleted duplicate
    // can hand that string to its successor. An old open tab must fail safely and reload.
    return -1;
  }
  const parts = key.split('|');
  if (parts.length < 5) {
    for (let i = 0; i < rows.length; i++) {
      if (!isDisplayedTxn_(rows[i])) continue;
      if (String(rows[i][CFG.IDX_MESSAGEID]) === key) return i + 2;
    }
    return -1;
  }
  const seen = {};
  for (let i = 0; i < rows.length; i++) {
    if (!isDisplayedTxn_(rows[i])) continue;
    const base = txnKey_(rows[i], 0).split('|').slice(0, 4).join('|');
    const n = seen[base] = (seen[base] === undefined ? 0 : seen[base] + 1);
    if (txnKey_(rows[i], n) === key) return i + 2;
  }
  return -1;
}

/**
 * Occurrence number of `row` among the displayed rows sharing its base key, counting the rows
 * already passed through `seen`. The base key is the composite id without its occurrence.
 */
function nextOccurrence_(seen, row) {
  const base = txnKey_(row, 0).split('|').slice(0, 4).join('|');
  return seen[base] = (seen[base] === undefined ? 0 : seen[base] + 1);
}

/**
 * The one row-to-object mapping every transaction payload uses (the full list and the recent
 * edit acknowledgement), so the two can never disagree about a field.
 * `ymdt` is the row's date already formatted once in CFG.TZ as 'yyyy-M-d-HH:mm:ss', split on '-'.
 */
function txnFromRow_(row, ymdt, occurrence, mineIdx, rowIdIdx) {
  const inout = String(row[CFG.IDX_INOUT] || '').trim();
  const type = inout === '轉帳' ? '轉帳' : (inout === '收入' ? '收入' : '支出');
  const isTransfer = type === '轉帳';
  // A transfer is money moved between the user's own accounts — identified
  // ONLY by the 收支別 (J) column reading '轉帳', never by the merchant
  // category. Anything else transferred out still counts as normal spend.
  return {
    y: Number(ymdt[0]),
    m: Number(ymdt[1]),
    d: Number(ymdt[2]),
    // Preformatted 'HH:mm' rather than a timestamp: the page holds no timezone knowledge
    // (its only clock is NOW, injected by doGet as already-localised numbers), and
    // lexicographic order on 'HH:mm' IS chronological order with '' sorting first — which
    // is exactly where a row with no known time belongs. See rowHM_ for what "no time" means.
    hm: hmFromHms_(ymdt[3]),
    type: type,
    // Expense `amount` is MY CONSUMPTION, already netted of anything fronted for other
    // people. A transfer has no personal-consumption meaning, so it always keeps the raw
    // amount and ignores any stale value in that column. Normalising here rather than in the
    // page is deliberate: every one of the dashboard's dozen aggregation sites sums t.amount.
    // `charged` keeps the real card amount for display; `mine` is the raw cell so the
    // editor knows whether the row is split at all (null ⇒ not split).
    amount: isTransfer ? (Number(row[CFG.IDX_AMOUNT]) || 0) : rowMine_(row, mineIdx),
    charged: Number(row[CFG.IDX_AMOUNT]) || 0,
    mine: (isTransfer || mineIdx === -1 || row[mineIdx] === '' || row[mineIdx] === null || row[mineIdx] === undefined)
      ? null : (isNaN(Number(row[mineIdx])) ? null : Number(row[mineIdx])),
    cat: rowCategory_(row) || '未分類',
    merchant: String(row[CFG.IDX_MERCHANT] || ''),
    bank: String(row[CFG.IDX_BANK] || ''),
    last4: String(row[CFG.IDX_LAST4] || ''),
    link: String(row[CFG.IDX_LINK] || ''),
    // `id` remains the legacy composite for display/tests; `rowId` is the mutation identity.
    id: txnKey_(row, occurrence),
    rowId: rowIdIdx === -1 ? '' : String(row[rowIdIdx] || ''),
    posted: row[CFG.IDX_POSTED] === true
  };
}

/** A displayed row's date formatted once in CFG.TZ, split into [y, M, d, 'HH:mm:ss'].
 *  One formatDate per row: four separate calls per row were ~22k Java-bridge round trips per
 *  open at 5.5k rows. */
function rowYmdt_(dt) {
  return Utilities.formatDate(dt, CFG.TZ, 'yyyy-M-d-HH:mm:ss').split('-');
}

/** Flat array of ALL transactions for the client-side dashboard.
 *  Fat-frontend: NO aggregation here — the v5 page does all of it. */
function getAllTxns() {
  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  if (!sh || sh.getLastRow() <= 1) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const mineIdx = getMineColIndex_(sh);          // -1 if no 我的消費 header
  const rowIdIdx = getRowIdColIndex_(sh);         // -1 only for legacy/offline fixtures
  return txnsFromRows_(rows, mineIdx, rowIdIdx);
}

/** getAllTxns' list from rows already read (row 2 onward, full width), in sheet order. */
function txnsFromRows_(rows, mineIdx, rowIdIdx) {
  const out = [];
  const seenKey = {};
  for (const row of rows) {
    const raw = row[CFG.IDX_DATE];
    const dt = raw instanceof Date ? raw : new Date(raw);
    if (isNaN(dt.getTime())) continue;           // skip blank / unparseable rows
    out.push(txnFromRow_(row, rowYmdt_(dt), nextOccurrence_(seenKey, row), mineIdx, rowIdIdx));
  }
  return out;
}

/** The whole list plus the fingerprint of its rows older than the edit window (see
 *  olderFingerprint_), from ONE read. Every response that hands the page a whole list carries
 *  both, so the page always knows which older rows its next incremental ack may keep. */
function txnSnapshot_(sh, now) {
  if (!sh || sh.getLastRow() <= 1) return { txns: [], olderFp: null };
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const mineIdx = getMineColIndex_(sh);
  const rowIdIdx = getRowIdColIndex_(sh);
  const since = recentSince_(now);
  return {
    txns: txnsFromRows_(rows, mineIdx, rowIdIdx),
    olderFp: olderFingerprint_(rows, rowDays_(rows, since), since, mineIdx, rowIdIdx)
  };
}

/** First day of the recent edit-acknowledgement window: today minus 14 days in CFG.TZ, as
 *  {y, m, d}. 14 days covers the dynamic refresh with room to spare: the bot only appends
 *  transactions from its 7-day Gmail scan and dates them by authorization time, filtering out
 *  anything dated outside those 7 days, so every row it appended is inside the window. */
function recentSince_(now) {
  const DAYS = 14;
  const p = Utilities.formatDate(now, CFG.TZ, 'yyyy-M-d').split('-');
  // Calendar arithmetic only: the CFG.TZ date is already decided, so UTC carries no zone here.
  const s = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) - DAYS));
  return { y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, d: s.getUTCDate() };
}

/**
 * Which side of the window starting at `since` (CFG.TZ day) each row falls on: null for a row
 * that is not displayed (the same skip as getAllTxns), false for a row dated before `since`, and
 * the row's rowYmdt_ parts for a row inside the window.
 *
 * Rows clearly older than the window skip the formatDate bridge call entirely. UTC midnight of
 * `since` minus two days precedes CFG.TZ midnight of `since` in every timezone (offsets stay
 * within -12h..+14h); rows past that bound get the exact CFG.TZ day test.
 */
function rowDays_(rows, since) {
  const sinceKey = since.y * 10000 + since.m * 100 + since.d;
  const coarseMs = Date.UTC(since.y, since.m - 1, since.d) - 2 * 86400000;
  return rows.map(function (row) {
    const raw = row[CFG.IDX_DATE];
    const dt = raw instanceof Date ? raw : new Date(raw);
    if (isNaN(dt.getTime())) return null;
    if (dt.getTime() < coarseMs) return false;
    const ymdt = rowYmdt_(dt);
    return Number(ymdt[0]) * 10000 + Number(ymdt[1]) * 100 + Number(ymdt[2]) >= sinceKey ? ymdt : false;
  });
}

/**
 * Fingerprint of the displayed rows dated before `since`: the part of the list an incremental
 * acknowledgement does NOT resend, so the page can prove its copy of it is still the sheet's.
 *
 * It covers everything a full reload derives from those rows: every cell of every older row in
 * sheet order (so an edit, add, delete or reorder among them changes it), the 我的消費 and
 * 交易 ID column positions (they decide `amount`, `mine` and `rowId` without any row changing),
 * and `since` itself. `since` is load-bearing: once the window moves forward a day, rows the page
 * last received INSIDE the window count as older without a fingerprint ever having covered them,
 * so yesterday's fingerprint must never match today's. Whole rows rather than the displayed
 * fields on purpose: a cell no field reads costs at most one needless full list, while a missed
 * field would be a silently stale screen.
 *
 * cyrb53 (two 32-bit multiply lanes, 53 bits out) in plain JS rather than Utilities.computeDigest:
 * no bridge call and no byte-array conversion over ~5.5k rows, and the offline tests compute the
 * very same value. It detects change; it is not a security boundary, and a false match would need
 * a collision that also coincides with a real change.
 */
function olderFingerprint_(rows, days, since, mineIdx, rowIdIdx) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  function feed(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
  }
  feed([since.y, since.m, since.d, mineIdx, rowIdIdx].join('|'));
  for (let i = 0; i < rows.length; i++) {
    if (days[i] === false) feed('\u001e' + rows[i].map(fingerprintCell_).join('\u001f'));
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return String(4294967296 * (2097151 & h2) + (h1 >>> 0));
}

/** A cell as the fingerprint sees it: typed, and a Date by its instant rather than its
 *  zone-dependent text, so `1` vs `'1'` and a re-entered date both count as changes. */
function fingerprintCell_(v) {
  if (v instanceof Date) return 'd' + v.getTime();
  return (typeof v).charAt(0) + String(v);
}

/**
 * The incremental edit acknowledgement. Caller holds the lock and has flushed. `rows` is
 * updateTxn's one PRE-write read of the sheet (row 2 onward, full width), `rowNum` the edited
 * row, `clientFp` the olderFp of the list the page last adopted.
 *
 *   fingerprint matches → { ok, recent: { since, txns, olderBefore }, changed, olderFp }
 *   anything else       → { ok, txns, olderFp }, the whole list
 * (also the whole list when an older edit renumbers its siblings; see renumbersOlderSiblings_)
 *
 * The recent shape carries every displayed row dated on or after `since` (in CFG.TZ), plus the
 * edited row whatever its date. The page keeps its own copy of every older row, which is right
 * only while nothing else has changed them since its last list: another tab or device, a direct
 * sheet edit, or a manual add from this very page dated before the window (addTxn adopts no list,
 * so it never advances the page's fingerprint). So the page's fingerprint is compared with the
 * PRE-write sheet: this edit's own change can never cause a mismatch, any other change since the
 * page's last list always does, and a mismatch sends the whole list — a reload's result either
 * way. A tab that predates `clientFp` sends none and simply gets the whole list. `olderFp` is
 * the fingerprint of the older rows as they now stand, i.e. of exactly the list the page will
 * hold once it has merged this response.
 *
 * Building the response from the pre-write read with the edited row read back is exact, and it
 * saves a second full read: updateTxn writes only that one row and never its date (so no row
 * changes sides), and the bot appends under the same script lock. The exception is an edit that
 * created the 我的消費 column, which widens every row; that one-off re-reads the whole sheet.
 *
 * `olderBefore[i]` is how many displayed rows dated BEFORE `since` precede `txns[i]` in the
 * sheet. With it the page splices the window back exactly where the full list has it, whatever
 * the sheet's order (the bot's SORT_ORDER may be ASC, DESC or NONE, and a hand-typed text date
 * sorts after every real date) — instead of assuming the window is a suffix.
 *
 * Composite `id`s equal the full list's without numbering the whole sheet. The base key that
 * `occurrence` counts within (txnKey_ minus its last segment) INCLUDES the raw date cell — the
 * exact timestamp for a Date, the raw text otherwise — so every row sharing a base key has the
 * identical date and therefore falls on the same CFG.TZ day. A window made of whole days thus
 * holds either all of a base key's rows or none of them, in sheet order, and numbering only the
 * window rows reproduces the full list's numbers. The edited row outside the window is numbered
 * the same way, among the rows sharing its base key; when the edit moved it into or out of a
 * group, the rows it renumbered go back with the whole list instead.
 *
 * A sheet without the `交易 ID` column (offline fixtures only; updateTxn backfills it in
 * production) cannot locate the edited row by identity, so it gets the full list instead, in the
 * `txns` shape the page already adopts.
 */
function recentAck_(sh, rows, rowNum, clientFp, now) {
  const rowIdIdx = getRowIdColIndex_(sh);
  if (rowIdIdx === -1) return { ok: true, txns: getAllTxns() };
  const width = rows[0].length;
  if (sh.getLastColumn() !== width) return Object.assign({ ok: true }, txnSnapshot_(sh, now));
  const mineIdx = getMineColIndex_(sh);
  const since = recentSince_(now);
  const days = rowDays_(rows, since);
  const preFp = olderFingerprint_(rows, days, since, mineIdx, rowIdIdx);
  const editedIdx = rowNum - 2;
  const before = rows[editedIdx];
  rows[editedIdx] = sh.getRange(rowNum, 1, 1, width).getValues()[0];
  // A window row is not part of the fingerprint, so only an older edited row changes it.
  const olderFp = days[editedIdx] === false ? olderFingerprint_(rows, days, since, mineIdx, rowIdIdx) : preFp;
  if (clientFp == null || String(clientFp) !== preFp || renumbersOlderSiblings_(rows, days, editedIdx, before)) {
    return { ok: true, txns: txnsFromRows_(rows, mineIdx, rowIdIdx), olderFp: olderFp };
  }
  const txns = [];
  const olderBefore = [];
  const seenKey = {};
  let older = 0;
  let changed = null;
  for (let i = 0; i < rows.length; i++) {
    if (days[i] === null) continue;              // same skip as getAllTxns
    if (days[i] === false) { older++; continue; }
    const t = txnFromRow_(rows[i], days[i], nextOccurrence_(seenKey, rows[i]), mineIdx, rowIdIdx);
    txns.push(t);
    olderBefore.push(older);
    if (i === editedIdx) changed = t;
  }
  if (days[editedIdx] === false) {
    // Older than the window: number it among the earlier rows sharing its base key, all of
    // which carry its exact date (see above).
    const row = rows[editedIdx];
    const raw = row[CFG.IDX_DATE];
    const seen = {};
    for (let i = 0; i < editedIdx; i++) if (days[i] !== null) nextOccurrence_(seen, rows[i]);
    changed = txnFromRow_(row, rowYmdt_(raw instanceof Date ? raw : new Date(raw)),
      nextOccurrence_(seen, row), mineIdx, rowIdIdx);
  }
  return { ok: true, recent: { since: since, txns: txns, olderBefore: olderBefore }, changed: changed, olderFp: olderFp };
}

/**
 * True when an edit to a row older than the window changes the composite ids of OTHER older rows,
 * which the recent shape does not carry. 金額 is part of the base key, so an amount edit moves the
 * row out of its same-day duplicate group (its later siblings shift down: |1 → |0) or into
 * another one (the rows after it shift up). An occurrence counts only EARLIER rows, so exactly the
 * displayed rows AFTER the edited one that share its old or new base key are renumbered; rows
 * before it, and the edited row itself (numbered in `changed`), are not. recentAck_ then sends
 * the whole list, which renumbers exactly as a reload does. Duplicate groups are rare, and the
 * last member of a group leaving it renumbers nothing, so this costs little.
 */
function renumbersOlderSiblings_(rows, days, editedIdx, before) {
  if (days[editedIdx] !== false) return false;   // window rows are renumbered with the window
  function base(row) { return txnKey_(row, 0).split('|').slice(0, 4).join('|'); }
  const oldBase = base(before);
  const newBase = base(rows[editedIdx]);
  if (oldBase === newBase) return false;
  for (let i = editedIdx + 1; i < rows.length; i++) {
    if (days[i] === null) continue;
    const b = base(rows[i]);
    if (b === oldBase || b === newBase) return true;
  }
  return false;
}

/** Initial dashboard payload. Account settings travel with the transaction snapshot so
 *  the add dialog never has to race a second request during boot. */
function getDashboardData() {
  const lock = LockService.getScriptLock();
  lock.waitLock(15 * 1000);
  try {
    const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
    if (sh) ensureRowIdColIndex_(sh);
    const snap = txnSnapshot_(sh, new Date());
    return { txns: snap.txns, olderFp: snap.olderFp, accounts: getAccountSources_() };
  } finally {
    lock.releaseLock();
  }
}

/** Read configured account/source names from META!G, preserving the owner's order. */
function getAccountSources_() {
  const sh = getSpreadsheet_().getSheetByName(CFG.META_SHEET);
  if (!sh || sh.getLastColumn() < CFG.META_ACCOUNT_COL || sh.getLastRow() <= 1) return [];
  const header = String(sh.getRange(1, CFG.META_ACCOUNT_COL).getValue() || '').trim();
  if (header !== CFG.META_ACCOUNT_HEADER) return [];
  const values = sh.getRange(2, CFG.META_ACCOUNT_COL, sh.getLastRow() - 1, 1).getValues();
  const seen = {};
  const out = [];
  values.forEach(function (row) {
    const name = String(row[0] || '').trim();
    const key = name.toLocaleLowerCase();
    if (name && !seen[key]) { seen[key] = true; out.push(name); }
  });
  return out;
}

/** Add one source to META without creating a fake transaction. Returns the full configured
 *  list so the client can adopt the authoritative spelling and order immediately. */
function addAccountSource(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('請輸入帳戶名稱');
  if (name.length > 50) throw new Error('帳戶名稱不可超過 50 字');

  const lock = LockService.getScriptLock();
  lock.waitLock(15 * 1000);
  try {
    const sh = getSpreadsheet_().getSheetByName(CFG.META_SHEET);
    if (!sh) throw new Error('找不到 META 工作表');

    const col = CFG.META_ACCOUNT_COL;
    const existingHeader = String(sh.getRange(1, col).getValue() || '').trim();
    if (existingHeader && existingHeader !== CFG.META_ACCOUNT_HEADER) {
      throw new Error('META!G 已有其他設定，無法建立帳戶清單');
    }
    if (!existingHeader) sh.getRange(1, col).setValue(CFG.META_ACCOUNT_HEADER);

    const last = Math.max(sh.getLastRow(), 1);
    const values = last > 1 ? sh.getRange(2, col, last - 1, 1).getValues() : [];
    const wanted = name.toLocaleLowerCase();
    let lastAccountRow = 1;
    for (let i = 0; i < values.length; i++) {
      const current = String(values[i][0] || '').trim();
      if (current) lastAccountRow = i + 2;
      if (current.toLocaleLowerCase() === wanted) return getAccountSources_();
    }
    sh.getRange(lastAccountRow + 1, col).setValue(name);
    SpreadsheetApp.flush();
    return getAccountSources_();
  } finally {
    lock.releaseLock();
  }
}

/** Transaction types that may correct the displayed amount in the shared editor. */
function isAmountCorrectionType_(type) {
  return ['支出', '轉帳'].indexOf(type) !== -1;
}

/**
 * Write edits back to one Transactions row, located by immutable `交易 ID`.
 * `patch` may contain any of:
 *   merchant -> F (交易內容/商店; the row title shown in the heatmap day list)
 *   cat    -> K (種類手動; leaves auto G untouched)
 *   type   -> J (收支別; must be 支出/收入/轉帳)
 *   mine   -> 我的消費 column (by header); '' or null clears it (⇒ whole charge is mine)
 *   amount -> raw 金額 for transfers; displayed amount for expenses (我的消費 when split)
 *   posted -> A (已記帳 checkbox; boolean)
 * Returns { ok:true }; throws a clear error the frontend surfaces.
 *
 * `wantTxns` is opt-in and OFF by default, so the call sites that ignore the return value
 * (the split editor, the per-day bulk post) are byte-for-byte unaffected. When it is set the
 * ack carries authoritative data in the same call, so an edit is one round trip instead of
 * two — a write can no longer succeed and then be reverted by a failed refetch:
 *   true     → `{ ok, txns }`, the whole list exactly as `getAllTxns` returns it.
 *   'recent' → `{ ok, recent, changed, olderFp }` (see recentAck_): only the rows dated in the
 *              last 14 days plus the edited row. The page merges that into its list; the window
 *              still brings in rows the bot appended since the page loaded, which is why the ack
 *              exists at all, without shipping the whole history on every edit. `olderFp` is
 *              the fingerprint the page holds for its rows older than the window; when the sheet
 *              no longer matches it, the ack is `{ ok, txns, olderFp }`, the whole list.
 * `SpreadsheetApp.flush()` first, exactly as `deleteTxn` does: without it the read can return
 * a snapshot taken before this call's own setValue landed, and the page would then correctly
 * conclude "nothing changed" about a value the server disagrees with.
 */
function updateTxn(messageId, patch, wantTxns, olderFp) {
  messageId = asTxnKey_(messageId);
  if (!messageId) throw new Error('缺少 MessageId');
  patch = patch || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(15 * 1000);
  try {
  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  if (!sh) throw new Error('找不到 Transactions 工作表');
  ensureRowIdColIndex_(sh);
  const last = sh.getLastRow();
  if (last <= 1) throw new Error('沒有交易資料');

  // The 'recent' ack is built from this same pre-write read (see recentAck_); every other mode
  // leaves the read to findRowByKey_ exactly as before.
  const rows = wantTxns === 'recent' ? sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues() : null;
  const rowNum = findRowByKey_(sh, messageId, rows);
  if (rowNum === -1) throw new Error('找不到該筆交易 (key=' + messageId + ')');

  const editsAmount = 'amount' in patch;
  const editsMine = 'mine' in patch;
  const rowType = (editsAmount || editsMine)
    ? String(sh.getRange(rowNum, CFG.IDX_INOUT + 1).getValue() || '支出').trim()
    : null;

  if (editsAmount) {
    const amount = Number(patch.amount);
    if (!isFinite(amount) || amount <= 0) throw new Error('金額需大於 0');
    if (!isAmountCorrectionType_(rowType)) throw new Error('只有支出或轉帳交易可以修正金額');
  }
  if (editsMine && rowType === '轉帳') throw new Error('轉帳交易不能設定我的消費');

  if ('merchant' in patch) {
    sh.getRange(rowNum, CFG.IDX_MERCHANT + 1).setValue(String(patch.merchant || ''));
  }
  if ('cat' in patch) {
    sh.getRange(rowNum, CFG.IDX_CATEGORY_MANUAL + 1).setValue(String(patch.cat || ''));
  }
  if ('type' in patch) {
    const t = String(patch.type || '');
    if (['支出', '收入', '轉帳'].indexOf(t) === -1) throw new Error('收支別不合法: ' + t);
    sh.getRange(rowNum, CFG.IDX_INOUT + 1).setValue(t);
  }
  if (editsAmount) {
    // A transfer always corrects raw 金額 without consulting 我的消費. For expenses, the
    // displayed amount is 我的消費 on split rows and raw 金額 on ordinary rows, preserving
    // the existing destination and leaving a split row's charged amount untouched.
    const mineIdx = rowType === '支出' ? getMineColIndex_(sh) : -1;
    const currentMine = mineIdx === -1 ? '' : sh.getRange(rowNum, mineIdx + 1).getValue();
    const amountIdx = rowType === '支出' && mineIdx !== -1 && currentMine !== '' && currentMine !== null && currentMine !== undefined
      ? mineIdx : CFG.IDX_AMOUNT;
    sh.getRange(rowNum, amountIdx + 1).setValue(Number(patch.amount));
  }
  if (editsMine) {
    const mineIdx = ensureMineColIndex_(sh);
    const raw = patch.mine;
    if (raw === '' || raw === null || raw === undefined) {
      sh.getRange(rowNum, mineIdx + 1).setValue('');   // clears the split
    } else {
      const v = Number(raw);
      if (isNaN(v) || v < 0) throw new Error('我的消費需為 0 以上的數字');
      // Deliberately NOT capped at the charge: someone else fronting part of my share
      // makes my consumption legitimately larger than what my card was charged.
      sh.getRange(rowNum, mineIdx + 1).setValue(v);
    }
  }
  if ('posted' in patch) {
    sh.getRange(rowNum, CFG.IDX_POSTED + 1).setValue(!!patch.posted);
  }
  if (wantTxns) {
    SpreadsheetApp.flush();
    if (wantTxns === 'recent') return recentAck_(sh, rows, rowNum, olderFp, new Date());
    return { ok: true, txns: getAllTxns() };
  }
  return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Append a manually-entered transaction (cash / non-email sources). Gets a
 * synthetic `manual-<uuid>` MessageId (col I) so it can be edited/deleted like
 * any row and never collides with the bot's dedup. 已記帳 (A) defaults to true.
 * fields: { date:'YYYY-MM-DD', time:'HH:mm'|'', amount, type, source, merchant, cat }
 * `time` is optional — cash is often recorded without caring what time it was. Returns the
 * mapped txn (same shape as getAllTxns) for optimistic UI.
 */
function addTxn(fields) {
  fields = fields || {};
  if (!fields.date) throw new Error('缺少日期');
  const time = String(fields.time || '').trim();
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('時間格式需為 HH:mm');
  const amount = Number(fields.amount);
  if (!amount || amount <= 0) throw new Error('金額需大於 0');
  const type = String(fields.type || '支出');
  if (['支出', '收入', '轉帳'].indexOf(type) === -1) throw new Error('收支別不合法');

  const lock = LockService.getScriptLock();
  lock.waitLock(15 * 1000);
  try {
  const sh = getSpreadsheet_().getSheetByName(CFG.DATA_SHEET);
  if (!sh) throw new Error('找不到 Transactions 工作表');
  const rowIdIdx = ensureRowIdColIndex_(sh);
  const ncol = sh.getLastColumn();
  const id = 'manual-' + Utilities.getUuid();
  const source = String(fields.source || '現金');
  const cat = String(fields.cat || '');
  // No time given ⇒ midnight, which the dashboard reads back as "no time" (rowHM_) and which
  // sorts first in its day, exactly like the legacy date-only rows. This replaces a hardcoded
  // 12:00:00, a fabricated value that wedged every manual entry into the middle of the day's
  // chronological order. Defaulting to "now" would be worse still: cash is typically recorded
  // hours after the fact, so "now" is a plausible-looking lie and harder to spot than a blank.
  const dt = new Date(fields.date + 'T' + (time || '00:00') + ':00');

  const row = new Array(ncol).fill('');
  const rowId = (rowIdIdx === -1) ? '' : Utilities.getUuid();
  row[CFG.IDX_POSTED] = true;
  row[CFG.IDX_BANK] = source;
  row[CFG.IDX_DATE] = dt;
  row[CFG.IDX_AMOUNT] = amount;
  row[CFG.IDX_MERCHANT] = String(fields.merchant || '');
  row[CFG.IDX_MESSAGEID] = id;
  row[CFG.IDX_INOUT] = type;
  row[CFG.IDX_CATEGORY_MANUAL] = cat;
  if (rowIdIdx !== -1) row[rowIdIdx] = rowId;

  // Insert into the date-ordered position rather than appending, so the sheet stays
  // sorted and the new row sits among its own time period.
  const pos = insertPositionForDate_(sh, dt);
  const rowNum = pos.row;
  const checkboxValidation = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  // Build everything the response needs before the persistent write. Once setValues succeeds,
  // there must be no later validation/formatting step that can turn a committed transaction into
  // an apparent failure and invite the user to add the same purchase again.
  const result = {
    y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(),
    hm: rowHM_(dt),
    type: type, amount: amount, charged: amount, mine: null, cat: cat || '未分類',
    merchant: String(fields.merchant || ''),
    bank: source, last4: '', link: '',
    id: txnKey_(row, 0), rowId: rowId, posted: true
  };
  if (!pos.appending) sh.insertRowBefore(rowNum);
  // The format follows the value: a date-only row must not display 00:00:00 in the sheet —
  // that is the same lie the dashboard refuses to tell, told in the other app instead. Display
  // only; nothing ever reads this format back to decide whether a row has a time.
  sh.getRange(rowNum, CFG.IDX_DATE + 1)
    .setNumberFormat(time ? 'yyyy/mm/dd hh:mm:ss' : 'yyyy/mm/dd');
  sh.getRange(rowNum, CFG.IDX_POSTED + 1).setDataValidation(checkboxValidation);
  sh.getRange(rowNum, 1, 1, ncol).setValues([row]);
  return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Deleted sheet: create on first use, copying Transactions headers. If it already
 * exists but is narrower than the source (Transactions later gained a column), copy
 * only the extra header cells so a human note on Deleted is not overwritten.
 */
function getOrCreateDeleted_(ss, src) {
  let del = ss.getSheetByName(CFG.DELETED_SHEET);
  const srcCols = Math.max(src.getLastColumn(), 1);
  if (!del) {
    del = ss.insertSheet(CFG.DELETED_SHEET);
    del.getRange(1, 1, 1, srcCols).setValues(src.getRange(1, 1, 1, srcCols).getValues());
    return del;
  }
  if (del.getLastRow() === 0) {
    del.getRange(1, 1, 1, srcCols).setValues(src.getRange(1, 1, 1, srcCols).getValues());
    return del;
  }
  const have = del.getLastColumn();
  if (have < srcCols) {
    del.getRange(1, have + 1, 1, srcCols - have)
      .setValues(src.getRange(1, have + 1, 1, srcCols - have).getValues());
  }
  return del;
}

/** Delete any row, located by immutable `交易 ID`. Moves it to Deleted first so the
 *  bot still treats the mail as already handled (the sheet is its only memory).
 *
 *  Returns `{ ok, txns, olderFp }` (see txnSnapshot_) so the page does not need a nested
 *  getAllTxns, and its next incremental edit ack can keep the older rows it now holds. Nesting
 *  google.script.run after a successful write was the false 找不到 toast: the
 *  row was already gone, then a second lookup (retry or refresh) failed. */
function deleteTxn(messageId) {
  messageId = asTxnKey_(messageId);
  const lock = LockService.getScriptLock();
  lock.waitLock(15 * 1000);
  try {
    const ss = getSpreadsheet_();
    const sh = ss.getSheetByName(CFG.DATA_SHEET);
    if (!sh) throw new Error('找不到 Transactions 工作表');
    ensureRowIdColIndex_(sh);
    const last = sh.getLastRow();
    if (last <= 1) throw new Error('沒有交易資料');
    const rowNum = findRowByKey_(sh, messageId);
    if (rowNum === -1) {
      // Already moved (double-tap / retry after a successful write). Do not
      // throw 找不到 — the sheet is in the state the owner asked for.
      const del = ss.getSheetByName(CFG.DELETED_SHEET);
      const migrated = getRowIdColIndex_(sh) !== -1;
      if (del && (sheetHasRowId_(del, messageId) || (!migrated && sheetHasBaseKey_(del, messageId)))) {
        SpreadsheetApp.flush();
        return Object.assign({ ok: true }, txnSnapshot_(sh, new Date()));
      }
      throw new Error('找不到該筆交易 (key=' + messageId + ')');
    }
    const cols = sh.getLastColumn();
    const row = sh.getRange(rowNum, 1, 1, cols).getValues()[0];
    const destSheet = getOrCreateDeleted_(ss, sh);
    const dest = Math.max(destSheet.getLastRow() + 1, 2);
    destSheet.getRange(dest, 1, 1, cols).setValues([row]);
    sh.deleteRow(rowNum);
    SpreadsheetApp.flush();
    return Object.assign({ ok: true }, txnSnapshot_(sh, new Date()));
  } finally {
    lock.releaseLock();
  }
}

function sheetHasRowId_(sh, key) {
  const idx=getRowIdColIndex_(sh);
  if(idx===-1||sh.getLastRow()<=1) return false;
  const values=sh.getRange(2,idx+1,sh.getLastRow()-1,1).getValues();
  return values.some(row => String(row[0]||'')===String(key));
}

/** True if Deleted already holds a row with the same base key (id without occurrence). */
function sheetHasBaseKey_(sh, key) {
  if (!sh || sh.getLastRow() <= 1) return false;
  const parts = asTxnKey_(key).split('|');
  if (parts.length < 4) return false;
  const want = parts.slice(0, 4).join('|');
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (!isDisplayedTxn_(rows[i])) continue;
    const base = txnKey_(rows[i], 0).split('|').slice(0, 4).join('|');
    if (base === want) return true;
  }
  return false;
}

/** Web App URL of the user's live deployment.
 *  Hardcoded on purpose: ScriptApp.getService().getUrl() returns an
 *  unpredictable/stale deployment URL when the project has multiple
 *  deployments, which makes the menu open an invalid link (Drive's
 *  "can't open this file"). This is the deployment the user actually uses. */
function getWebAppUrl() {
  return 'https://script.google.com/macros/s/AKfycbyvVvKPI45Y5zooV9VbzYSN_54EWqQTqjsE6bJPTgBpfvcdJZ13YIynh3rBKdRM3bKaag/exec';
}

/** Menu action: dialog with a clickable link that opens the Web App in a new tab */
function showPanelLauncher() {
  const url = getWebAppUrl();
  let html;
  if (!url) {
    html = HtmlService.createHtmlOutput(
      '<p style="font-family:-apple-system,sans-serif;padding:16px;color:#333">' +
      '尚未部署為網頁應用程式。請先在編輯器：部署 → 新增部署 → 網頁應用程式。</p>'
    ).setWidth(380).setHeight(150);
  } else {
    html = HtmlService.createHtmlOutput(
      '<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:22px;text-align:center">' +
      '<p style="margin-bottom:16px;color:#333">在新分頁開啟交易工具面板：</p>' +
      '<a href="' + url + '" target="_blank" rel="noopener" ' +
      'style="display:inline-block;background:#1a73e8;color:#fff;text-decoration:none;padding:11px 24px;border-radius:10px;font-weight:600">開啟面板 ↗</a>' +
      '<p style="margin-top:14px;color:#999;font-size:12px">多帳號若開不了，請用無痕視窗只登入擁有者帳號。</p>' +
      '</div>'
    ).setWidth(400).setHeight(180);
  }
  SpreadsheetApp.getUi().showModalDialog(html, '交易工具');
}

// =======================================================================
//   Shared helpers
// =======================================================================

/** The target spreadsheet (Web App has no active spreadsheet → open by id). */
function getSpreadsheet_() {
  return SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
}

/**
 * Category value for a row: 種類(手動) (K) ONLY.
 *
 * 類別 (G) is NOT a category, it is raw parse output from the email, and it deliberately does
 * not reach the display any more. Measured on 1019 live rows: 482 had both columns filled and
 * ZERO of them agreed, because G speaks the bank's vocabulary (超市∕量販, 交通∕運輸,
 * 家電∕３Ｃ通訊) while K speaks the owner's (超市, 交通, 個人) — two taxonomies on one axis.
 * G's single most common value was `註一`, a footnote marker, and five of its values were bare
 * amounts. Falling back to it meant 73 rows displayed bank vocabulary and the category picker
 * offered 24 options where only 10 were ever chosen.
 *
 * Rows with no manual category now read as 未分類, which is visible and fixable in the
 * 待記帳 queue, rather than silently mislabelled. G stays in the sheet as evidence and as the
 * source a future auto-fill suggestion could read.
 */
function rowCategory_(row) {
  return String(row[CFG.IDX_CATEGORY_MANUAL] || '').trim();
}

/**
 * Timestamp of a column-C cell, or NaN when it holds no usable date. Dates normally
 * arrive as Date objects, but a hand-typed cell can come back as a string — both must
 * count, and both callers below must agree on what counts, or the row that bounds the
 * data and the row that decides ordering can disagree about the same cell.
 */
function cellDateTime_(v) {
  if (v instanceof Date) return v.getTime();
  if (v === '' || v === null || v === undefined) return NaN;
  return new Date(v).getTime();
}

/**
 * Time of day of a column-C cell as 'HH:mm', or '' when the cell carries no time.
 *
 * '00:00:00' deliberately counts as NO time: a date-only cell and a midnight datetime come
 * back as the identical Date, so no value-based test can separate them. Consulting the
 * cell's number format instead was rejected — it is a display attribute (one careless
 * "format cells" over column C would make every legacy date-only row claim a time), and the
 * bot already sets 'yyyy/mm/dd hh:mm:ss' on every block it appends, including the rows whose
 * 授權時間 it could not parse and filled with 00:00:00. So the format is neither reliable nor
 * faithful. The accepted cost is a charge authorised at exactly 00:00 showing no time — about
 * one row every two and a half years, and it still sorts first, which is where midnight belongs.
 *
 * The midnight test goes through CFG.TZ, never dt.getHours(): the script's timezone and the
 * sheet's CFG.TZ are separate settings, so testing in one zone while formatting in the other
 * could classify a row as timeless while it displays 08:00. One formatted read decides both.
 */
function rowHM_(dt) {
  return hmFromHms_(Utilities.formatDate(dt, CFG.TZ, 'HH:mm:ss'));
}

/** rowHM_'s rule on an already-formatted CFG.TZ 'HH:mm:ss', for callers that format once. */
function hmFromHms_(hms) {
  return hms === '00:00:00' ? '' : hms.slice(0, 5);
}

/**
 * Last row that holds an actual transaction, i.e. the last row with a real date in
 * column C. Returns 1 (the header) when there is no data.
 *
 * NOT the same as sh.getLastRow(): this sheet carries a long tail of rows whose only
 * content is an unchecked 已記帳 checkbox in column A. A `false` is real cell content,
 * so getLastRow() counts those rows — measured at 788 of them, putting getLastRow() at
 * 1804 while the last transaction sat at row 1016. Appending at getLastRow()+1 therefore
 * stranded a new row ~788 rows below the visible data, where nobody would find it.
 */
function lastDataRow_(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return 1;
  const dates = sh.getRange(2, CFG.IDX_DATE + 1, lastRow - 1, 1).getValues();
  for (let i = dates.length - 1; i >= 0; i--) {
    if (!isNaN(cellDateTime_(dates[i][0]))) return i + 2;
  }
  return 1;
}

/**
 * Where a transaction dated `dt` belongs so the sheet STAYS in the order it is already
 * in. Returns { row, appending }: when appending is false the caller must
 * insertRowBefore(row) to make space; when true, row is one past the last data row.
 *
 * The direction is detected from the data (first vs last date) instead of assuming ASC,
 * because the bot's order comes from the SORT_ORDER script property and may be DESC.
 * An empty or single-date sheet appends, which is correct under either direction.
 */
function insertPositionForDate_(sh, dt) {
  const last = lastDataRow_(sh);
  if (last <= 1) return { row: 2, appending: true };

  const times = sh.getRange(2, CFG.IDX_DATE + 1, last - 1, 1).getValues()
    .map(r => cellDateTime_(r[0]));
  const known = times.filter(t => !isNaN(t));
  if (!known.length) return { row: last + 1, appending: true };

  const descending = known[0] > known[known.length - 1];
  const target = dt.getTime();
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (isNaN(t)) continue;
    // First existing row that should sort AFTER the new one — insert ahead of it.
    if (descending ? t < target : t > target) return { row: i + 2, appending: false };
  }
  return { row: last + 1, appending: true };
}

/**
 * 0-based index of the 我的消費 header in Transactions, or -1 if absent.
 *
 * Matches on the TRIMMED cell rather than an exact indexOf. This header is typed by
 * hand into the sheet rather than written by the bot, and a trailing space is invisible in the
 * cell but makes an exact match fail — which surfaces only as a write error much later, with
 * nothing on screen to explain it.
 */
function getMineColIndex_(sh) {
  const headers = headerRow_(sh);
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === CFG.HDR_MINE) return i;
  }
  return -1;
}

/** Row 1 of Transactions, as written. */
function headerRow_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

/**
 * Index of the 我的消費 column, CREATING the header if it is not there yet.
 *
 * Asking the owner to add the header by hand was a mistake: it is a silent prerequisite that
 * fails much later, at write time, in a completely different part of the UI. Measured cost of
 * that design — two rounds of "寫入失敗" against a sheet whose row 1 ended at column L with no
 * 我的消費 anywhere.
 *
 * Creating it is safe and purely additive: the header goes one past the last column that holds
 * anything, so it cannot overwrite data and cannot shift the A–K positions that the fixed
 * column indices in CFG read by position. Only the WRITE path calls this — reads stay
 * non-mutating via getMineColIndex_, so merely opening the dashboard never changes the sheet.
 */
function ensureMineColIndex_(sh) {
  const idx = getMineColIndex_(sh);
  if (idx !== -1) return idx;
  const col = sh.getLastColumn() + 1;
  sh.getRange(1, col).setValue(CFG.HDR_MINE);
  return col - 1;
}

/**
 * How much of a row was MY OWN consumption — the number every statistic must sum.
 *
 * The card was charged 金額 (E); 我的消費 says how much of that was actually mine. A 7,000
 * dinner where 5,000 was fronted for other people is 2,000 of my spending, and counting the
 * full 7,000 is what this column exists to stop.
 *
 * The blank check MUST come before Number(): `Number('') === 0`, so reading the cell first
 * would turn every ordinary un-split row into "none of this was mine" and zero out the
 * entire dashboard. Blank means the whole charge is mine.
 *
 * Not capped at 金額 on purpose. The reverse case is real — someone else fronts part of my
 * share up front — and then my consumption legitimately exceeds what my own card was
 * charged. Only negatives and non-numbers fall back to the charge.
 */
function rowMine_(row, mineIdx) {
  const charged = Number(row[CFG.IDX_AMOUNT]) || 0;
  if (mineIdx === -1) return charged;
  const cell = row[mineIdx];
  if (cell === '' || cell === null || cell === undefined) return charged;
  const v = Number(cell);
  return (isNaN(v) || v < 0) ? charged : v;
}
