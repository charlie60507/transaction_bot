/** ===== Shared config (loaded from Script Properties to avoid hardcoding secrets) ===== */
const CONFIG = loadConfig_();
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

/** ===== Entry: append last 15 days for both banks; Cathay-style logs ===== */
function appendLast15DaysToSheet() {
  const lock = LockService.getScriptLock();
  try {
    lock.tryLock(20 * 1000);

    const sh = getOrCreateSheet_();
    ensureHeaderAndCheckbox_(sh);

    // Last 15-day window (inclusive, Taiwan timezone)
    const { start15d0, today0, ymdStart15d, ymdToday } = timeWindow15d_();

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
        'after:' + fmtYMD_(start15d0),
        'before:' + fmtYMD_(addDays_(today0, 1))
      ].join(' ');
      const threads = GmailApp.search(q, 0, 500);
      for (const th of threads) {
        for (const msg of th.getMessages()) {
          const parsed = parseFubonEmail_(msg);
          if (!parsed) continue;
          const { id, dateStr, dt, last4, amount, merchant, category, link } = parsed;
          if (dateStr < ymdStart15d || dateStr > ymdToday) continue;

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
          if (!existingKeySet.has(key)) {
            existingKeySet.add(key);
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
      const q = `label:"${CFG.CATHAY_LABEL}" subject:"${CFG.CATHAY_SUBJECT}" after:${fmtYMD_(start15d0)} before:${fmtYMD_(addDays_(today0, 1))}`;
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
            if (ymd < ymdStart15d || ymd > ymdToday) continue;

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
            if (!existingKeySet.has(key)) {
              existingKeySet.add(key);
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
      const q = `from:cathaybk subject:"CUBE App轉帳通知" after:${fmtYMD_(start15d0)} before:${fmtYMD_(addDays_(today0, 1))}`;
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
          if (dateStr < ymdStart15d || dateStr > ymdToday) continue;

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
          const looseKey = makeLooseDedupKey_({ bank: '國泰', dt, last4: row[3], amount: row[4] });

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
    }

    // Checkbox validation, sort, freeze header
    applyCheckboxValidation_(sh);
    sortByAuthTime_(sh, true);
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

function sortByAuthTime_(sh, ascending) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow <= 2) return;
  const range = sh.getRange(2, 1, lastRow - 1, lastCol);
  range.sort([
    { column: 3, ascending: !!ascending }, // column C: auth datetime
    { column: 9, ascending: true }         // secondary key: MessageId (stable)
  ]);
}

// Last 15-day window (inclusive) using Taiwan timezone
function timeWindow15d_() {
  const now = new Date();
  const todayStr = Utilities.formatDate(now, TZ, 'yyyy/MM/dd') + ' 00:00:00';
  const today0 = new Date(todayStr);
  const start15d0 = addDays_(today0, -14);
  const ymdStart15d = Utilities.formatDate(start15d0, TZ, 'yyyy/MM/dd');
  const ymdToday = Utilities.formatDate(today0, TZ, 'yyyy/MM/dd');
  return { start15d0, today0, ymdStart15d, ymdToday };
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

/** Build LOOSE dedup key: bank + auth datetime + last4 + amount (no MessageId) */
function makeLooseDedupKey_({ bank, dt, last4, amount }) {
  const ymdhms = Utilities.formatDate(dt, TZ, 'yyyy/MM/dd HH:mm:ss');
  return [bank || '', ymdhms, String(last4 || ''), String(amount || '')].join('|');
}

/** Build LOOSE dedup key from row */
function makeLooseDedupKeyFromRow_(row) {
  const bank = String(row[1] || '');
  const dt = row[2] instanceof Date ? row[2] : new Date(row[2]);
  const last4 = String(row[3] || '');
  const amount = String(row[4] || '');
  return makeLooseDedupKey_({ bank, dt, last4, amount });
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
    }
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
