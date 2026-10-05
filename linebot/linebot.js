// =======================================================================
//   LINE webhook — record a transaction from one free-text message
// =======================================================================
//
// This project only receives the webhook and talks to LINE. Every read and write of the sheet
// goes through the dashboard project, included as the library `Ledger` (sidebar/line_ledger.js),
// so LINE rows are written by the dashboard's own code under the dashboard's own script lock.
//
// Script Properties of THIS project (values are never committed and never logged):
//   CHANNEL_ACCESS_TOKEN  LINE channel access token (reply API only)
//   OWNER_USER_ID         the only LINE userId whose events are honoured
//   WEBHOOK_SECRET        must arrive as ?k=<secret> on the webhook URL
// Runtime keys it maintains itself: evt:<webhookEventId> (7 days), pend:<token> (24 hours),
// done:<token> (24 hours; tells a double tap from an expired choice).
//
// Apps Script cannot read request headers, so X-Line-Signature cannot be verified. The URL
// secret plus the owner userId gate is the accepted substitute for a single-user bot. Nothing
// that fails either check gets a write or a reply.

var LB_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
var LB_TZ = 'Asia/Taipei';
var LB_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
var LB_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** Webhook entry. Always answers 200: LINE retries on errors, and anything this code does not
 *  honour (bad secret, a stranger, an unknown event) must look identical to the caller. */
function doPost(e) {
  try {
    lbHandleWebhook_(e);
  } catch (err) {
    // Never log `e`: its query string carries the webhook secret.
    console.error('linebot: ' + (err && err.message ? err.message : err));
  }
  return ContentService.createTextOutput('OK');
}

function lbHandleWebhook_(e) {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('WEBHOOK_SECRET');
  const given = e && e.parameter && e.parameter.k != null ? String(e.parameter.k) : '';
  if (!secret || !lbSafeEqual_(given, secret)) return;

  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return; }
  const events = body && Array.isArray(body.events) ? body.events : [];
  if (!events.length) return;                      // the console's Verify sends no events

  const owner = props.getProperty('OWNER_USER_ID');
  const token = props.getProperty('CHANNEL_ACCESS_TOKEN');
  if (!owner || !token) { console.error('linebot: required Script Properties are not set'); return; }
  events.forEach(function (evt) { lbHandleEvent_(evt, props, owner, token); });
}

/** One event: owner gate → dedupe → route → reply → mark seen, under this project's lock. */
function lbHandleEvent_(evt, props, owner, token) {
  if (!evt || !evt.source || evt.source.userId !== owner) return;
  const eventId = String(evt.webhookEventId || '');
  const lock = LockService.getScriptLock();
  lock.waitLock(30 * 1000);
  try {
    const now = Date.now();
    lbPrune_(props, now);
    if (eventId && props.getProperty('evt:' + eventId)) return;
    try {
      let messages;
      try {
        messages = lbRoute_(evt, props, now);
      } catch (err) {
        console.error('linebot: event failed: ' + (err && err.message ? err.message : err));
        messages = [lbText_('處理失敗：' + (err && err.message ? err.message : '未知錯誤') + '。請到記帳面板確認。')];
      }
      if (messages && messages.length && evt.replyToken) lbReply_(token, evt.replyToken, messages);
    } finally {
      // Marked even when routing failed: a redelivery must never write a second row.
      if (eventId) props.setProperty('evt:' + eventId, String(now));
    }
  } finally {
    lock.releaseLock();
  }
}

function lbRoute_(evt, props, now) {
  if (evt.type === 'message' && evt.message && evt.message.type === 'text') {
    return lbOnText_(String(evt.message.text || ''), props, now, String(evt.webhookEventId || lbToken_()));
  }
  if (evt.type === 'postback' && evt.postback) {
    const p = lpDecodePostback(evt.postback.data);
    if (!p) return [];
    if (p.action === 'undo') return lbOnUndo_(p.rowId);
    if (p.action === 'pick') return lbOnPick_(props, p.token, p.index, now);
    if (p.action === 'cancel') return lbOnCancel_(props, p.token, now);
  }
  return [];
}

// ---- message → rows ------------------------------------------------------

function lbOnText_(text, props, now, group) {
  if (!text.trim()) return [];
  const ctx = Ledger.ledgerContext();
  const today = Utilities.formatDate(new Date(now), LB_TZ, 'yyyy-MM-dd');
  let parsed;
  try {
    parsed = Ledger.ledgerParse(text, today, ctx.accounts);
  } catch (err) {
    // Fail closed: no entry from a failed or unreadable parse is ever written.
    console.error('linebot: parse failed: ' + (err && err.message ? err.message : err));
    return [lbText_(lpErrorText())];
  }
  const v = lpValidateEntries(parsed && parsed.entries, text);
  if (!v.ok) return [lbText_(lpNotUnderstoodText())];

  const cats = Ledger.ledgerCategorize(v.entries.map(function (e) { return e.merchant; })) || [];
  const write = [];
  const pending = [];
  v.entries.forEach(function (e, i) {
    e.cat = String(cats[i] || '');
    const r = lpResolveAccount(e, ctx.accounts);
    if (r.kind === 'unmatched') pending.push(e);
    else write.push(Object.assign({}, e, { account: r.account }));
  });

  const messages = [];
  if (write.length) messages.push(lbWrittenFlex_(Ledger.ledgerAdd(write.map(lbAddFields_))));
  if (pending.length) {
    const tokens = pending.map(function (e, seq) { return lbSavePending_(props, e, ctx.accounts, group, seq, now); });
    messages.push(lbPendingPrompt_(props, tokens[0]));
  }
  return messages;
}

function lbAddFields_(e) {
  return { date: e.date, time: e.time, amount: e.amount, type: e.type, account: e.account, merchant: e.merchant, cat: e.cat };
}

// ---- pending account choices ---------------------------------------------

function lbSavePending_(props, entry, candidates, group, seq, now) {
  const choices = lpChoices(entry.accountText, candidates);
  const token = lbToken_();
  props.setProperty('pend:' + token, JSON.stringify({
    entry: entry, choices: choices.shown, truncated: choices.truncated,
    created: now, group: group, seq: seq
  }));
  return token;
}

function lbPendingPrompt_(props, token) {
  const p = JSON.parse(props.getProperty('pend:' + token));
  const items = p.choices.map(function (name, i) {
    return { type: 'action', action: { type: 'postback', label: String(name).slice(0, 20), data: lpEncodePick(token, i), displayText: String(name) } };
  });
  items.push({ type: 'action', action: { type: 'postback', label: '取消', data: lpEncodeCancel(token), displayText: '取消' } });
  const msg = lbText_(lpPendingText(p.entry, p.truncated));
  msg.quickReply = { items: items };
  return msg;
}

/** The next still-open choice from the same message, so several unmatched entries are asked
 *  one at a time. */
function lbNextPending_(props, group, now) {
  const all = props.getProperties();
  let best = null;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('pend:') !== 0) return;
    let p;
    try { p = JSON.parse(all[k]); } catch (err) { return; }
    if (p.group !== group || now - p.created > LB_PENDING_TTL_MS) return;
    if (!best || p.seq < best.seq) best = { token: k.slice(5), seq: p.seq };
  });
  return best ? best.token : null;
}

/** Missing choice: a tombstone means it was used or cancelled; otherwise it expired. */
function lbGoneText_(props, token) {
  return props.getProperty('done:' + token) ? '這筆已處理' : '選擇已過期，請重新傳送';
}

function lbOnPick_(props, token, index, now) {
  const raw = props.getProperty('pend:' + token);
  if (!raw) return [lbText_(lbGoneText_(props, token))];
  const p = JSON.parse(raw);
  if (now - p.created > LB_PENDING_TTL_MS) {
    props.deleteProperty('pend:' + token);
    return [lbText_('選擇已過期，請重新傳送')];
  }
  const account = p.choices[index];
  if (account == null) return [lbText_('選擇已過期，請重新傳送')];
  // Written first, consumed right after, both under this project's lock: a double tap is
  // serialised behind this one and finds the tombstone. A failed write keeps the choice open.
  const rows = Ledger.ledgerAdd([lbAddFields_(Object.assign({}, p.entry, { account: account }))]);
  props.deleteProperty('pend:' + token);
  props.setProperty('done:' + token, String(now));
  const messages = [lbWrittenFlex_(rows)];
  const next = lbNextPending_(props, p.group, now);
  if (next) messages.push(lbPendingPrompt_(props, next));
  return messages;
}

function lbOnCancel_(props, token, now) {
  const raw = props.getProperty('pend:' + token);
  if (!raw) return [lbText_(lbGoneText_(props, token))];
  const p = JSON.parse(raw);
  props.deleteProperty('pend:' + token);
  props.setProperty('done:' + token, String(now));
  const messages = [lbText_('已取消')];
  const next = lbNextPending_(props, p.group, now);
  if (next) messages.push(lbPendingPrompt_(props, next));
  return messages;
}

// ---- undo -----------------------------------------------------------------

function lbOnUndo_(rowId) {
  const status = Ledger.ledgerUndo(rowId);
  return [lbText_(status === 'deleted' ? '已撤銷' : '這筆已不存在')];
}

// ---- housekeeping --------------------------------------------------------

/** Drop seen events after 7 days and choices / tombstones after 24 hours. Runs on every call. */
function lbPrune_(props, now) {
  const all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    let created = NaN;
    let ttl = 0;
    if (k.indexOf('evt:') === 0) { created = Number(all[k]); ttl = LB_EVENT_TTL_MS; }
    else if (k.indexOf('done:') === 0) { created = Number(all[k]); ttl = LB_PENDING_TTL_MS; }
    else if (k.indexOf('pend:') === 0) {
      try { created = Number(JSON.parse(all[k]).created); } catch (err) { created = 0; }
      ttl = LB_PENDING_TTL_MS;
    } else return;
    if (isNaN(created) || now - created > ttl) props.deleteProperty(k);
  });
}

function lbToken_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function lbSafeEqual_(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// ---- LINE messages -------------------------------------------------------

function lbText_(text) {
  return { type: 'text', text: String(text).slice(0, 5000) };
}

/** One row per written entry, each with a persistent 撤銷 postback carrying its 交易 ID. */
function lbWrittenFlex_(rows) {
  const lines = rows.map(lpWrittenLine);
  return {
    type: 'flex',
    altText: lines.join('\n').slice(0, 400),
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: rows.map(function (r, i) {
          const parts = [{ type: 'text', text: lines[i], wrap: true, size: 'sm', flex: 5 }];
          if (r.rowId) {
            parts.push({
              type: 'button', style: 'secondary', height: 'sm', flex: 2,
              action: { type: 'postback', label: '撤銷', data: lpEncodeUndo(r.rowId), displayText: '撤銷' }
            });
          }
          return { type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center', contents: parts };
        })
      }
    }
  };
}

/** Reply API only. The push endpoint is never called: replies are free, pushes are metered. */
function lbReply_(token, replyToken, messages) {
  const res = UrlFetchApp.fetch(LB_REPLY_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages.slice(0, 5) }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) console.error('linebot: reply HTTP ' + res.getResponseCode());
}
