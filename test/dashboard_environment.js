'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { extractFunction, extractInlineScript, PANEL } = require('./extract_panel');

function loadResolver() {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'sidebar', '程式碼.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(src, 'resolveEnvironmentConfig_'), sandbox);
  return sandbox.resolveEnvironmentConfig_;
}

function base(overrides) {
  return Object.assign({
    ENVIRONMENT: 'STAGE', SCRIPT_ID: 'stage-script', SPREADSHEET_ID: 'stage-sheet',
    DEPLOYMENT_ID: 'stage-deployment', PRODUCTION_SCRIPT_ID: 'prod-script',
    PRODUCTION_SPREADSHEET_ID: 'prod-sheet', PRODUCTION_DEPLOYMENT_ID: 'prod-deployment',
    DEPLOYMENT_SCRIPT_ID: 'stage-script'
  }, overrides || {});
}

function run() {
  const resolve = loadResolver();
  assert.strictEqual(resolve(base(), 'stage-script').environment, 'STAGE');
  assert.strictEqual(resolve(base({ ENVIRONMENT: 'production', SCRIPT_ID: 'prod-script', SPREADSHEET_ID: 'prod-sheet', DEPLOYMENT_ID: 'prod-deployment' }), 'prod-script').environment, 'PRODUCTION');
  assert.throws(() => resolve(base({ ENVIRONMENT: '' }), 'stage-script'), /ENVIRONMENT/);
  assert.throws(() => resolve(base(), 'prod-script'), /SCRIPT_ID/);
  assert.throws(() => resolve(base({ SPREADSHEET_ID: 'prod-sheet' }), 'stage-script'), /Production spreadsheet/);
  assert.throws(() => resolve(base({ DEPLOYMENT_ID: 'prod-deployment' }), 'stage-script'), /Production deployment/);
  assert.throws(() => resolve(base({ PRODUCTION_DEPLOYMENT_ID: '' }), 'stage-script'), /Production fence/);
  assert.throws(() => resolve(base({ DEPLOYMENT_SCRIPT_ID: 'other-script' }), 'stage-script'), /bound to SCRIPT_ID/);

  const html = fs.readFileSync(PANEL, 'utf8');
  const script = extractInlineScript(html);
  assert.ok(html.includes("var ENVIRONMENT = '<?= environmentName ?>';"));
  assert.ok(script.includes('function environmentBadge()'));
  assert.ok(script.includes('sheetLink()+environmentBadge()'));

  const server = fs.readFileSync(path.resolve(__dirname, '..', 'sidebar', '程式碼.js'), 'utf8');
  assert.ok(server.includes('const ENV_CONFIG = loadEnvironmentConfig_(true);'));
  assert.ok(server.includes('function requireEnvironmentConfig_()'));
  assert.ok(server.includes("SpreadsheetApp.openById(requireEnvironmentConfig_().spreadsheetId)"));
  assert.ok(server.includes("return 'https://script.google.com/macros/s/' + encodeURIComponent(config.deploymentId) + '/exec';"));
  assert.ok(server.includes("if (ENV_CONFIG.environment !== 'STAGE')"));
  assert.ok(server.includes("['交易關鍵字', '種類', '', '種類清單', 'TAG清單']"));
  assert.ok(server.includes('function getEnvironmentInfo()'));

  const bot = fs.readFileSync(path.resolve(__dirname, '..', 'sidebar', 'cards_transaction_bot.js'), 'utf8');
  assert.ok(bot.includes('let CONFIG = loadConfig_(true);'));
  assert.ok(bot.includes('function ensureBotConfig_()'));
  assert.ok(bot.includes('function setScriptProperties(obj)'));
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_environment');
} else {
  module.exports = { run };
}
