#!/usr/bin/env node
// tools/events/add.js — add or update a future event in events.yml.
//
// Usage:
//   node tools/events/add.js --title "Demo v1 — Acme/CIO" \
//     --start "2026-05-14T14:00:00+02:00" [--end "..."] [--duration-min 30] \
//     [--type demo|discovery|investor|admin|personal|unspecified|other] \
//     [--status scheduled|in_progress|done|cancelled|no_show|rescheduled] \
//     [--lead-id <linkedin_url_or_company_key>] [--attendee "Name"] (repeatable) \
//     [--location "..."] [--notes "..."] [--source flush-updates|manual-chat|hand-edit] \
//     [--id <existing EVT id>]   # update an existing event
//
// Idempotent — if (lead_id + start) matches an existing row, that row is updated.
// Default: type=unspecified, status=scheduled, duration=30 minutes.

const E = require('./lib/events');

function parseArgs(argv) {
  const out = { attendees: [] };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--attendee') { out.attendees.push(v); i++; continue; }
    if (k.startsWith('--')) { out[k.slice(2).replace(/-/g, '_')] = v; i++; }
  }
  return out;
}

function main() {
  const a = parseArgs(process.argv);
  if (!a.title && !a.id) {
    console.error('Usage: node tools/events/add.js --title "..." --start "ISO" [--type ...] [--lead-id ...]');
    process.exit(1);
  }
  if (!a.start && !a.id) {
    console.error('--start required (ISO 8601, e.g. "2026-05-14T14:00:00+02:00").');
    process.exit(1);
  }

  const state = E.load();
  const event = {};
  if (a.id) event.id = parseInt(a.id, 10);
  if (a.title) event.title = a.title;
  if (a.start) event.start = a.start;
  if (a.end) event.end = a.end;
  else if (a.start) {
    const d = parseInt(a.duration_min || '30', 10);
    event.end = E.defaultEnd(a.start, d);
  }
  event.type = a.type && E.VALID_TYPE.has(a.type) ? a.type : (a.type || 'unspecified');
  event.status = a.status && E.VALID_STATUS.has(a.status) ? a.status : 'scheduled';
  event.attendees = a.attendees;
  event.lead_id = a.lead_id || null;
  event.location = a.location || null;
  event.notes = a.notes || null;
  event.source = a.source || 'manual-chat';

  const result = E.upsert(state, event);
  E.save(state);
  console.log(`${result.action}: EVT-${result.event.id} · ${result.event.title} · ${result.event.start}`);
}

if (require.main === module) main();
module.exports = { parseArgs };
