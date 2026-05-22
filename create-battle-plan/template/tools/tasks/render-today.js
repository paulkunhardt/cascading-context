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

// Lane vocabulary (mirrors VALID_LANES in lib/tasks.js). Drives display order
// in today.md and the human-readable label per lane group. Adapt to your project.
const LANE_DISPLAY = {
  build: 'Build',
  outreach: 'Outreach',
  discovery: 'Discovery',
  infra: 'Infra',
  fundraising: 'Fundraising',
  meta: 'Meta'
};
const LANE_ORDER = ['build', 'outreach', 'discovery', 'infra', 'fundraising', 'meta'];
const PRIORITY_HEADERS = {
  1: '### ⏫ Today (P1)',
  2: '### 🔼 This week (P2)',
  3: '### 🔽 Backlog (P3)'
};

function renderTaskLine(t, openIds) {
  const parts = [];
  const box = t.status === 'in_progress' ? '/' : ' ';
  parts.push(`- [${box}] TASK-${t.id} ${t.title}`);
  if (t.due) parts.push(`📅 ${t.due}`);
  const pe = priorityEmoji(t.priority);
  if (pe) parts.push(pe);
  // Nested hashtag — Obsidian Tasks plugin treats this as a filterable lane group.
  if (t.lane) parts.push(`#lane/${t.lane}`);
  // Surface still-open blockers only — once the blocker closes, the token disappears
  // from the daily surface. flush-today.js ignores this token (LINE_RE matches checkbox + TASK-N).
  if (Array.isArray(t.blocked_by) && t.blocked_by.length) {
    const stillOpen = openIds ? t.blocked_by.filter(id => openIds.has(id)) : t.blocked_by;
    if (stillOpen.length) {
      parts.push(`🚧 blocked-by:TASK-${stillOpen.join(',TASK-')}`);
    }
  }
  if (Array.isArray(t.tags) && t.tags.length) {
    parts.push(t.tags.map(x => '#' + x).join(' '));
  }
  return parts.join(' ');
}

function loadEventsLib() {
  // events.yml is part of the base template, but be defensive in case someone removed it.
  const eventsLib = path.join(ROOT, 'tools/events/lib/events.js');
  if (!fs.existsSync(eventsLib)) return null;
  try { return require(eventsLib); } catch (e) { return null; }
}

function buildCallsSection() {
  // events.yml is the single source of truth for time-based events.
  const events = loadEventsLib();
  if (!events) return null;
  const calls = events.todayEvents();
  if (calls.length === 0) return null;
  const lines = ['## Calls & meetings'];
  for (const e of calls) {
    const time = e.start && e.start.length >= 16 ? e.start.slice(11, 16) : 'TBD';
    lines.push(`- ${time} — ${e.title}`);
  }
  return lines.join('\n');
}

function buildPulseSection(leads, metrics) {
  const events = loadEventsLib();
  const upcomingEvents = events
    ? events.upcoming().filter(e => e.start && e.start.slice(0, 10) > todayStr())
    : [];
  if (!leads.length && !Object.keys(metrics).length && !upcomingEvents.length) return null;
  const lines = ['## Pulse'];
  if (leads.length) {
    const pipeline = leads.filter(r => ['replied', 'call_booked', 'call_done', 'verbal', 'loi'].includes(r.status));
    const by = s => pipeline.filter(r => r.status === s).length;
    lines.push(`- Active: ${pipeline.length} (${by('call_booked')} call_booked · ${by('call_done')} call_done · ${by('verbal')} verbal · ${by('replied')} replied)`);
  }
  if (metrics.outreach_sent !== undefined) {
    lines.push(`- Total sent: ${metrics.outreach_sent}${metrics.connections_sent !== undefined ? ` (${metrics.connections_sent} conn + ${metrics.inmails_sent} inmail)` : ''} · ${metrics.responses || 0} replies · ${metrics.discovery_calls || 0} calls · ${metrics.verbal_commitments || 0} verbal`);
  }
  if (upcomingEvents.length) {
    const fmt = upcomingEvents.slice(0, 5).map(e => `${e.start.slice(0, 10)} ${e.title}`).join(', ');
    lines.push(`- Upcoming events (${upcomingEvents.length}): ${fmt}`);
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
  const open = state.tasks.filter(t => t.status === 'open' || t.status === 'in_progress');
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
  const open = state.tasks.filter(t => t.status === 'open' || t.status === 'in_progress');
  const openIds = new Set(open.map(t => t.id));

  // Group by priority, then lane.
  const byPriority = { 1: [], 2: [], 3: [] };
  for (const t of open) {
    const p = byPriority[t.priority] || (byPriority[t.priority] = []);
    p.push(t);
  }

  const out = [
    '---',
    '',
    '## Task data',
    '',
    '*Source rows for the queries above. `flush-today.js` reads these. Editable — checkboxes, due dates, priorities, snooze (`🛫 YYYY-MM-DD`) all round-trip. Run `node tools/tasks/flush-today.js` after edits.*',
    ''
  ];

  for (const priority of [1, 2, 3]) {
    let pTasks = byPriority[priority] || [];
    if (pTasks.length === 0) continue;

    // P3 (backlog) is collapsed to first 5 unless --all.
    if (priority === 3 && !showAll) pTasks = pTasks.slice(0, 5);

    out.push(PRIORITY_HEADERS[priority] || `### P${priority}`);
    out.push('');

    // Group by lane within priority.
    const byLane = {};
    for (const t of pTasks) {
      const lane = t.lane || 'meta';
      (byLane[lane] = byLane[lane] || []).push(t);
    }

    const orderedLanes = [
      ...LANE_ORDER.filter(l => byLane[l]),
      ...Object.keys(byLane).filter(l => !LANE_ORDER.includes(l))
    ];

    for (const lane of orderedLanes) {
      const laneTasks = byLane[lane];
      laneTasks.sort((a, b) => {
        if (a.due && b.due) return a.due.localeCompare(b.due);
        if (a.due) return -1;
        if (b.due) return 1;
        return a.id - b.id;
      });
      out.push(`**${LANE_DISPLAY[lane] || lane}** (${laneTasks.length})`);
      for (const t of laneTasks) out.push(renderTaskLine(t, openIds));
      out.push('');
    }
  }

  return out.join('\n').trimEnd();
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

const callsBlock = buildCallsSection();
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
if (!quiet) {
  const openCount = state.tasks.filter(t => t.status === 'open').length;
  const ipCount = state.tasks.filter(t => t.status === 'in_progress').length;
  console.log(`✓ Wrote ${path.relative(ROOT, TODAY_MD)} (${openCount} open + ${ipCount} in_progress)`);
}
