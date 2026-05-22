#!/usr/bin/env node
// tools/events/upcoming.js — list scheduled events from now forward.
// Flags: --json | --today (only events starting today) | --days N (next N days)
// Used by render-today.js, good-morning, wrap-up.

const E = require('./lib/events');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const onlyToday = args.includes('--today');
const daysIdx = args.indexOf('--days');
const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) : null;

let events;
if (onlyToday) {
  events = E.todayEvents();
} else if (days) {
  const now = new Date();
  const until = new Date(now.getTime() + days * 86400 * 1000).toISOString();
  events = E.upcoming().filter(e => e.start <= until);
} else {
  events = E.upcoming();
}

if (asJson) {
  console.log(JSON.stringify(events, null, 2));
} else {
  if (!events.length) { console.log('(no upcoming events)'); process.exit(0); }
  for (const e of events) {
    const time = e.start.length >= 16 ? e.start.slice(0, 16).replace('T', ' ') : e.start.slice(0, 10);
    console.log(`EVT-${e.id}  ${time}  [${e.type}/${e.status}]  ${e.title}`);
  }
}
