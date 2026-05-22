#!/usr/bin/env node
// tools/events/migrate-from-csv.js — one-shot migration for installs that previously stored
// scheduled calls as outreach/leads.csv:call_at. Splits the column into events.yml (future)
// + events-archive.yml (past), then strips the call_at values from leads.csv.
//
// Idempotent — keys on (lead_id + start). Safe to re-run; already-present rows are skipped.
// Profile A (base only) installs without leads.csv: the script no-ops with a helpful message.
//
// Run with --commit to persist; otherwise dry-run.

const fs = require('fs');
const path = require('path');
const E = require('./lib/events');

const commit = process.argv.includes('--commit');
const todayStr = E.today();

const LEADS_LIB = path.resolve(__dirname, '../outreach/lib/leads.js');
if (!fs.existsSync(LEADS_LIB)) {
  console.log('No outreach/lib/leads.js found — this install has no CSV to migrate from.');
  console.log('events.yml + events-archive.yml will be created on first add.');
  process.exit(0);
}

const L = require('../outreach/lib/leads');
const rows = L.load();
const withCallAt = rows.filter(r => r.call_at && String(r.call_at).trim() !== '');

console.log(`Found ${withCallAt.length} leads with call_at set.`);
if (withCallAt.length === 0) {
  console.log('Nothing to migrate.');
  process.exit(0);
}

const future = E.load();
const archive = E.loadArchive();

let nFuture = 0, nArchive = 0, nSkipped = 0;

for (const r of withCallAt) {
  const raw = String(r.call_at).trim();
  // Bare YYYY-MM-DD → assume UTC midnight so date doesn't shift. Adapt offset if relevant.
  const start = raw.length === 10 ? `${raw}T00:00:00+00:00` : raw;
  const dateOnly = raw.slice(0, 10);
  const isFuture = dateOnly >= todayStr;
  const target = isFuture ? future : archive;
  const status = isFuture ? 'scheduled' : 'done';
  const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.company || r.linkedin_url;
  const title = `${status === 'done' ? 'Call' : 'Call (scheduled)'} — ${name}${r.company ? ` / ${r.company}` : ''}`;

  const event = {
    title,
    start,
    end: isFuture ? E.defaultEnd(start, 30) : null,
    type: 'unspecified',
    status,
    attendees: [],
    lead_id: r.linkedin_url || null,
    location: null,
    notes: null,
    source: 'migrate-from-csv',
  };

  const existingIdx = target.events.findIndex(e => e.lead_id === event.lead_id && e.start === event.start);
  if (existingIdx >= 0) { nSkipped++; continue; }

  E.upsert(target, event);
  if (isFuture) nFuture++; else nArchive++;
}

console.log(`Future events to insert:  ${nFuture}`);
console.log(`Archive events to insert: ${nArchive}`);
console.log(`Already-present skipped:  ${nSkipped}`);

if (!commit) {
  console.log('\nDry-run. Re-run with --commit to write events.yml + events-archive.yml + strip call_at.');
  process.exit(0);
}

E.save(future);
E.saveArchive(archive);
console.log('\nWrote events.yml + events-archive.yml.');

console.log('\nStripping call_at values from leads.csv...');
let stripped = 0;
for (const r of rows) {
  if (r.call_at && r.call_at !== '') { r.call_at = ''; stripped++; }
}
L.save(rows);
console.log(`Cleared call_at on ${stripped} rows. The column itself is dropped on next save once HEADERS is updated.`);
