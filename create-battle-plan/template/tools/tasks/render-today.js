#!/usr/bin/env node
// tools/tasks/render-today.js — generates docs/today.md from tasks.yml (+ metrics.yml + optional outreach).
// Idempotent. Safe to run multiple times per day.
// Flags: --all (include full backlog instead of first 5), --quiet

const fs = require('fs');
const path = require('path');
const tasks = require('./lib/tasks');

const ROOT = path.resolve(__dirname, '../..');
const TODAY_MD = path.join(ROOT, 'docs/today.md');
const METRICS_YML = path.join(ROOT, 'metrics.yml');

const args = process.argv.slice(2);
const showAll = args.includes('--all');
const quiet = args.includes('--quiet');

function readMetrics() {
  if (!fs.existsSync(METRICS_YML)) return {};
  const text = fs.readFileSync(METRICS_YML, 'utf8');
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(\w+)\s*:\s*(.+?)\s*(#.*)?$/);
    if (m) {
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      out[m[1]] = /^-?\d+$/.test(v) ? parseInt(v, 10) : v;
    }
  }
  return out;
}

function readLeadsLight() {
  // Optional — only available when the outreach add-on is installed.
  const leadsCsv = path.join(ROOT, 'outreach/leads.csv');
  const leadsLib = path.join(ROOT, 'tools/outreach/lib/leads.js');
  if (!fs.existsSync(leadsCsv) || !fs.existsSync(leadsLib)) return [];
  try {
    const leads = require(leadsLib);
    return leads.load();
  } catch (e) {
    return [];
  }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function weekdayName(date) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
}

function priorityEmoji(p) {
  if (p === 1) return '⏫';
  if (p === 2) return '🔼';
  if (p === 3) return '🔽';
  return '';
}

function renderTaskLine(t) {
  const parts = [];
  parts.push(`- [ ] TASK-${t.id} ${t.title}`);
  if (t.due) parts.push(`📅 ${t.due}`);
  const pe = priorityEmoji(t.priority);
  if (pe) parts.push(pe);
  if (Array.isArray(t.tags) && t.tags.length) {
    parts.push(t.tags.map(x => '#' + x).join(' '));
  }
  return parts.join(' ');
}

function buildCallsSection(leads) {
  const today = todayStr();
  const calls = leads.filter(r => r.call_at && r.call_at.startsWith(today) && ['call_booked', 'replied'].includes(r.status));
  if (calls.length === 0) return null;
  const lines = ['## Calls & meetings'];
  for (const c of calls) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '(unnamed)';
    const time = c.call_at.slice(11, 16) || 'TBD';
    const note = c.title ? ` (${c.title})` : '';
    lines.push(`- ${time} — ${name} / ${c.company}${note}`);
  }
  return lines.join('\n');
}

function buildPulseSection(leads, metrics) {
  if (!leads.length && !Object.keys(metrics).length) return null;
  const lines = ['## Pulse'];
  if (leads.length) {
    const pipeline = leads.filter(r => ['replied', 'call_booked', 'call_done', 'verbal', 'loi'].includes(r.status));
    const by = s => pipeline.filter(r => r.status === s).length;
    lines.push(`- Active: ${pipeline.length} (${by('call_booked')} call_booked · ${by('call_done')} call_done · ${by('verbal')} verbal · ${by('replied')} replied)`);
  }
  if (metrics.outreach_sent !== undefined) {
    lines.push(`- Total sent: ${metrics.outreach_sent}${metrics.connections_sent !== undefined ? ` (${metrics.connections_sent} conn + ${metrics.inmails_sent} inmail)` : ''} · ${metrics.responses || 0} replies · ${metrics.discovery_calls || 0} calls · ${metrics.verbal_commitments || 0} verbal`);
  }
  if (leads.length) {
    const warm = leads.filter(r => r.status === 'replied' && r.replied_at);
    const stale = warm.filter(r => {
      const d = new Date(r.replied_at);
      const age = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
      return age >= 2;
    }).slice(0, 6);
    if (stale.length) {
      const names = stale.map(r => [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.company).slice(0, 6);
      lines.push(`- Needs reply (replied ≥2d ago): ${names.join(', ')}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : null;
}

function buildQuerySections(state) {
  const sections = [];
  const open = state.tasks.filter(t => t.status === 'open');
  const byP = p => open.filter(t => t.priority === p).length;

  const commonOpts = [
    'path includes today.md',
    'not done',
    'sort by due',
    'hide backlink',
    'hide edit button',
    'hide task count'
  ];

  if (byP(1) > 0) {
    sections.push([
      '## Today',
      '```tasks',
      ...commonOpts,
      'priority is high',
      '```'
    ].join('\n'));
  }
  if (byP(2) > 0) {
    sections.push([
      '## This week',
      '```tasks',
      ...commonOpts,
      'priority is medium',
      '```'
    ].join('\n'));
  }
  if (byP(3) > 0) {
    sections.push([
      '## Backlog',
      '```tasks',
      ...commonOpts,
      'priority is low',
      '```'
    ].join('\n'));
  }

  const snoozed = state.tasks.filter(t => t.status === 'snoozed');
  if (snoozed.length) {
    snoozed.sort((a, b) => (a.snoozed_until || '').localeCompare(b.snoozed_until || ''));
    const lines = snoozed.slice(0, 5).map(t => `- TASK-${t.id} ${t.title} *(resurfaces ${t.snoozed_until || 'TBD'})*`);
    sections.push('## Snoozed\n' + lines.join('\n'));
  }

  return sections;
}

function buildTaskDataSection(state) {
  const open = state.tasks.filter(t => t.status === 'open');
  open.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return a.id - b.id;
  });

  let rendered = open;
  if (!showAll) {
    const highMed = open.filter(t => t.priority <= 2);
    const low = open.filter(t => t.priority === 3).slice(0, 5);
    rendered = [...highMed, ...low];
  }

  const raw = rendered.map(renderTaskLine).join('\n');
  return [
    '---',
    '',
    '## Task data',
    '',
    '*Source rows for the queries above. `flush-today.js` reads these. Editable — checkboxes, due dates, priorities, snooze (`🛫 YYYY-MM-DD`) all round-trip. Run `node tools/tasks/flush-today.js` after edits.*',
    '',
    raw
  ].join('\n');
}

// --- Main ---

const state = tasks.load();
const resurfaced = tasks.resolveSnoozed(state);
if (resurfaced > 0) {
  tasks.save(state);
  if (!quiet) console.log(`↑ Resurfaced ${resurfaced} snoozed task(s) whose date has passed.`);
}

const metrics = readMetrics();
const leads = readLeadsLight();

const date = new Date();
const header = `# Today · ${todayStr()} ${weekdayName(date)}`;

const sections = [];
sections.push(header);

const preamble = `> *Your daily surface. Check the boxes in Obsidian, then flush with \`node tools/tasks/flush-today.js\`.*\n> *Underlying source of truth: \`tasks.yml\`. Never hand-edit that file while this doc has unflushed changes.*`;
sections.push(preamble);

const callsBlock = buildCallsSection(leads);
if (callsBlock) sections.push(callsBlock);

const pulseBlock = buildPulseSection(leads, metrics);
if (pulseBlock) sections.push(pulseBlock);

for (const s of buildQuerySections(state)) sections.push(s);

sections.push(buildTaskDataSection(state));

const now = new Date();
const stamp = `${todayStr()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
sections.push(`*Generated ${stamp}. Queries above are live — edit checkboxes anywhere, then \`node tools/tasks/flush-today.js\`.*`);

const content = sections.join('\n\n') + '\n';
if (!fs.existsSync(path.dirname(TODAY_MD))) fs.mkdirSync(path.dirname(TODAY_MD), { recursive: true });
fs.writeFileSync(TODAY_MD, content);
if (!quiet) console.log(`✓ Wrote ${path.relative(ROOT, TODAY_MD)} (${state.tasks.filter(t => t.status === 'open').length} open task(s))`);
