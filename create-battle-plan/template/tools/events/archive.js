#!/usr/bin/env node
// tools/events/archive.js — move gated/completed/cancelled events from events.yml → events-archive.yml.
// Mirrors tools/tasks/archive.js.
//
// An event is archivable when:
//   - status ∈ {done, cancelled, no_show, rescheduled} AND gate_completed_at is set (normal path), OR
//   - end-time > 14 days ago (auto-no-show sweep for stale scheduled events)
//
// Flags: --dry-run, --days N (override stale threshold)

const E = require('./lib/events');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const daysIdx = args.indexOf('--days');
const staleDays = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) : 14;

const cutoff = new Date(Date.now() - staleDays * 86400 * 1000).toISOString();
const live = E.load();
const archive = E.loadArchive();

const archivable = [];
const remaining = [];
for (const e of live.events) {
  const terminal = ['done', 'cancelled', 'no_show', 'rescheduled'].includes(e.status);
  const gated = !!e.gate_completed_at;
  const ref = e.end || e.start;
  const stale = ref && ref < cutoff;
  if (terminal && (gated || stale)) {
    archivable.push(e);
  } else if (!terminal && stale) {
    e.status = 'no_show';
    archivable.push(e);
  } else {
    remaining.push(e);
  }
}

console.log(`Archivable: ${archivable.length}  ·  Remaining in events.yml: ${remaining.length}`);
for (const e of archivable) {
  console.log(`  EVT-${e.id}  ${e.start.slice(0, 16).replace('T', ' ')}  [${e.status}]  ${e.title}`);
}

if (dry) { console.log('\nDry-run.'); process.exit(0); }
if (!archivable.length) process.exit(0);

const archiveIds = new Set(archive.events.map(e => e.id));
for (const e of archivable) {
  if (!archiveIds.has(e.id)) archive.events.push(e);
}
live.events = remaining;

E.save(live);
E.saveArchive(archive);
console.log(`\nMoved ${archivable.length} event(s) to events-archive.yml.`);
