/** ===== Shared config (loaded from Script Properties to avoid hardcoding secrets) ===== */
const CONFIG = loadConfig_();
const SORT_ORDER = CONFIG.sortOrder; // 'ASC' | 'DESC' | 'NONE'
const TZ = CONFIG.tz;
const SPREADSHEET_ID = CONFIG.spreadsheetId;
const SHEET_NAME = CONFIG.sheetName;
const HEADER = CONFIG.header;
const CFG = CONFIG.gmailConfig;

/* ========== Fubon email regex helpers (more tolerant) ========== */
const RX = {
  DATE: [
    /授權日期：\s*([0-9]{3})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*日/,
    /消費日期：\s*([0-9]{3})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*日/,
    /授權日期：\s*([0-9]{4})[\/\-]([0-9]{1,2})[\/\-]([0-9]{1,2})/,
    /消費日期：\s*([0-9]{4})[\/\-]([0-9]{1,2})[\/\-]([0-9]{1,2})/
  ],
  TIME: [
    /授權時間：\s*([0-9]{1,2}:[0-9]{1,2}:[0-9]{1,2})/,
    /授權時間：\s*([0-9]{1,2}:[0-9]{1,2})/,
    /消費時間：\s*([0-9]{1,2}:[0-9]{1,2}:[0-9]{1,2})/,
    /消費時間：\s*([0-9]{1,2}:[0-9]{1,2})/
  ],
  LAST4: [
    /消費卡號末四碼：\s*([0-9]{4})/,
    /卡號末四碼：\s*([0-9]{4})/
  ],
  AMOUNT: [
    /授權金額：\s*NT\$?\s*([\d,]+)/,
    /金額：\s*NT\$?\s*([\d,]+)/
  ],
  MERCHANT: [
    // Allow multiple field name variants and tolerate interleaved HTML tags
    /(交易內容|交易說明|商店名稱|特店名稱|特店|消費內容)[:：]?\s*(?:<\/[^>]+>\s*<[^>]+>)*\s*([^<\n\r]+)/i
  ],
  CATEGORY: [
    /(消費類別|交易類型|類別)[:：]?\s*(?:<\/[^>]+>\s*<[^>]+>)*\s*([^<\n\r]+)/i
  ]
};

/** ===== Entry: append last 7 days for both banks; Cathay-style logs ===== */
function appendLast7DaysToSheet() {
  const lock = LockService.getScriptLock();
  try {
    lock.tryLock(20 * 1000);

    const sh = getOrCreateSheet_();
    ensureHeaderAndCheckbox_(sh);

    // Last 7-day window (inclusive, Taiwan timezone)
    const { start7d0, today0, ymdStart7d, ymdToday } = timeWindow7d_();

    // Load existing rows to build dedup index (ignore F/G)
    const lastRow = sh.getLastRow();
    const lastCol = HEADER.length;
    let existing = [];
    if (lastRow > 1) {
      existing = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    }
    const existingKeySet = new Set(existing.map(row => makeDedupKeyFromRow_(row)));
    const existingLooseKeySet = new Set(existing.map(row => makeLooseDedupKeyFromRow_(row)));
    // Strict MessageID check set (Column I is index 8)
    const existingMessageIds = new Set(existing.map(row => String(row[8] || '')));
    const newRows = [];

    /** ===== Fubon: one record per email ===== */
    {
      const q = [
        CFG.FUBON_QUERY_SUBJECT,
        'after:' + fmtYMD_(start7d0),
        'before:' + fmtYMD_(addDays_(today0, 1))
      ].join(' ');
      const threads = GmailApp.search(q, 0, 500);
      for (const th of threads) {
        for (const msg of th.getMessages()) {
          const parsed = parseFubonEmail_(msg);
          if (!parsed) continue;
          const { id, dateStr, dt, last4, amount, merchant, category, link } = parsed;
          if (dateStr < ymdStart7d || dateStr > ymdToday) continue;

          console.log(`=== Subject: ${msg.getSubject()} | Date: ${msg.getDate()} | total 1 entry ===`);

          const row = [
            false,           // A recorded (checkbox)
            '富邦',          // B bank name
            dt,              // C auth datetime (Date)
            last4 || '',     // D card last4
            amount || '',    // E amount NTD
            merchant || '',  // F merchant (editable)
            category || '',  // G category (editable)
            link,            // H Gmail link
            id               // I MessageId
          ];

          const key = makeDedupKey_({ bank: '富邦', dt, last4: row[3], amount: row[4], messageId: row[8] });
          const looseKey = makeLooseDedupKey_({ bank: '富邦', dt, amount: row[4] });

          if (!existingKeySet.has(key) && !existingLooseKeySet.has(looseKey)) {
            existingKeySet.add(key);
            existingLooseKeySet.add(looseKey);
            newRows.push(row);
            console.log(`✅ Created transaction: ${JSON.stringify({
              bank: '富邦',
              cardLast4: row[3],
              authDate: fmtYMD_(dt),
              authTime: Utilities.formatDate(dt, TZ, 'HH:mm:ss'),
              amount: row[4],
              currency: 'TWD',
              merchant: row[5],
              category: row[6]
            })}`);
          }
        }
      }
    }

    /** ===== Cathay (Consumption): multiple records per email ===== */
    {
      const q = `label:"${CFG.CATHAY_LABEL}" subject:"${CFG.CATHAY_SUBJECT}" after:${fmtYMD_(start7d0)} before:${fmtYMD_(addDays_(today0, 1))}`;
      const threads = GmailApp.search(q, 0, 200);
      for (const th of threads) {
        for (const msg of th.getMessages()) {
          const plain = msg.getPlainBody();
          const rows = parseCathayConsumptionPlain_(plain); // multiple rows
          console.log(`=== Subject: ${msg.getSubject()} | Date: ${msg.getDate()} | total ${rows.length} entries ===`);

          const messageId = msg.getId();
          const link = `https://mail.google.com/mail/#all/${messageId}`;

          for (const r of rows) {
            const ymd = r.authDate || '';
            if (!ymd) continue;
            if (ymd < ymdStart7d || ymd > ymdToday) continue;

            const dt = toDateInTZ_(ymd, (r.authTime || '00:00:00'), TZ);
            const row = [
              false,               // A recorded (checkbox)
              '國泰',              // B bank name
              dt,                  // C auth datetime
              r.cardLast4 || '',   // D card last4
              r.amount || '',      // E amount NTD
              r.merchant || '',    // F merchant (editable)
              r.category || '',    // G category (editable)
              link,                // H Gmail link
              messageId            // I
            ];

            const key = makeDedupKey_({ bank: '國泰', dt, last4: row[3], amount: row[4], messageId: row[8] });
            const looseKey = makeLooseDedupKey_({ bank: '國泰', dt, amount: row[4] });

            if (!existingKeySet.has(key) && !existingLooseKeySet.has(looseKey)) {
              existingKeySet.add(key);
              existingLooseKeySet.add(looseKey);
              newRows.push(row);
              console.log(`✅ Created transaction: ${JSON.stringify({
                bank: '國泰',
                cardLast4: row[3],
                authDate: r.authDate,
                authTime: r.authTime,
                amount: row[4],
                currency: 'TWD',
                merchant: row[5],
                category: row[6]
              })}`);
            }
          }
        }
      }
    }

    /** ===== Cathay (Transfer): one record per email ===== */
    {
      const q = `from:cathaybk subject:"CUBE App轉帳通知" after:${fmtYMD_(start7d0)} before:${fmtYMD_(addDays_(today0, 1))}`;
      const threads = GmailApp.search(q, 0, 100);
      for (const th of threads) {
        for (const msg of th.getMessages()) {
          // STRICT CHECK: If MessageID exists, skip immediately
          if (existingMessageIds.has(msg.getId())) {
            console.log(`Skipping duplicate transfer email (MessageId exists): ${msg.getId()}`);
            continue;
          }

          const parsed = parseCathayTransfer_(msg);
          if (!parsed) continue;
          const { id, dateStr, dt, last4, amount, merchant, category, link } = parsed;
          if (dateStr < ymdStart7d || dateStr > ymdToday) continue;

          console.log(`=== Subject: ${msg.getSubject()} | Date: ${msg.getDate()} | total 1 entry ===`);

          const row = [
            false,           // A recorded (checkbox)
            '國泰',          // B bank name
            dt,              // C auth datetime (Date)
            last4 || '',     // D card last4 (account last 5)
            amount || '',    // E amount NTD
            merchant || '',  // F merchant (editable)
            category || '',  // G category (editable)
            link,            // H Gmail link
            id               // I MessageId
          ];

          const key = makeDedupKey_({ bank: '國泰', dt, last4: row[3], amount: row[4], messageId: row[8] });
          const looseKey = makeLooseDedupKey_({ bank: '國泰', dt, amount: row[4] });

          // STRICT check (same messageId) OR LOOSE check (same details, ignore messageId)
          if (!existingKeySet.has(key) && !existingLooseKeySet.has(looseKey)) {
            existingKeySet.add(key);
            existingLooseKeySet.add(looseKey);
            newRows.push(row);
            console.log(`✅ Created transaction (Transfer): ${JSON.stringify({
              bank: '國泰',
              accountLast5: row[3],
              authDate: fmtYMD_(dt),
              authTime: Utilities.formatDate(dt, TZ, 'HH:mm:ss'),
              amount: row[4],
              currency: 'TWD',
              merchant: row[5],
              category: row[6]
            })}`);
          }
        }
      }
    }

    // Append new rows
    if (newRows.length > 0) {
      const startRow = sh.getLastRow() + 1;
      sh.getRange(startRow, 1, newRows.length, HEADER.length).setValues(newRows);

      // Format date column (column C)
      const finalLastRow = sh.getLastRow();
      if (finalLastRow >= startRow) {
        sh.getRange(startRow, 3, finalLastRow - startRow + 1, 1).setNumberFormat('yyyy/mm/dd hh:mm:ss');
      }

      // For newly appended rows, default column J (income/expense) to "支出" when empty
      const jRange = sh.getRange(startRow, 10, newRows.length, 1); // column J
      const jVals = jRange.getValues();
      for (let i = 0; i < jVals.length; i++) {
        if (jVals[i][0] === "" || jVals[i][0] === null) {
          jVals[i][0] = "支出";
        }
      }
      jRange.setValues(jVals);

      // Auto-categorize column K for new rows (rule-based + Gemini fallback)
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      autoCategorizeRows_(ss, sh, startRow, newRows.length);

      // Auto-tag column L for new rows (rule-based only, no AI)
      autoTagRows_(ss, sh, startRow, newRows.length);
    }

    // Checkbox validation, sort, freeze header
    applyCheckboxValidation_(sh);
    sortByAuthTime_(sh, SORT_ORDER);
    sh.setFrozenRows(1);

    Logger.log(`Done. inserted=${newRows.length}`);
  } finally {
    try { lock.releaseLock(); } catch (e) { }
  }
}

/* =========================
 *          Parsers
 * ========================= */

/** Fubon: parse single email and enrich merchant/category */
function parseFubonEmail_(msg) {
  const id = msg.getId();
  const html = msg.getBody();
  const plain = msg.getPlainBody();
  const link = `https://mail.google.com/mail/#all/${id}`;

  const dateText = pick0_(RX.DATE, html, plain);
  const dateStr = parseDate_(dateText); // yyyy/MM/dd
  if (!dateStr) return null;

  const timeText = pick_(RX.TIME, html, plain) || '';
  const timeStr = normalizeTime_(timeText);

  const last4 = pick_(RX.LAST4, html, plain) || '';
  const amtRaw = pick_(RX.AMOUNT, html, plain);
  const amount = amtRaw ? Number(String(amtRaw).replace(/,/g, '')) : '';
  const merchant = (pick_(RX.MERCHANT, html, plain) || '').trim();
  const category = (pick_(RX.CATEGORY, html, plain) || '').trim();

  const dt = toDateInTZ_(dateStr, timeStr || '00:00:00', TZ);
  return { id, dateStr, dt, last4, amount, merchant, category, link };
}

/** Cathay: line-based state machine (multiple records + auth time) */
function parseCathayConsumptionPlain_(text) {
  const rows = [];
  const topCardLast4 = (text.match(/卡號後4碼[:：]?\s*(\d{4})/) || [])[1] || null;

  const lines = text
    .split(/\n/)
    .map(s => s.replace(/\u3000/g, ' ').trim())
    .filter(s => s.length > 0);

  let ctx = { cardType: null, last4: null, date: null, time: null, region: null };

  function tryParseCardLine(line) {
    const re = /(正卡|附卡)\s*(\d{4})?\s*(\d{4}\/\d{2}\/\d{2})\s*(\d{2}:\d{2})\s*([A-Z]{2})/;
    const m = line.match(re);
    if (!m) return null;
    return { cardType: m[1], last4: m[2] || null, date: m[3], time: m[4], region: m[5] };
  }
  function tryParseAmountLine(line) {
    const m = line.match(/^NT\$([0-9,]+)\s+(.+)$/);
    if (!m) return null;
    const amount = parseFloat(m[1].replace(/,/g, ''));
    const rest = m[2].trim();
    const parts = rest.split(/\s+/);
    const category = parts.length > 1 ? parts[parts.length - 1] : '';
    const merchant = parts.length > 1 ? parts.slice(0, -1).join(' ') : rest;
    return { amount, merchant, category };
  }

  for (const line of lines) {
    const card = tryParseCardLine(line);
    if (card) { ctx = { ...card }; continue; }

    const amt = tryParseAmountLine(line);
    if (amt) {
      const last4 = ctx.last4 || topCardLast4 || null;
      rows.push({
        cardLast4: last4,
        cardType: ctx.cardType,
        authDate: ctx.date,      // yyyy/MM/dd
        authTime: ctx.time,      // HH:mm
        region: ctx.region,
        amount: amt.amount,
        currency: "TWD",
        merchant: amt.merchant,
        category: amt.category,
        note: '',
        rawRow: line
      });
    }
  }
  return rows;
}

/** Cathay: parse transfer notification email */
function parseCathayTransfer_(msg) {
  const id = msg.getId();
  const plain = msg.getPlainBody();
  const link = `https://mail.google.com/mail/#all/${id}`;

  // Date/Time
  const dateMatch = plain.match(/您於(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2})/);
  if (!dateMatch) return null;
  const dateStr = dateMatch[1];
  const timeStr = dateMatch[2];

  // Amount
  const amtMatch = plain.match(/轉帳金額\s+([\d,]+)/);
  const amount = amtMatch ? Number(amtMatch[1].replace(/,/g, '')) : '';

  // Account
  const accMatch = plain.match(/轉入帳號\s+.*(\d{4,5})/);
  const last4 = accMatch ? accMatch[1] : '';

  // Merchant/Remark
  const remarkMatch = plain.match(/備註\s+(.*)/);
  const merchant = (remarkMatch && remarkMatch[1].trim()) ? remarkMatch[1].trim() : '轉帳';

  const dt = toDateInTZ_(dateStr, timeStr, TZ);
  return { id, dateStr, dt, last4, amount, merchant, category: '轉帳', link };
}

/* =========================
 *       Sheet utilities
 * ========================= */

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function ensureHeaderAndCheckbox_(sh) {
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  } else {
    const current = sh.getRange(1, 1, 1, HEADER.length).getValues()[0];
    if (HEADER.join('|') !== current.join('|')) {
      sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    }
  }
  applyCheckboxValidation_(sh);
}

function applyCheckboxValidation_(sh) {
  const lastRow = Math.max(sh.getLastRow(), 2);
  const range = sh.getRange(2, 1, lastRow - 1, 1);
  const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  range.setDataValidation(rule);
}

function sortByAuthTime_(sh, order) {
  if (order === 'NONE') return;

  const ascending = (order !== 'DESC'); // Default to ASC if not explicitly DESC (so 'ASC' or undefined works like before)

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow <= 2) return;
  const range = sh.getRange(2, 1, lastRow - 1, lastCol);
  range.sort([
    { column: 3, ascending: ascending }, // column C: auth datetime
    { column: 9, ascending: true }       // secondary key: MessageId (stable)
  ]);
}

// Last 7-day window (inclusive) using Taiwan timezone
function timeWindow7d_() {
  const now = new Date();
  const todayStr = Utilities.formatDate(now, TZ, 'yyyy/MM/dd') + ' 00:00:00';
  const today0 = new Date(todayStr);
  const start7d0 = addDays_(today0, -6);
  const ymdStart7d = Utilities.formatDate(start7d0, TZ, 'yyyy/MM/dd');
  const ymdToday = Utilities.formatDate(today0, TZ, 'yyyy/MM/dd');
  return { start7d0, today0, ymdStart7d, ymdToday };
}

function addDays_(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fmtYMD_(d) { return Utilities.formatDate(d, TZ, 'yyyy/MM/dd'); }

/** Extract value: convert HTML to text first to improve regex matching */
function pick_(regexes, html, plain) {
  const htmlText = htmlToText_(html || '');
  const plainNorm = (plain || '').replace(/\u3000/g, ' ');
  for (const re of regexes) {
    let m = htmlText.match(re);
    if (m && (m[2] || m[1])) return (m[2] || m[1]).toString().trim();
    m = html && html.match(re);
    if (m && (m[2] || m[1])) return (m[2] || m[1]).toString().trim();
    m = plainNorm.match(re);
    if (m && (m[2] || m[1])) return (m[2] || m[1]).toString().trim();
  }
  return '';
}
function pick0_(regexes, html, plain) {
  const htmlText = htmlToText_(html || '');
  const plainNorm = (plain || '').replace(/\u3000/g, ' ');
  for (const re of regexes) {
    let m = htmlText.match(re);
    if (m && m[0]) return m[0];
    m = html && html.match(re);
    if (m && m[0]) return m[0];
    m = plainNorm.match(re);
    if (m && m[0]) return m[0];
  }
  return '';
}

/* Simple HTML-to-text: handle <br>/<p> as newline and strip tags/NBSP */
function htmlToText_(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\u3000/g, ' ')
    .trim();
}

function parseDate_(s) {
  if (!s) return '';
  let m = /([0-9]{3}).*?([0-9]{1,2}).*?([0-9]{1,2})/.exec(s); // ROC year
  if (m) {
    const yyyy = Number(m[1]) + 1911;
    return `${yyyy}/${String(m[2]).padStart(2, '0')}/${String(m[3]).padStart(2, '0')}`;
  }
  m = /([0-9]{4})[\/\-]([0-9]{1,2})[\/\-]([0-9]{1,2})/.exec(s); // Gregorian year
  if (m) {
    return `${m[1]}/${String(m[2]).padStart(2, '0')}/${m[3].padStart ? m[3].padStart(2, '0') : String(m[3]).padStart(2, '0')}`;
  }
  return '';
}

function normalizeTime_(t) {
  if (!t) return '';
  const m = /([0-9]{1,2}:[0-9]{1,2})(:[0-9]{1,2})?/.exec(t);
  return m ? (m[2] ? m[0] : `${m[1]}:00`) : '';
}

function toDateInTZ_(ymd, hms, tz) {
  const offset = tz === 'Asia/Taipei' ? '+08:00' : '+00:00';
  const iso = `${ymd.replace(/\//g, '-')}T${hms}${offset}`;
  return new Date(iso);
}

/** Build dedup key (ignore merchant/category): bank + MessageId + auth datetime + last4 + amount */
function makeDedupKey_({ bank, dt, last4, amount, messageId }) {
  const ymdhms = Utilities.formatDate(dt, TZ, 'yyyy/MM/dd HH:mm:ss');
  return [bank || '', messageId || '', ymdhms, String(last4 || ''), String(amount || '')].join('|');
}

/** Build dedup key from existing row (A~I), ignoring editable F/G columns */
function makeDedupKeyFromRow_(row) {
  const bank = String(row[1] || '');     // B bank
  const dt = row[2] instanceof Date ? row[2] : new Date(row[2]); // C auth datetime
  const last4 = String(row[3] || '');     // D
  const amount = String(row[4] || '');     // E
  const messageId = String(row[8] || '');     // I
  return makeDedupKey_({ bank, dt, last4, amount, messageId });
}

/** Build LOOSE dedup key: bank + auth datetime (minute precision) + amount (no MessageId, no last4) */
function makeLooseDedupKey_({ bank, dt, amount }) {
  const ymdhm = Utilities.formatDate(dt, TZ, 'yyyy/MM/dd HH:mm');
  return [bank || '', ymdhm, String(amount || '')].join('|');
}

/** Build LOOSE dedup key from row */
function makeLooseDedupKeyFromRow_(row) {
  const bank = String(row[1] || '');
  const dt = row[2] instanceof Date ? row[2] : new Date(row[2]);
  const amount = String(row[4] || '');
  return makeLooseDedupKey_({ bank, dt, amount });
}

/* -------------------------
 * Optional: one-time backfill empty column J for credit cards with "支出"
 * ------------------------- */
function backfillExpenseForCreditCards_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) return;

  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return;

  const rng = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn());
  const vals = rng.getValues();

  const COL_BANK = 1;   // B bank
  const COL_IO = 9;   // J income/expense

  let updated = 0;
  for (let i = 0; i < vals.length; i++) {
    const bank = String(vals[i][COL_BANK] || "");
    const io = vals[i][COL_IO];
    if ((bank === "富邦" || bank === "國泰") && (io === "" || io === null)) {
      vals[i][COL_IO] = "支出";
      updated++;
    }
  }

  if (updated > 0) rng.setValues(vals);
  Logger.log(`Backfill done. updated=${updated}`);
}

/** Helper: set script properties from clasp run */
function setScriptProperties(obj) {
  const props = PropertiesService.getScriptProperties();
  props.setProperties(obj);
  Logger.log('Set properties: ' + Object.keys(obj).join(', '));
}

/* =========================
 *       Config utilities
 * ========================= */

function loadConfig_() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    throw new Error('Missing required config: SPREADSHEET_ID');
  }
  return {
    tz: props.getProperty('TZ') || 'Asia/Taipei',
    spreadsheetId,
    sheetName: props.getProperty('SHEET_NAME') || 'Transactions',
    header: parseHeader_(props.getProperty('HEADER')),
    gmailConfig: {
      FUBON_QUERY_SUBJECT: props.getProperty('FUBON_QUERY_SUBJECT') || '(subject:"即時消費通知" OR subject:"富邦信用卡消費通知" OR subject:"富邦信用卡即時消費通知")',
      CATHAY_LABEL: props.getProperty('CATHAY_LABEL') || '國泰世華消費',
      CATHAY_SUBJECT: props.getProperty('CATHAY_SUBJECT') || '消費彙整通知'
    },
    sortOrder: props.getProperty('SORT_ORDER') || 'ASC',
    geminiApiKey: props.getProperty('GEMINI_API_KEY') || ''
  };
}

function parseHeader_(headerValue) {
  try {
    const parsed = JSON.parse(headerValue);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (err) {
    // ignore parse error, fallback to default header
  }
  return ['已記帳', '銀行', '授權日期時間', '卡末四碼', '金額_NTD', '交易內容/商店', '類別', 'Gmail連結', 'MessageId'];
}

/* NOTE: Sidebar / drilldown UI lives in the bound script (sidebar/ directory).
   The standalone script cannot use getUi() or showSidebar(). */

/* =========================
 *   Auto-Categorization
 * ========================= */

/** Compute longest common prefix of an array of strings, trimmed at word/CJK boundary */
function extractCommonPrefix_(strings) {
  if (!strings || strings.length === 0) return '';
  if (strings.length === 1) return strings[0].trim();

  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    let j = 0;
    while (j < prefix.length && j < strings[i].length && prefix[j] === strings[i][j]) j++;
    prefix = prefix.substring(0, j);
    if (!prefix) return '';
  }

  // Trim at word boundary: remove trailing partial Latin words and whitespace
  prefix = prefix.replace(/\s+$/, '');          // trailing spaces
  prefix = prefix.replace(/[a-zA-Z0-9]+$/, ''); // trailing partial Latin word
  prefix = prefix.replace(/\s+$/, '');          // spaces left after trimming
  return prefix;
}

/** Given merchants sharing a category, extract prefix keyword or fall back to individual names */
function extractKeywordsFromGroup_(merchants, minLength) {
  minLength = minLength || 2;
  const unique = [...new Set(merchants.map(m => m.trim()).filter(m => m))];
  if (unique.length === 0) return [];
  if (unique.length === 1) return [unique[0]];

  const prefix = extractCommonPrefix_(unique);
  if (prefix.length >= minLength) {
    return [prefix];
  }
  // No valid common prefix — return all unique merchants individually
  return unique;
}

/** Load keyword→category rules from the category sheet, sorted longest-keyword-first */
function loadCategoryRules_(ss) {
  const sh = ss.getSheetByName('category');
  if (!sh || sh.getLastRow() < 2) return [];

  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  const rules = [];
  for (const row of data) {
    const keyword = String(row[0] || '').trim();
    const category = String(row[1] || '').trim();
    if (keyword && category) {
      rules.push({ keyword: keyword, keywordLower: keyword.toLowerCase(), category });
    }
  }
  // Longest keyword first for most-specific match
  rules.sort((a, b) => b.keyword.length - a.keyword.length);
  return rules;
}

/** Load keyword→tag rules from the tag sheet, sorted longest-keyword-first */
function loadTagRules_(ss) {
  const sh = ss.getSheetByName('tag');
  if (!sh || sh.getLastRow() < 2) return [];

  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  const rules = [];
  for (const row of data) {
    const keyword = String(row[0] || '').trim();
    const tag = String(row[1] || '').trim();
    if (keyword && tag) {
      rules.push({ keyword: keyword, keywordLower: keyword.toLowerCase(), tag });
    }
  }
  // Longest keyword first for most-specific match
  rules.sort((a, b) => b.keyword.length - a.keyword.length);
  return rules;
}

/** Load valid category names from META sheet row 2 */
function loadValidCategories_(ss) {
  const sh = ss.getSheetByName('META');
  if (!sh) return [];
  const vals = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  return vals.map(v => String(v || '').trim()).filter(v => v.length > 0);
}

/** Match merchant against rules (case-insensitive substring). Returns category or null */
function matchCategory_(merchant, rules) {
  if (!merchant) return null;
  const normalized = merchant.toLowerCase().trim();
  for (const r of rules) {
    if (normalized.includes(r.keywordLower)) {
      return r.category;
    }
  }
  return null;
}

/** Match merchant against tag rules (case-insensitive substring). Returns tag or null */
function matchTag_(merchant, rules) {
  if (!merchant) return null;
  const normalized = merchant.toLowerCase().trim();
  for (const r of rules) {
    if (normalized.includes(r.keywordLower)) {
      return r.tag;
    }
  }
  return null;
}

/** Call Gemini API to classify merchants in batch. Returns Map<merchant, category|null> */
function classifyWithGemini_(merchants, validCategories) {
  const result = {};
  if (!merchants.length) return result;

  const apiKey = CONFIG.geminiApiKey;
  if (!apiKey) {
    console.log('GEMINI_API_KEY not set, skipping AI classification');
    return result;
  }

  const categoryList = validCategories.join(', ');
  const merchantList = merchants.map((m, i) => `${i + 1}. ${m}`).join('\n');

  const prompt = `你是台灣信用卡消費分類器。請將以下商店分類到這些類別之一：${categoryList}。
如果不確定，回覆 "unknown"。
請只回覆 JSON 格式，不要加任何其他文字：{"商店名": "類別", ...}

商店列表：
${merchantList}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 }
    };

    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) {
      console.log(`Gemini API error: ${res.getResponseCode()} ${res.getContentText().substring(0, 200)}`);
      return result;
    }

    const body = JSON.parse(res.getContentText());
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract JSON from response (may be wrapped in markdown code block)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('Gemini response has no JSON: ' + text.substring(0, 200));
      return result;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validSet = new Set(validCategories);

    for (const [merchant, cat] of Object.entries(parsed)) {
      const category = String(cat || '').trim();
      if (category && category !== 'unknown' && validSet.has(category)) {
        result[merchant] = category;
      }
    }

    console.log(`Gemini classified ${Object.keys(result).length}/${merchants.length} merchants`);
  } catch (e) {
    console.log('Gemini classification error: ' + e.message);
  }

  return result;
}

/** Write new keyword→category mappings back to category sheet (avoid duplicates) */
function writeCategoryRulesBack_(ss, newMappings) {
  if (!newMappings.length) return;

  const sh = ss.getSheetByName('category');
  if (!sh) return;

  // Group new mappings by category and extract prefixes
  const catToKeywords = {};
  for (const m of newMappings) {
    if (!catToKeywords[m.category]) catToKeywords[m.category] = [];
    catToKeywords[m.category].push(m.keyword);
  }
  const optimized = [];
  for (const [cat, keywords] of Object.entries(catToKeywords)) {
    const extracted = extractKeywordsFromGroup_(keywords);
    for (const kw of extracted) {
      optimized.push({ keyword: kw, category: cat });
    }
  }

  // Load existing keywords
  const lastRow = sh.getLastRow();
  const existingKeywords = new Set();
  if (lastRow >= 2) {
    const existing = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (const row of existing) {
      existingKeywords.add(String(row[0] || '').trim().toLowerCase());
    }
  }

  // Append only new ones
  const toAppend = [];
  for (const m of optimized) {
    if (!existingKeywords.has(m.keyword.toLowerCase())) {
      toAppend.push([m.keyword, m.category]);
      existingKeywords.add(m.keyword.toLowerCase());
    }
  }

  if (toAppend.length > 0) {
    const appendRow = sh.getLastRow() + 1;
    sh.getRange(appendRow, 1, toAppend.length, 2).setValues(toAppend);
    console.log(`Wrote ${toAppend.length} new rules to category sheet`);
  }
}

/** Main orchestrator: auto-categorize column K for newly appended rows */
function autoCategorizeRows_(ss, sh, startRow, numRows) {
  if (numRows <= 0) return;

  try {
    const rules = loadCategoryRules_(ss);
    const validCategories = loadValidCategories_(ss);
    if (validCategories.length === 0) {
      console.log('No valid categories in META sheet, skipping auto-categorize');
      return;
    }

    // Read merchant (col F=6) and existing K (col 11) for target rows
    const merchantRange = sh.getRange(startRow, 6, numRows, 1);
    const merchants = merchantRange.getValues();
    const kRange = sh.getRange(startRow, 11, numRows, 1);
    const kVals = kRange.getValues();

    const unmatched = []; // { index, merchant }
    const newKVals = kVals.map(r => [r[0]]); // clone

    for (let i = 0; i < numRows; i++) {
      // Only fill if K is blank
      if (newKVals[i][0] !== '' && newKVals[i][0] !== null) continue;

      const merchant = String(merchants[i][0] || '').trim();
      if (!merchant) continue;

      const matched = matchCategory_(merchant, rules);
      if (matched) {
        newKVals[i][0] = matched;
      } else {
        unmatched.push({ index: i, merchant });
      }
    }

    // Gemini fallback for unmatched
    if (unmatched.length > 0) {
      const uniqueMerchants = [...new Set(unmatched.map(u => u.merchant))];
      const aiResults = classifyWithGemini_(uniqueMerchants, validCategories);

      const newRules = [];
      for (const u of unmatched) {
        const cat = aiResults[u.merchant];
        if (cat) {
          newKVals[u.index][0] = cat;
          newRules.push({ keyword: u.merchant, category: cat });
        }
      }

      // Cache AI results back to category sheet
      writeCategoryRulesBack_(ss, newRules);
    }

    // Write K values back
    kRange.setValues(newKVals);

    const filled = newKVals.filter(r => r[0] !== '' && r[0] !== null).length;
    console.log(`Auto-categorized ${filled}/${numRows} new rows`);
  } catch (e) {
    console.log('Auto-categorize error (non-blocking): ' + e.message);
  }
}

/** Auto-tag column L for newly appended rows (rule-based only, no AI, single value) */
function autoTagRows_(ss, sh, startRow, numRows) {
  if (numRows <= 0) return;

  try {
    const rules = loadTagRules_(ss);
    if (rules.length === 0) {
      console.log('No tag rules in tag sheet, skipping auto-tag');
      return;
    }

    // Read merchant (col F=6) and existing L (col 12) for target rows
    const merchants = sh.getRange(startRow, 6, numRows, 1).getValues();
    const lRange = sh.getRange(startRow, 12, numRows, 1);
    const lVals = lRange.getValues();
    const newLVals = lVals.map(r => [r[0]]); // clone

    for (let i = 0; i < numRows; i++) {
      // Only fill if L is blank
      if (newLVals[i][0] !== '' && newLVals[i][0] !== null) continue;

      const merchant = String(merchants[i][0] || '').trim();
      if (!merchant) continue;

      const matched = matchTag_(merchant, rules);
      if (matched) newLVals[i][0] = matched;
    }

    lRange.setValues(newLVals);

    const filled = newLVals.filter(r => r[0] !== '' && r[0] !== null).length;
    console.log(`Auto-tagged ${filled}/${numRows} new rows`);
  } catch (e) {
    console.log('Auto-tag error (non-blocking): ' + e.message);
  }
}

/** One-time bootstrap: build category rules from existing manually-categorized transactions */
function bootstrapCategoryRules() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh || sh.getLastRow() <= 1) {
    Logger.log('No transactions to bootstrap from');
    return;
  }

  const data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const validCategories = new Set(loadValidCategories_(ss));

  // Count: merchant → { category → count }
  const merchantCats = {};
  for (const row of data) {
    const merchant = String(row[5] || '').trim(); // col F
    const manualCat = String(row[10] || '').trim(); // col K
    if (!merchant || !manualCat) continue;
    if (!validCategories.has(manualCat)) continue;

    if (!merchantCats[merchant]) merchantCats[merchant] = {};
    merchantCats[merchant][manualCat] = (merchantCats[merchant][manualCat] || 0) + 1;
  }

  // Pick most frequent category per merchant
  const merchantToBestCat = {};
  for (const [merchant, cats] of Object.entries(merchantCats)) {
    let bestCat = '';
    let bestCount = 0;
    for (const [cat, count] of Object.entries(cats)) {
      if (count > bestCount) { bestCat = cat; bestCount = count; }
    }
    if (bestCat) merchantToBestCat[merchant] = bestCat;
  }

  // Group merchants by category, then extract common prefix per group
  const catToMerchants = {};
  for (const [merchant, cat] of Object.entries(merchantToBestCat)) {
    if (!catToMerchants[cat]) catToMerchants[cat] = [];
    catToMerchants[cat].push(merchant);
  }

  const rules = [];
  for (const [cat, merchants] of Object.entries(catToMerchants)) {
    const keywords = extractKeywordsFromGroup_(merchants);
    for (const kw of keywords) {
      rules.push({ keyword: kw, category: cat });
    }
  }

  // Ensure category sheet has header
  const catSheet = ss.getSheetByName('category');
  if (!catSheet) {
    Logger.log('category sheet not found');
    return;
  }
  if (catSheet.getLastRow() === 0 || String(catSheet.getRange(1, 1).getValue()) !== '交易關鍵字') {
    catSheet.getRange(1, 1, 1, 2).setValues([['交易關鍵字', '種類']]);
  }

  writeCategoryRulesBack_(ss, rules);
  Logger.log(`Bootstrap done. ${rules.length} rules created from existing transactions.`);
}
