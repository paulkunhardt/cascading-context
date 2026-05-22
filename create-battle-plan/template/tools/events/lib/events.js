// tools/events/lib/events.js — YAML reader/writer for events.yml + events-archive.yml.
// Mirrors the shape of tools/tasks/lib/tasks.js — self-contained, no external YAML deps.
// An "event" is something with a start datetime AND a counterparty (calls, demos, meetings,
// dentist appointments). Deadline-only items (no time-of-day, no attendee) belong in tasks.yml.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const EVENTS_PATH = path.join(ROOT, 'events.yml');
const ARCHIVE_PATH = path.join(ROOT, 'events-archive.yml');

const VALID_STATUS = new Set(['scheduled', 'in_progress', 'done', 'cancelled', 'no_show', 'rescheduled']);
// VALID_TYPE is intentionally permissive — adapt per project. The set below lists common types;
// any string passes through (add.js validates against this set only for known categories).
const VALID_TYPE = new Set(['demo', 'discovery', 'investor', 'admin', 'personal', 'unspecified', 'other']);

const FIELD_ORDER = [
  'id', 'title', 'start', 'end', 'type', 'status',
  'attendees', 'lead_id', 'location', 'notes',
  'source', 'created_at',
  'transcript_path', 'spawned_tasks', 'hypothesis_impacts', 'gate_completed_at'
];

function today() { return new Date().toISOString().slice(0, 10); }
function nowIso() { return new Date().toISOString(); }

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(x => parseScalar(x.trim()));
  }
  return s;
}

function serializeString(s) {
  s = String(s);
  if (s === '' || /^(null|true|false|~)$/.test(s) || /^-?\d+$/.test(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  if (/[:#\[\]{},&*!|>'"%@`\n]|^[\s-?]/.test(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s;
}

function serializeScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '[' + v.map(x => (typeof x === 'number' || typeof x === 'boolean') ? String(x) : serializeString(x)).join(', ') + ']';
  }
  return serializeString(v);
}

function loadFile(p) {
  if (!fs.existsSync(p)) {
    return { last_updated: today(), next_id: 1, events: [] };
  }
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split('\n');
  const result = { last_updated: today(), next_id: 1, events: [] };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*#/.test(line) || line.trim() === '') { i++; continue; }
    if (/^events\s*:\s*$/.test(line)) { i++; break; }
    const m = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (m) result[m[1]] = parseScalar(m[2]);
    i++;
  }
  let cur = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    const listItem = line.match(/^\s*-\s+(\w+)\s*:\s*(.*)$/);
    if (listItem) {
      if (cur) result.events.push(cur);
      cur = {};
      cur[listItem[1]] = parseScalar(listItem[2]);
      continue;
    }
    const field = line.match(/^\s+(\w+)\s*:\s*(.*)$/);
    if (field && cur) cur[field[1]] = parseScalar(field[2]);
  }
  if (cur) result.events.push(cur);
  result.next_id = typeof result.next_id === 'number' ? result.next_id : parseInt(result.next_id, 10) || 1;
  result.events.forEach(e => {
    if (typeof e.id === 'string') e.id = parseInt(e.id, 10);
    for (const k of ['attendees', 'spawned_tasks', 'hypothesis_impacts']) {
      if (e[k] && !Array.isArray(e[k])) e[k] = [e[k]];
    }
  });
  return result;
}

function saveFile(p, state, header) {
  state.last_updated = today();
  const maxId = state.events.reduce((m, e) => Math.max(m, e.id || 0), 0);
  if (state.next_id <= maxId) state.next_id = maxId + 1;
  const out = [];
  out.push(header);
  out.push(`last_updated: ${state.last_updated}`);
  out.push(`next_id: ${state.next_id}`);
  out.push('events:');
  for (const e of state.events) {
    let first = true;
    for (const k of FIELD_ORDER) {
      if (!(k in e)) continue;
      const prefix = first ? '  - ' : '    ';
      out.push(`${prefix}${k}: ${serializeScalar(e[k])}`);
      first = false;
    }
  }
  fs.writeFileSync(p, out.join('\n') + '\n');
}

function load() { return loadFile(EVENTS_PATH); }
function loadArchive() { return loadFile(ARCHIVE_PATH); }

function save(state) {
  saveFile(EVENTS_PATH, state,
    '# events.yml — single source of truth for future time-based events (calls, demos, meetings).\n# Past/completed events live in events-archive.yml. Tasks (deadline-only, no time-span) live in tasks.yml.');
}

function saveArchive(state) {
  saveFile(ARCHIVE_PATH, state,
    '# events-archive.yml — past/completed events. Mirrors events.yml schema.\n# Wrap-up gate moves events here after transcript + insights captured.');
}

function nextId(state) {
  // Shared ID space across events.yml + events-archive.yml. An event's ID never changes when archived.
  const cur = state.next_id || 1;
  const archived = loadArchive();
  const maxArch = archived.events.reduce((m, e) => Math.max(m, e.id || 0), 0);
  const id = Math.max(cur, maxArch + 1);
  state.next_id = id + 1;
  return id;
}

// Idempotent: matches on (id) first, then (lead_id + start) tuple. Safe to call from
// retried flush-* scripts without creating duplicate rows for the same real-world event.
function upsert(state, event) {
  let idx = -1;
  if (event.id) idx = state.events.findIndex(e => e.id === event.id);
  if (idx < 0 && event.lead_id && event.start) {
    idx = state.events.findIndex(e => e.lead_id === event.lead_id && e.start === event.start);
  }
  if (idx >= 0) {
    state.events[idx] = { ...state.events[idx], ...event };
    return { action: 'updated', event: state.events[idx] };
  }
  if (!event.id) event.id = nextId(state);
  if (!event.created_at) event.created_at = nowIso();
  state.events.push(event);
  return { action: 'inserted', event };
}

function upcoming({ from = nowIso() } = {}) {
  return load().events
    .filter(e => e.start && e.start >= from && (e.status === 'scheduled' || e.status === 'in_progress' || e.status === 'done'))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

function todayEvents({ on = today() } = {}) {
  return load().events
    .filter(e => e.start && String(e.start).startsWith(on)
      && (e.status === 'scheduled' || e.status === 'in_progress' || e.status === 'done'))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

function dueForGate({ now = nowIso() } = {}) {
  return load().events
    .filter(e => {
      if (e.gate_completed_at) return false;
      if (e.status === 'cancelled' || e.status === 'rescheduled') return false;
      const endOrStart = e.end || e.start;
      return endOrStart && endOrStart < now;
    })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

// Lead-level lookup — used by metrics scripts to know if a lead ever had a call.
// Unions events.yml + events-archive.yml so historical calls survive after archival.
function leadHadCall(leadId) {
  if (!leadId) return false;
  const all = [...load().events, ...loadArchive().events];
  return all.some(e => e.lead_id === leadId
    && (e.status === 'done' || e.status === 'in_progress'
        || (e.status === 'scheduled' && e.start && e.start < nowIso())));
}

function eventsByLead(leadId) {
  if (!leadId) return [];
  return [...load().events, ...loadArchive().events].filter(e => e.lead_id === leadId);
}

function defaultEnd(startIso, durationMin = 30) {
  if (!startIso) return null;
  const d = new Date(startIso);
  if (isNaN(d.getTime())) return null;
  d.setMinutes(d.getMinutes() + durationMin);
  return d.toISOString();
}

module.exports = {
  EVENTS_PATH, ARCHIVE_PATH, VALID_STATUS, VALID_TYPE, FIELD_ORDER,
  today, nowIso, defaultEnd,
  load, loadArchive, save, saveArchive, nextId, upsert,
  upcoming, todayEvents, dueForGate, leadHadCall, eventsByLead
};
