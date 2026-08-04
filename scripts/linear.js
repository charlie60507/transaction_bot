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
 *   node scripts/linear.js --list                       # list team issues + status
 *   node scripts/linear.js --set "CT-6=Done" [--set "CT-10=In Progress"] [--dry-run]
 *   node scripts/linear.js --comment CT-14 --body "..." | --body-file note.md [--dry-run]
 *   node scripts/linear.js --add-label "CT-11=ready-to-dev" [--rm-label "CT-11=need-revision"]
 *   node scripts/linear.js --assign "CT-11=me"           # me | none | name | email
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

function getDefaultTeam() {
  if (process.env.LINEAR_TEAM && process.env.LINEAR_TEAM.trim()) return process.env.LINEAR_TEAM.trim();
  const f = path.join(ROOT, '.linear-team');
  if (fs.existsSync(f)) { const t = fs.readFileSync(f, 'utf8').trim(); if (t) return t; }
  return 'CT';
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
  const a = { team: null, priority: undefined, labels: [], sets: [], addLabels: [], rmLabels: [], assigns: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--whoami') a.whoami = true;
    else if (t === '--teams') a.teams = true;
    else if (t === '--list') a.list = true;
    else if (t === '--dry-run') a.dryRun = true;
    else if (t === '--title') a.title = argv[++i];
    else if (t === '--desc') a.description = argv[++i];
    else if (t === '--desc-file') a.description = fs.readFileSync(argv[++i], 'utf8');
    else if (t === '--priority') a.priority = Number(argv[++i]);
    else if (t === '--labels') a.labels = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (t === '--team') a.team = argv[++i];
    else if (t === '--file') a.file = argv[++i];
    else if (t === '--set') a.sets.push(argv[++i]);
    else if (t === '--get') a.get = argv[++i];
    else if (t === '--comment') a.comment = argv[++i];
    else if (t === '--body') a.body = argv[++i];
    else if (t === '--body-file') a.body = fs.readFileSync(argv[++i], 'utf8');
    else if (t === '--add-label') a.addLabels.push(argv[++i]);
    else if (t === '--rm-label') a.rmLabels.push(argv[++i]);
    else if (t === '--assign') a.assigns.push(argv[++i]);
  }
  return a;
}

// "CT-11=ready-to-dev" -> { ident: 'CT-11', value: 'ready-to-dev' }
function splitPair(spec, flag) {
  const eq = spec.indexOf('=');
  if (eq === -1) die(flag + ' expects "IDENTIFIER=VALUE", got: ' + spec);
  const ident = spec.slice(0, eq).trim();
  const value = spec.slice(eq + 1).trim();
  if (!ident || !value) die(flag + ' expects "IDENTIFIER=VALUE", got: ' + spec);
  return { ident, value };
}

async function resolveTeam(key, teamKey) {
  const d = await gql(key, 'query($k:String!){ teams(filter:{key:{eq:$k}}){ nodes{ id key name } } }', { k: teamKey });
  const t = d.teams.nodes[0];
  if (!t) die('Team with key "' + teamKey + '" not found in this workspace.');
  return t;
}

async function resolveLabels(key, teamId, names) {
  if (!names || !names.length) return [];
  const d = await gql(key, 'query($t:String!){ team(id:$t){ labels{ nodes{ id name } } } }', { t: teamId });
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

async function fetchIssues(key, teamId) {
  const d = await gql(key, 'query($t:String!){ team(id:$t){ issues(first:100){ nodes{ id identifier title priority state{ name type } url } } } }', { t: teamId });
  return d.team.issues.nodes.sort((a, b) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true }));
}

async function fetchStates(key, teamId) {
  const d = await gql(key, 'query($t:String!){ team(id:$t){ states{ nodes{ id name type } } } }', { t: teamId });
  const map = {};
  d.team.states.nodes.forEach(s => { map[s.name.toLowerCase()] = s.id; });
  return map;
}

async function fetchOneIssue(key, teamId, identifier) {
  // identifier like "CT-13" -> number 13
  const num = Number(String(identifier).split('-').pop());
  if (!num) die('Bad identifier: ' + identifier);
  const d = await gql(key,
    'query($t:String!,$n:Float!){ team(id:$t){ issues(filter:{number:{eq:$n}}){ nodes{ id identifier title description priority url state{ name type } assignee{ name email } labels{ nodes{ name } } } } } }',
    { t: teamId, n: num });
  return (d.team.issues.nodes || [])[0] || null;
}

async function setStatus(key, teamId, spec, dryRun) {
  // spec: "CT-6=Done"
  const eq = spec.indexOf('=');
  if (eq === -1) die('--set expects "IDENTIFIER=State name" (e.g. "CT-6=Done"), got: ' + spec);
  const ident = spec.slice(0, eq).trim();
  const stateName = spec.slice(eq + 1).trim();
  const issues = await fetchIssues(key, teamId);
  const issue = issues.find(i => i.identifier.toLowerCase() === ident.toLowerCase());
  if (!issue) die('Issue "' + ident + '" not found in this team.');
  const states = await fetchStates(key, teamId);
  const stateId = states[stateName.toLowerCase()];
  if (!stateId) die('State "' + stateName + '" not found. Available: ' + Object.keys(states).join(', '));
  if (issue.state.name.toLowerCase() === stateName.toLowerCase()) {
    console.log('  = ' + issue.identifier + '  already "' + issue.state.name + '" — no change');
    return;
  }
  if (dryRun) { console.log('  [dry-run] ' + issue.identifier + '  "' + issue.state.name + '" → "' + stateName + '"'); return; }
  const d = await gql(key, 'mutation($id:String!,$s:String!){ issueUpdate(id:$id, input:{stateId:$s}){ success issue{ identifier state{ name } } } }', { id: issue.id, s: stateId });
  if (!d.issueUpdate.success) die('issueUpdate failed for ' + ident);
  console.log('  ✓ ' + d.issueUpdate.issue.identifier + '  → "' + d.issueUpdate.issue.state.name + '"');
}

async function addComment(key, teamId, identifier, body, dryRun) {
  if (!body || !body.trim()) die('--comment needs a body: pass --body "..." or --body-file note.md');
  const issue = await fetchOneIssue(key, teamId, identifier);
  if (!issue) die('Issue "' + identifier + '" not found in this team.');
  if (dryRun) {
    console.log('  [dry-run] would comment on ' + issue.identifier + ' (' + body.length + ' chars)');
    return;
  }
  const d = await gql(key,
    'mutation($i:String!,$b:String!){ commentCreate(input:{issueId:$i, body:$b}){ success comment{ id url } } }',
    { i: issue.id, b: body });
  if (!d.commentCreate.success) die('commentCreate failed for ' + identifier);
  console.log('  ✓ commented on ' + issue.identifier + '  ' + d.commentCreate.comment.url);
}

async function teamLabelMap(key, teamId) {
  const d = await gql(key, 'query($t:String!){ team(id:$t){ labels{ nodes{ id name } } } }', { t: teamId });
  const map = {};
  d.team.labels.nodes.forEach(l => { map[l.name.toLowerCase()] = { id: l.id, name: l.name }; });
  return map;
}

// Pipeline labels (ready-to-dev, need-revision, dispatcher-*-in-flight …) do not
// exist in a fresh personal workspace, so create on first use rather than failing.
async function ensureLabel(key, teamId, name, dryRun) {
  const map = await teamLabelMap(key, teamId);
  const hit = map[name.toLowerCase()];
  if (hit) return hit.id;
  if (dryRun) { console.log('  [dry-run] would create team label "' + name + '"'); return null; }
  const d = await gql(key,
    'mutation($i:IssueLabelCreateInput!){ issueLabelCreate(input:$i){ success issueLabel{ id name } } }',
    { i: { teamId: teamId, name: name } });
  if (!d.issueLabelCreate.success) die('issueLabelCreate failed for "' + name + '"');
  console.log('  + created team label "' + name + '"');
  return d.issueLabelCreate.issueLabel.id;
}

async function changeLabel(key, teamId, spec, add, dryRun) {
  const flag = add ? '--add-label' : '--rm-label';
  const { ident, value: name } = splitPair(spec, flag);
  const issue = await fetchOneIssue(key, teamId, ident);
  if (!issue) die('Issue "' + ident + '" not found in this team.');
  const have = (issue.labels && issue.labels.nodes || []).map(l => l.name.toLowerCase());
  const has = have.indexOf(name.toLowerCase()) !== -1;
  if (add && has) { console.log('  = ' + issue.identifier + '  already labelled "' + name + '" — no change'); return; }
  if (!add && !has) { console.log('  = ' + issue.identifier + '  has no label "' + name + '" — no change'); return; }
  if (!add) {
    const map = await teamLabelMap(key, teamId);
    const hit = map[name.toLowerCase()];
    if (!hit) die('Label "' + name + '" does not exist in this team.');
    if (dryRun) { console.log('  [dry-run] ' + issue.identifier + '  − label "' + name + '"'); return; }
    const d = await gql(key, 'mutation($id:String!,$l:String!){ issueRemoveLabel(id:$id, labelId:$l){ success } }', { id: issue.id, l: hit.id });
    if (!d.issueRemoveLabel.success) die('issueRemoveLabel failed for ' + ident);
    console.log('  ✓ ' + issue.identifier + '  − label "' + name + '"');
    return;
  }
  const labelId = await ensureLabel(key, teamId, name, dryRun);
  if (dryRun) { console.log('  [dry-run] ' + issue.identifier + '  + label "' + name + '"'); return; }
  const d = await gql(key, 'mutation($id:String!,$l:String!){ issueAddLabel(id:$id, labelId:$l){ success } }', { id: issue.id, l: labelId });
  if (!d.issueAddLabel.success) die('issueAddLabel failed for ' + ident);
  console.log('  ✓ ' + issue.identifier + '  + label "' + name + '"');
}

async function setAssignee(key, teamId, spec, dryRun) {
  const { ident, value } = splitPair(spec, '--assign');
  const issue = await fetchOneIssue(key, teamId, ident);
  if (!issue) die('Issue "' + ident + '" not found in this team.');
  let assigneeId = null, label = '(unassigned)';
  if (value !== 'none' && value !== '@none') {
    if (value === 'me' || value === '@me') {
      const d = await gql(key, 'query{ viewer{ id name } }');
      assigneeId = d.viewer.id; label = d.viewer.name;
    } else {
      const d = await gql(key, 'query($q:String!){ users(filter:{or:[{name:{containsIgnoreCase:$q}},{email:{containsIgnoreCase:$q}}]}){ nodes{ id name email } } }', { q: value });
      const u = (d.users.nodes || [])[0];
      if (!u) die('No workspace user matches "' + value + '". Use "me", "none", a name, or an email.');
      assigneeId = u.id; label = u.name;
    }
  }
  const cur = issue.assignee ? issue.assignee.name : '(unassigned)';
  if (cur === label) { console.log('  = ' + issue.identifier + '  already assigned to ' + label + ' — no change'); return; }
  if (dryRun) { console.log('  [dry-run] ' + issue.identifier + '  ' + cur + ' → ' + label); return; }
  const d = await gql(key, 'mutation($id:String!,$a:String){ issueUpdate(id:$id, input:{assigneeId:$a}){ success } }', { id: issue.id, a: assigneeId });
  if (!d.issueUpdate.success) die('issueUpdate(assignee) failed for ' + ident);
  console.log('  ✓ ' + issue.identifier + '  → ' + label);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const key = getKey();
  if (!args.team) args.team = getDefaultTeam();

  if (args.teams) {
    const d = await gql(key, 'query{ teams{ nodes{ key name } } }');
    d.teams.nodes.forEach(t => console.log('  ' + t.key + ' — ' + t.name));
    return;
  }

  if (args.whoami) {
    const d = await gql(key, 'query{ viewer{ name email } }');
    console.log('✓ authenticated as ' + d.viewer.name + ' <' + d.viewer.email + '>');
    const t = await resolveTeam(key, args.team);
    console.log('✓ team ' + t.key + ' — ' + t.name + ' (' + t.id + ')');
    return;
  }

  const team = await resolveTeam(key, args.team);
  console.log((args.dryRun ? '[dry-run] ' : '') + 'team ' + team.key + ' — ' + team.name);

  if (args.get) {
    const it = await fetchOneIssue(key, team.id, args.get);
    if (!it) die('Issue "' + args.get + '" not found in team ' + team.key + '.');
    const labels = (it.labels && it.labels.nodes || []).map(l => l.name);
    console.log('identifier: ' + it.identifier);
    console.log('title: ' + it.title);
    console.log('state: ' + it.state.name + ' (' + it.state.type + ')');
    console.log('priority: P' + it.priority);
    console.log('labels: ' + (labels.join(', ') || '(none)'));
    console.log('assignee: ' + (it.assignee ? it.assignee.name + ' <' + it.assignee.email + '>' : '(unassigned)'));
    console.log('url: ' + it.url);
    console.log('--- description ---');
    console.log(it.description || '(empty)');
    return;
  }

  if (args.list) {
    const nodes = await fetchIssues(key, team.id);
    nodes.forEach(i => console.log('  ' + i.identifier.padEnd(7) + '[' + i.state.name + ']  P' + i.priority + '  ' + i.title));
    console.log('Total: ' + nodes.length + ' issue' + (nodes.length === 1 ? '' : 's') + '.');
    return;
  }

  if (args.comment) {
    await addComment(key, team.id, args.comment, args.body, args.dryRun);
    return;
  }

  if (args.addLabels.length || args.rmLabels.length || args.assigns.length) {
    for (const s of args.rmLabels) await changeLabel(key, team.id, s, false, args.dryRun);
    for (const s of args.addLabels) await changeLabel(key, team.id, s, true, args.dryRun);
    for (const s of args.assigns) await setAssignee(key, team.id, s, args.dryRun);
    if (!args.sets.length) return;
  }

  if (args.sets && args.sets.length) {
    for (const spec of args.sets) await setStatus(key, team.id, spec, args.dryRun);
    console.log('Done (' + args.sets.length + ' status change' + (args.sets.length === 1 ? '' : 's') + ').');
    return;
  }

  let issues;
  if (args.file) {
    issues = JSON.parse(fs.readFileSync(args.file, 'utf8'));
    if (!Array.isArray(issues)) die('--file must contain a JSON array of issues');
  } else if (args.title) {
    issues = [{ title: args.title, description: args.description, priority: args.priority, labels: args.labels }];
  } else {
    die('Nothing to do. Use --whoami, --list, --get, --set, --comment, --title "...", or --file tickets.json');
  }

  for (const it of issues) {
    if (!it.title) { console.error('  (skipped an entry with no title)'); continue; }
    await createIssue(key, team, it, args.dryRun);
  }
  console.log('Done (' + issues.length + ' issue' + (issues.length === 1 ? '' : 's') + ').');
})().catch(e => die(e && e.stack || String(e)));
