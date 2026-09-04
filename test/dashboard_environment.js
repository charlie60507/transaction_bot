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
    PRODUCTION_SPREADSHEET_ID: 'prod-sheet', PRODUCTION_DEPLOYMENT_ID: 'prod-deployment'
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

  const html = fs.readFileSync(PANEL, 'utf8');
  const script = extractInlineScript(html);
  assert.ok(html.includes("var ENVIRONMENT = '<?= environmentName ?>';"));
  assert.ok(script.includes('function environmentBadge()'));
  assert.ok(script.includes('sheetLink()+environmentBadge()'));

  const server = fs.readFileSync(path.resolve(__dirname, '..', 'sidebar', '程式碼.js'), 'utf8');
  assert.ok(server.includes('const ENV_CONFIG = loadEnvironmentConfig_();'));
  assert.ok(server.includes('SpreadsheetApp.openById(CFG.SPREADSHEET_ID)'));
  assert.ok(server.includes("if (ENV_CONFIG.environment !== 'STAGE')"));
  assert.ok(server.includes('function getEnvironmentInfo()'));
}

if (require.main === module) {
  run();
  console.log('✓ dashboard_environment');
} else {
  module.exports = { run };
}
