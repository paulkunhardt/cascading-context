const fs = require('fs');
const path = require('path');

const TASKS_PATH = path.resolve(__dirname, '../../../tasks.yml');

const VALID_STATUS = new Set(['open', 'done', 'cancelled', 'snoozed']);
const VALID_PRIORITY = new Set([1, 2, 3]);

// Minimal YAML reader/writer for our constrained schema.
// Schema:
//   last_updated: YYYY-MM-DD
//   next_id: N
//   tasks:
//     - id: N
//       created: YYYY-MM-DD
//       due: YYYY-MM-DD | null
//       status: open|done|cancelled|snoozed
//       priority: 1|2|3
//       tags: [a, b]
//       title: "..."
//       context: "..."
//       done_at: YYYY-MM-DD | null
//       snoozed_until: YYYY-MM-DD | null

const FIELD_ORDER = [
  'id', 'created', 'due', 'status', 'priority', 'tags',
  'title', 'context', 'done_at', 'snoozed_until'
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

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

function serializeScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '[' + v.map(x => serializeString(x)).join(', ') + ']';
  }
  return serializeString(v);
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

function load() {
  if (!fs.existsSync(TASKS_PATH)) {
    return { last_updated: today(), next_id: 1, tasks: [] };
  }
  const text = fs.readFileSync(TASKS_PATH, 'utf8');
  const lines = text.split('\n');

  const result = { last_updated: today(), next_id: 1, tasks: [] };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*#/.test(line) || line.trim() === '') { i++; continue; }
    if (/^tasks\s*:\s*$/.test(line)) { i++; break; }
    const m = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (m) {
      result[m[1]] = parseScalar(m[2]);
    }
    i++;
  }

  let cur = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    const listItem = line.match(/^\s*-\s+(\w+)\s*:\s*(.*)$/);
    if (listItem) {
      if (cur) result.tasks.push(cur);
      cur = {};
      cur[listItem[1]] = parseScalar(listItem[2]);
      continue;
    }
    const field = line.match(/^\s+(\w+)\s*:\s*(.*)$/);
    if (field && cur) {
      cur[field[1]] = parseScalar(field[2]);
    }
  }
  if (cur) result.tasks.push(cur);

  result.next_id = typeof result.next_id === 'number' ? result.next_id : parseInt(result.next_id, 10) || 1;
  result.tasks.forEach(t => {
    if (typeof t.id === 'string') t.id = parseInt(t.id, 10);
    if (typeof t.priority === 'string') t.priority = parseInt(t.priority, 10);
    if (!Array.isArray(t.tags)) t.tags = t.tags ? [t.tags] : [];
  });
  return result;
}

function save(state) {
  state.last_updated = today();
  const maxId = state.tasks.reduce((m, t) => Math.max(m, t.id || 0), 0);
  if (state.next_id <= maxId) state.next_id = maxId + 1;

  const out = [];
  out.push('# tasks.yml — structured task log. Source of truth for docs/today.md.');
  out.push('# Never hand-edit while today.md has unflushed checkbox changes — flush first.');
  out.push(`last_updated: ${state.last_updated}`);
  out.push(`next_id: ${state.next_id}`);
  out.push('tasks:');
  for (const t of state.tasks) {
    let first = true;
    for (const k of FIELD_ORDER) {
      if (!(k in t)) continue;
      const prefix = first ? '  - ' : '    ';
      out.push(`${prefix}${k}: ${serializeScalar(t[k])}`);
      first = false;
    }
    if (first) continue;
  }
  fs.writeFileSync(TASKS_PATH, out.join('\n') + '\n');
}

function nextId(state) {
  const id = state.next_id;
  state.next_id = id + 1;
  return id;
}

function resolveSnoozed(state) {
  const t = today();
  let changed = 0;
  for (const task of state.tasks) {
    if (task.status === 'snoozed' && task.snoozed_until && task.snoozed_until <= t) {
      task.status = 'open';
      task.snoozed_until = null;
      changed++;
    }
  }
  return changed;
}

module.exports = {
  TASKS_PATH, VALID_STATUS, VALID_PRIORITY, FIELD_ORDER,
  today, load, save, nextId, resolveSnoozed
};
