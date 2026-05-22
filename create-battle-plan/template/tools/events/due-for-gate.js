#!/usr/bin/env node
// tools/events/due-for-gate.js — events whose end-time has passed but no gate_completed_at yet.
// The wrap-up skill walks these one-by-one and asks for: transcript path, hypothesis impacts,
// spawned tasks, lead status change. Then stamps gate_completed_at and archives.
// Flags: --json
// Used by wrap-up (mandatory gate) and good-morning (warns when context-debt > 2 days old).

const E = require('./lib/events');

const asJson = process.argv.includes('--json');
const events = E.dueForGate();

if (asJson) {
  console.log(JSON.stringify(events, null, 2));
  process.exit(0);
}

if (!events.length) {
  console.log('(no events due for wrap-up gate)');
  process.exit(0);
}

console.log(`${events.length} event(s) past end-time, awaiting wrap-up gate:`);
for (const e of events) {
  const start = e.start.slice(0, 16).replace('T', ' ');
  console.log(`  EVT-${e.id}  ${start}  [${e.type}]  ${e.title}`);
  if (e.lead_id) console.log(`    lead: ${e.lead_id}`);
  if (!e.transcript_path) console.log('    · transcript: MISSING');
  if (!e.hypothesis_impacts || !e.hypothesis_impacts.length) console.log('    · hypothesis impacts: MISSING');
  if (!e.spawned_tasks || !e.spawned_tasks.length) console.log('    · spawned tasks: none recorded');
}
