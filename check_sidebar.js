#!/usr/bin/env node
/*
 * Offline verifier for the bound Apps Script project (default: ./sidebar).
 *
 * Apps Script has no build step and no type checker: a typo'd server function
 * name or a stale CFG column constant only surfaces at runtime, in the user's
 * live dashboard. These checks catch that class of bug before `clasp push`.
 *
 * Checks
 *   1. every .js file parses (script-level, so top-level declarations are legal)
 *   2. every .json file parses
 *   3. every inline <script> block of every .html file parses
 *   4. every `google.script.run…<fn>()` call in the HTML resolves to a
 *      `function <fn>(` in one of the project's .js files
 *   5. every `CFG.<KEY>` reference resolves to a key of the CFG literal
 *
 * Usage:  node check_sidebar.js [project-dir]      # default ./sidebar
 * Exit 0 = clean, exit 1 = at least one failure (fail-loud; used as the CI gate).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.resolve(process.argv[2] || 'sidebar');
const CLIENT_WRAPPERS = /^with(SuccessHandler|FailureHandler|UserObject)$/;

const failures = [];
const notes = [];
function fail(msg) { failures.push(msg); }
function ok(msg) { notes.push(msg); }

if (!fs.existsSync(DIR)) {
  console.error('✗ project dir not found: ' + DIR);
  process.exit(1);
}

const files = fs.readdirSync(DIR).filter(f => !f.startsWith('.'));
const jsFiles = files.filter(f => f.endsWith('.js'));
const htmlFiles = files.filter(f => f.endsWith('.html'));
const jsonFiles = files.filter(f => f.endsWith('.json'));
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');

if (!jsFiles.length) fail('no .js files found in ' + DIR);

// ---- 1. .js files parse -----------------------------------------------------
jsFiles.forEach(f => {
  try { new vm.Script(read(f), { filename: f }); ok('parse ' + f); }
  catch (e) { fail('syntax error in ' + f + ': ' + e.message); }
});

// ---- 2. .json files parse ---------------------------------------------------
jsonFiles.forEach(f => {
  try { JSON.parse(read(f)); ok('parse ' + f); }
  catch (e) { fail('invalid JSON in ' + f + ': ' + e.message); }
});

// ---- 3. inline <script> blocks parse ---------------------------------------
htmlFiles.forEach(f => {
  const html = read(f);
  const blocks = html.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g) || [];
  if (!blocks.length) { ok(f + ': no inline script'); return; }
  blocks.forEach((b, i) => {
    const code = b.replace(/^<script(?:\s[^>]*)?>/, '').replace(/<\/script>$/, '');
    try { new vm.Script(code, { filename: f + ' <script#' + i + '>' }); ok('parse ' + f + ' <script#' + i + '> (' + code.split('\n').length + ' lines)'); }
    catch (e) { fail('syntax error in ' + f + ' <script#' + i + '>: ' + e.message); }
  });
});

// ---- 4. google.script.run calls resolve to server functions ----------------
// Walks each `google.script.run` chain paren-aware so handler callbacks (which
// themselves contain parens) do not confuse the scan.
function serverCallsIn(src) {
  const found = new Map();               // name -> 1-indexed line of the call
  const NEEDLE = 'google.script.run';
  const lineOf = pos => src.slice(0, pos).split('\n').length;
  let at = src.indexOf(NEEDLE);
  while (at !== -1) {
    let i = at + NEEDLE.length;
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] !== '.') break;
      i++;
      while (i < src.length && /\s/.test(src[i])) i++;
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      if (!m) break;
      const name = m[0];
      const namePos = i;
      i += name.length;
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] !== '(') break;
      let depth = 0;                     // skip the balanced argument list
      do {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
        i++;
      } while (i < src.length && depth > 0);
      if (!CLIENT_WRAPPERS.test(name) && !found.has(name)) found.set(name, lineOf(namePos));
    }
    at = src.indexOf(NEEDLE, at + 1);
  }
  return found;
}

const serverFns = new Set();
jsFiles.forEach(f => {
  const src = read(f);
  const re = /(?:^|\s)function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) serverFns.add(m[1]);
});

let callCount = 0;
htmlFiles.forEach(f => {
  serverCallsIn(read(f)).forEach((line, name) => {
    callCount++;
    if (serverFns.has(name)) ok('google.script.run.' + name + '() → resolved');
    else fail(f + ':' + line + ' calls google.script.run.' + name + '() but no `function ' + name + '(` exists in ' + jsFiles.join(', '));
  });
});
if (callCount === 0) ok('no google.script.run calls found');

// ---- 5. CFG.<KEY> references resolve --------------------------------------
// Extract the CFG literal brace-aware, then compare against every CFG.X usage
// across the whole project (server .js and client HTML alike).
function cfgKeys(src) {
  const m = /(?:const|var|let)\s+CFG\s*=\s*\{/.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length - 1, depth = 0, start = i;
  do {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  } while (i < src.length && depth > 0);
  const body = src.slice(start + 1, i - 1);
  const keys = new Set();
  const re = /(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:/g;
  let k;
  while ((k = re.exec(body))) keys.add(k[1]);
  return keys;
}

let keys = null, keySrc = '';
for (const f of jsFiles) {
  const found = cfgKeys(read(f));
  if (found) { keys = found; keySrc = f; break; }
}

if (!keys) {
  ok('no CFG literal found — skipping CFG reference check');
} else {
  const used = new Map();                // key -> "file:line"
  [...jsFiles, ...htmlFiles].forEach(f => {
    const src = read(f);
    const re = /\bCFG\.([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(src))) {
      if (!used.has(m[1])) used.set(m[1], f + ':' + src.slice(0, m.index).split('\n').length);
    }
  });
  used.forEach((where, key) => {
    if (keys.has(key)) ok('CFG.' + key + ' → defined');
    else fail(where + ' references CFG.' + key + ' which is not a key of the CFG literal in ' + keySrc);
  });
  ok('CFG literal in ' + keySrc + ' has ' + keys.size + ' keys; ' + used.size + ' referenced');
}

// ---- 6. dashboard fixture tests (behavior; syntax checks above do not prove it)
const testDir = path.resolve(__dirname, 'test');
if (fs.existsSync(testDir)) {
  const tests = fs.readdirSync(testDir).filter(f => /^dashboard_.*\.js$/.test(f)).sort();
  tests.forEach(f => {
    const full = path.join(testDir, f);
    try {
      delete require.cache[require.resolve(full)];
      const mod = require(full);
      if (typeof mod.run !== 'function') fail('fixture ' + f + ' does not export run()');
      else { mod.run(); ok('fixture ' + f); }
    } catch (e) {
      fail('fixture ' + f + ': ' + (e && e.stack ? e.stack.split('\n')[0] : e));
    }
  });
}

// ---- report ---------------------------------------------------------------
console.log('checked ' + DIR);
console.log('  files: ' + jsFiles.length + ' js, ' + htmlFiles.length + ' html, ' + jsonFiles.length + ' json');
if (process.env.CHECK_VERBOSE) notes.forEach(n => console.log('  · ' + n));
else console.log('  ' + notes.length + ' checks passed (CHECK_VERBOSE=1 to list)');

if (failures.length) {
  console.error('\n✗ ' + failures.length + ' failure' + (failures.length === 1 ? '' : 's') + ':');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('✓ all checks passed');
