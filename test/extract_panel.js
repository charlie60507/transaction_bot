'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PANEL = path.resolve(__dirname, '..', 'sidebar', 'ToolPanel.html');

function extractInlineScript(html) {
  const m = html.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no inline <script> in ToolPanel.html');
  return m[1];
}

function lastNonSpace(src, j) {
  for (let k = j - 1; k >= 0; k--) {
    if (!/\s/.test(src[k])) return src[k];
  }
  return '';
}

function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('function ' + name + ' not found in ToolPanel.html');
  const i = src.indexOf('{', m.index);
  if (i < 0) throw new Error('function ' + name + ': no opening brace');
  let depth = 0;
  let quote = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    const prev = j > 0 ? src[j - 1] : '';
    if (quote) {
      if (c === quote && prev !== '\\') quote = null;
      continue;
    }
    if (c === '/' && src[j + 1] === '/') {
      const nl = src.indexOf('\n', j);
      j = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === '/' && src[j + 1] === '*') {
      const end = src.indexOf('*/', j + 2);
      j = end < 0 ? src.length : end + 1;
      continue;
    }
    if (c === '/' && ',=([!&|?:;{'.includes(lastNonSpace(src, j))) {
      j++;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') {
          j++;
          while (j < src.length && src[j] !== ']') {
            if (src[j] === '\\') j++;
            j++;
          }
          continue;
        }
        if (src[j] === '/') break;
        j++;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(m.index, j + 1);
    }
  }
  throw new Error('function ' + name + ': unclosed brace');
}

function loadFns(names, extras) {
  const html = fs.readFileSync(PANEL, 'utf8');
  const script = extractInlineScript(html);
  const sandbox = Object.assign({ console: console }, extras || {});
  vm.createContext(sandbox);
  vm.runInContext(names.map(n => extractFunction(script, n)).join('\n'), sandbox);
  return sandbox;
}

module.exports = { extractInlineScript, extractFunction, loadFns, PANEL };
