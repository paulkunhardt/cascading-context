#!/usr/bin/env node
// tools/tasks/flush-today.js — reconciles docs/today.md checkbox edits back into tasks.yml.
// Archives the processed file to docs/today-archive/YYYY-MM-DD.md.
//
// Recognized checkbox states (Obsidian Tasks plugin conventions):
//   [ ]   open
//   [x]   done
//   [X]   done (case-insensitive)
//   [-]   cancelled
//   [/]   in-progress (treated as open; surfaces to today section)
//
// Tolerated inline metadata (emitted by Obsidian Tasks plugin):
//   ✅ YYYY-MM-DD  -> done date (overrides today)
//   📅 YYYY-MM-DD  -> due date (updates if changed)
//   🛫 YYYY-MM-DD  -> snooze-until (sets status=snoozed)
//   ⏫ / 🔼 / 🔽    -> priority (updates if changed)

const fs = require('fs');
const path = require('path');
const tasks = require('./lib/tasks');

const ROOT = path.resolve(__dirname, '../..');
const TODAY_MD = path.join(ROOT, 'docs/today.md');
const ARCHIVE_DIR = path.join(ROOT, 'docs/today-archive');

if (!fs.existsSync(TODAY_MD)) {
  console.error(`No ${path.relative(ROOT, TODAY_MD)} to flush. Run render-today.js first.`);
  process.exit(1);
}

const text = fs.readFileSync(TODAY_MD, 'utf8');
const lines = text.split('\n');

const state = tasks.load();
const byId = new Map(state.tasks.map(t => [t.id, t]));

const LINE_RE = /^\s*-\s+\[([ xX\-/])\]\s+TASK-(\d+)\b/;
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const DONE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/;
const SNOOZE_RE = /🛫\s*(\d{4}-\d{2}-\d{2})/;

function mapCheckbox(ch) {
  if (ch === ' ') return 'open';
  if (ch === 'x' || ch === 'X') return 'done';
  if (ch === '-') return 'cancelled';
  if (ch === '/') return 'open';
  return 'open';
}

let changed = 0;
const changeLog = [];

for (const line of lines) {
  const m = line.match(LINE_RE);
  if (!m) continue;
  const state_ch = m[1];
  const id = parseInt(m[2], 10);
  const task = byId.get(id);
  if (!task) {
    console.warn(`⚠️  TASK-${id} in today.md not found in tasks.yml — skipping`);
    continue;
  }

  const newStatus = mapCheckbox(state_ch);
  const dueMatch = line.match(DUE_RE);
  const doneMatch = line.match(DONE_RE);
  const snoozeMatch = line.match(SNOOZE_RE);

  const prevStatus = task.status;
  const patch = {};

  if (snoozeMatch) {
    patch.status = 'snoozed';
    patch.snoozed_until = snoozeMatch[1];
  } else if (newStatus === 'done') {
    patch.status = 'done';
    patch.done_at = doneMatch ? doneMatch[1] : tasks.today();
  } else if (newStatus === 'cancelled') {
    patch.status = 'cancelled';
    patch.done_at = doneMatch ? doneMatch[1] : tasks.today();
  } else {
    if (prevStatus === 'done' || prevStatus === 'cancelled' || prevStatus === 'snoozed') {
      patch.status = 'open';
      patch.done_at = null;
      patch.snoozed_until = null;
    }
  }

  if (dueMatch && dueMatch[1] !== task.due) {
    patch.due = dueMatch[1];
  }

  let thisChanged = false;
  for (const k of Object.keys(patch)) {
    if (task[k] !== patch[k]) {
      task[k] = patch[k];
      thisChanged = true;
    }
  }

  if (thisChanged) {
    changed++;
    changeLog.push(`  TASK-${id} ${prevStatus} → ${task.status}${task.done_at ? ' (' + task.done_at + ')' : ''} · ${task.title}`);
  }
}

if (changed === 0) {
  console.log('No checkbox changes to flush.');
  process.exit(0);
}

tasks.save(state);

if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
const archivePath = path.join(ARCHIVE_DIR, `${tasks.today()}.md`);
fs.copyFileSync(TODAY_MD, archivePath);

console.log(`✓ Flushed ${changed} change(s) to tasks.yml`);
for (const entry of changeLog) console.log(entry);
console.log(`✓ Archived today.md → ${path.relative(ROOT, archivePath)}`);
console.log('');
console.log('Run `node tools/tasks/render-today.js` to regenerate docs/today.md.');
