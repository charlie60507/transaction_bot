#!/usr/bin/env node
/*
 * Minimal Linear issue creator for the PERSONAL workspace (team CT),
 * independent of the claude.ai Linear MCP connector (which stays on the
 * company account). Uses a personal API key read from env LINEAR_CT_KEY or
 * the gitignored .linear-key file. Never prints the key.
 *
 * Usage:
 *   node scripts/linear.js --whoami
 *   node scripts/linear.js --title "..." [--desc "..."] [--desc-file f.md] \
 *        [--priority 0..4] [--labels "a,b"] [--team CT] [--dry-run]
 *   node scripts/linear.js --file tickets.json          # batch (array of issues)
 *
 * tickets.json: [{ "title": "...", "description": "...", "priority": 3,
 *                  "labels": ["enhancement"] }, ...]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const API = 'https://api.linear.app/graphql';
const ROOT = path.resolve(__dirname, '..');

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

function getKey() {
  if (process.env.LINEAR_CT_KEY && process.env.LINEAR_CT_KEY.trim()) return process.env.LINEAR_CT_KEY.trim();
  const f = path.join(ROOT, '.linear-key');
  if (fs.existsSync(f)) {
    const k = fs.readFileSync(f, 'utf8').trim();
    if (k) return k;
  }
  die('No API key. Set env LINEAR_CT_KEY or put the key in .linear-key (gitignored).');
}

async function gql(key, query, variables) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Authorization': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: variables || {} })
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { die('Non-JSON response (' + res.status + '): ' + text.slice(0, 200)); }
  if (json.errors) die('Linear API error: ' + JSON.stringify(json.errors));
  return json.data;
}

function parseArgs(argv) {
  const a = { team: 'CT', priority: undefined, labels: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--whoami') a.whoami = true;
    else if (t === '--dry-run') a.dryRun = true;
    else if (t === '--title') a.title = argv[++i];
    else if (t === '--desc') a.description = argv[++i];
    else if (t === '--desc-file') a.description = fs.readFileSync(argv[++i], 'utf8');
    else if (t === '--priority') a.priority = Number(argv[++i]);
    else if (t === '--labels') a.labels = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (t === '--team') a.team = argv[++i];
    else if (t === '--file') a.file = argv[++i];
  }
  return a;
}

async function resolveTeam(key, teamKey) {
  const d = await gql(key, 'query($k:String!){ teams(filter:{key:{eq:$k}}){ nodes{ id key name } } }', { k: teamKey });
  const t = d.teams.nodes[0];
  if (!t) die('Team with key "' + teamKey + '" not found in this workspace.');
  return t;
}

async function resolveLabels(key, teamId, names) {
  if (!names || !names.length) return [];
  const d = await gql(key, 'query($t:ID!){ team(id:$t){ labels{ nodes{ id name } } } }', { t: teamId });
  const map = {};
  d.team.labels.nodes.forEach(l => { map[l.name.toLowerCase()] = l.id; });
  const ids = [];
  names.forEach(n => {
    const id = map[n.toLowerCase()];
    if (id) ids.push(id); else console.error('  (label "' + n + '" not found — skipped)');
  });
  return ids;
}

async function createIssue(key, team, issue, dryRun) {
  const labelIds = await resolveLabels(key, team.id, issue.labels || []);
  const input = { teamId: team.id, title: issue.title };
  if (issue.description) input.description = issue.description;
  if (issue.priority != null) input.priority = issue.priority;
  if (labelIds.length) input.labelIds = labelIds;
  if (dryRun) { console.log('  [dry-run] would create: ' + issue.title); return; }
  const d = await gql(key, 'mutation($i:IssueCreateInput!){ issueCreate(input:$i){ success issue{ identifier url } } }', { i: input });
  if (!d.issueCreate.success) die('issueCreate failed for: ' + issue.title);
  console.log('  ✓ ' + d.issueCreate.issue.identifier + '  ' + d.issueCreate.issue.url + '  — ' + issue.title);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const key = getKey();

  if (args.whoami) {
    const d = await gql(key, 'query{ viewer{ name email } }');
    console.log('✓ authenticated as ' + d.viewer.name + ' <' + d.viewer.email + '>');
    const t = await resolveTeam(key, args.team);
    console.log('✓ team ' + t.key + ' — ' + t.name + ' (' + t.id + ')');
    return;
  }

  const team = await resolveTeam(key, args.team);
  console.log((args.dryRun ? '[dry-run] ' : '') + 'team ' + team.key + ' — ' + team.name);

  let issues;
  if (args.file) {
    issues = JSON.parse(fs.readFileSync(args.file, 'utf8'));
    if (!Array.isArray(issues)) die('--file must contain a JSON array of issues');
  } else if (args.title) {
    issues = [{ title: args.title, description: args.description, priority: args.priority, labels: args.labels }];
  } else {
    die('Nothing to do. Use --whoami, --title "...", or --file tickets.json');
  }

  for (const it of issues) {
    if (!it.title) { console.error('  (skipped an entry with no title)'); continue; }
    await createIssue(key, team, it, args.dryRun);
  }
  console.log('Done (' + issues.length + ' issue' + (issues.length === 1 ? '' : 's') + ').');
})().catch(e => die(e && e.stack || String(e)));
