#!/usr/bin/env node
// Surfaces pending LinkedIn invitations that should be withdrawn.
//
// Usage:
//   node tools/outreach/stale-invitations.js              # show report
//   node tools/outreach/stale-invitations.js --withdraw    # mark stale leads as 'withdrawn' in CSV
//
// Tiers (withdraw priority):
//   Tier 1: pending + InMail sent + 7d+ → double-touched, no response, withdraw
//   Tier 2: pending + excluded company type (from templates.json) + 7d+ → bad ICP, withdraw
//   Tier 3: pending + 14d+ any type → stale, withdraw
//
// "Pending" = status=dm_sent, no 'accepted' tag, has contacted_at, channel=connection
//
// Recent-touch buffer: any outbound touch (contacted_at / followed_up_at / replied_at)
// within the last RECENT_TOUCH_DAYS (default 3) overrides staleness. This protects
// "last-shot InMail" and recent follow-up actions from being withdrawn prematurely.
//
// The --withdraw flag sets status='withdrawn' and prepends a note. This removes them
// from all future pipeline counts and blitz docs. They can be re-contacted later
// if you want (just set status back to 'new').

const fs = require('fs');
const path = require('path');
const { load, save } = require('./lib/leads');

const TEMPLATES_PATH = path.resolve(__dirname, 'templates.json');
const TIER1_DAYS = 7;   // pending + InMail → withdraw after 7d
const TIER2_DAYS = 7;   // pending + excluded ICP type → withdraw after 7d
const TIER3_DAYS = 14;  // pending + any type → withdraw after 14d
const RECENT_TOUCH_DAYS = 3;  // any outbound touch within this window overrides staleness

// Read excluded company types from templates.json (configurable per project)
let EXCLUDED_TYPES = new Set(['b2c', 'consulting']);
if (fs.existsSync(TEMPLATES_PATH)) {
  try {
    const tplConfig = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
    if (tplConfig.excluded_company_types) {
      EXCLUDED_TYPES = new Set(tplConfig.excluded_company_types);
    }
  } catch (e) { /* use defaults */ }
}

const today = new Date().toISOString().slice(0, 10);
const todayMs = new Date(today).getTime();
const daysSince = (d) => Math.floor((todayMs - new Date(d).getTime()) / 86400000);

// Minimum days since the most recent outbound touch (contacted / followed-up / replied).
// Returns Infinity if the lead has never been touched — callers should then skip the buffer.
const daysSinceLastTouch = (r) => {
  const candidates = [r.contacted_at, r.followed_up_at, r.replied_at]
    .filter(Boolean)
    .map(daysSince);
  return candidates.length ? Math.min(...candidates) : Infinity;
};

const doWithdraw = process.argv.includes('--withdraw');

function findStaleInvitations(leads) {
  // Pending = dm_sent, not accepted, has contacted_at, connection channel (not inmail-only)
  const pending = leads.filter(r =>
    r.status === 'dm_sent' &&
    !(r.tags || '').includes('accepted') &&
    r.contacted_at &&
    (r.channel || 'connection') === 'connection'
  );

  const tier1 = []; // pending + also InMailed + 7d+
  const tier2 = []; // pending + excluded company type + 7d+
  const tier3 = []; // pending + 14d+
  const buffered = []; // would otherwise be stale, but had a recent outbound touch

  // Check if lead was also InMailed (has a note mentioning inmail or channel=inmail on a related record)
  const wasInmailed = (r) => {
    const notes = (r.notes || '').toLowerCase();
    return notes.includes('inmail') || (r.channel === 'inmail');
  };

  for (const r of pending) {
    const age = daysSince(r.contacted_at);
    const wouldBeStale =
      (wasInmailed(r) && age >= TIER1_DAYS) ||
      (EXCLUDED_TYPES.has(r.company_type) && age >= TIER2_DAYS) ||
      (age >= TIER3_DAYS);
    if (!wouldBeStale) continue;

    // Recent-touch buffer: any outbound touch (contacted / followed-up / replied)
    // within the last RECENT_TOUCH_DAYS overrides staleness. This prevents
    // withdrawal right after a follow-up or last-shot InMail.
    if (daysSinceLastTouch(r) < RECENT_TOUCH_DAYS) {
      buffered.push({ ...r, age });
      continue;
    }

    if (wasInmailed(r) && age >= TIER1_DAYS) {
      tier1.push({ ...r, age, tier: 1 });
    } else if (EXCLUDED_TYPES.has(r.company_type) && age >= TIER2_DAYS) {
      tier2.push({ ...r, age, tier: 2 });
    } else if (age >= TIER3_DAYS) {
      tier3.push({ ...r, age, tier: 3 });
    }
  }

  return { pending, tier1, tier2, tier3, buffered };
}

// CLI entry point
if (require.main === module) {
  const leads = load();
  const { pending, tier1, tier2, tier3, buffered } = findStaleInvitations(leads);
  const all = [...tier1, ...tier2, ...tier3];

  // Report
  const avgAge = pending.length > 0
    ? (pending.reduce((s, r) => s + daysSince(r.contacted_at), 0) / pending.length).toFixed(1)
    : '0';
  console.log('📋 Stale Invitation Report');
  console.log(`   Total pending invitations: ${pending.length}`);
  if (pending.length > 0) {
    console.log(`   Avg age: ${avgAge}d`);
  }
  console.log(`   Excluded company types: ${[...EXCLUDED_TYPES].join(', ')}`);
  if (buffered.length > 0) {
    console.log(`   🕐 Buffered (recent touch < ${RECENT_TOUCH_DAYS}d, skipped): ${buffered.length}`);
  }
  console.log('');

  function printTier(name, desc, items) {
    console.log(`--- ${name}: ${desc} (${items.length}) ---`);
    if (items.length === 0) { console.log('   (none)\n'); return; }
    items.sort((a, b) => b.age - a.age);
    for (const r of items) {
      console.log(`   ${r.first_name} ${r.last_name} · ${r.company} · ${r.company_type || '?'} · sent: ${r.contacted_at} (${r.age}d ago)`);
    }
    console.log('');
  }

  printTier('Tier 1', 'pending + InMailed + ' + TIER1_DAYS + 'd', tier1);
  printTier('Tier 2', 'pending + excluded type + ' + TIER2_DAYS + 'd', tier2);
  printTier('Tier 3', 'pending + ' + TIER3_DAYS + 'd any type', tier3);

  console.log(`Total to withdraw: ${all.length}`);

  if (all.length === 0) {
    console.log('\n✅ No stale invitations. Check back in a few days.');
    process.exit(0);
  }

  // Age distribution of remaining pending (not stale)
  const remaining = pending.filter(r => !all.find(a => a.linkedin_url === r.linkedin_url));
  const ageBuckets = { '1-3d': 0, '4-6d': 0, '7-10d': 0, '11-13d': 0 };
  remaining.forEach(r => {
    const d = daysSince(r.contacted_at);
    if (d <= 3) ageBuckets['1-3d']++;
    else if (d <= 6) ageBuckets['4-6d']++;
    else if (d <= 10) ageBuckets['7-10d']++;
    else ageBuckets['11-13d']++;
  });
  console.log(`\nRemaining pending after withdrawal: ${remaining.length}`);
  console.log('   Age distribution:', ageBuckets);

  // Upcoming: how many will become stale in next 7 days?
  const upcoming = remaining.filter(r => {
    const d = daysSince(r.contacted_at);
    return (EXCLUDED_TYPES.has(r.company_type) && d >= TIER2_DAYS - 7) ||
           (d >= TIER3_DAYS - 7);
  });
  if (upcoming.length > 0) {
    console.log(`   ⚠️  ${upcoming.length} more will become stale in the next 7 days`);
  }

  if (!doWithdraw) {
    console.log('\nRun with --withdraw to mark these as withdrawn in leads.csv');
    console.log('(You still need to manually withdraw them on LinkedIn!)');
    process.exit(0);
  }

  // Apply withdrawal
  console.log('\n✏️  Marking as withdrawn...');
  let updated = 0;
  for (const stale of all) {
    const r = leads.find(l => l.linkedin_url === stale.linkedin_url);
    if (!r) continue;
    r.status = 'withdrawn';
    r.notes = `Withdrawn ${today} (tier ${stale.tier}, ${stale.age}d stale)` + (r.notes ? ' | ' + r.notes : '');
    updated++;
  }
  save(leads);
  console.log(`✅ ${updated} leads marked as 'withdrawn'`);
  console.log('⚠️  Now go to LinkedIn → My Network → Manage → Sent and withdraw these invitations!');

  // Sync metrics
  try {
    const { syncMetrics } = require('./sync-metrics');
    syncMetrics({ quiet: true });
  } catch (e) { /* ignore */ }
}

module.exports = { findStaleInvitations };
