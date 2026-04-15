#!/usr/bin/env node
// Derives metrics.yml from leads.csv — the CSV is the source of truth.
//
// Usage:
//   node tools/outreach/sync-metrics.js          # prints diff + writes
//   node tools/outreach/sync-metrics.js --dry-run # prints diff only
//   node tools/outreach/sync-metrics.js --quiet   # writes, no output
//
// Called automatically by all flush-* scripts. Also safe to run standalone.
//
// Derivation rules (designed to handle referrals + historical gaps):
//
//   outreach_sent        = status in [dm_sent, replied, call_booked, call_done]
//                          OR (dead AND contacted_at set) OR contacted_at set
//                          NOTE: verbal/loi/paying WITHOUT contacted_at = referrals, excluded from outreach_sent count
//
//   responses            = replied_at is set OR status in [replied, call_booked, call_done]
//                          OR (dead AND replied_at set)
//                          NOTE: verbal/loi/paying WITHOUT replied_at = referrals, excluded from outreach_sent count
//
//   invitations_accepted = rows tagged 'accepted'
//   demo_candidates      = rows tagged 'demo-candidate'
//
//   discovery_calls      = call_at <= today OR status = call_done
//                          OR (dead AND call_at <= today)
//
//   calls_booked         = status = 'call_booked' (snapshot)
//   verbal_commitments   = status in (verbal, loi, paying)
//   lois_signed          = status in (loi, paying)
//   paying_customers     = status = 'paying'
//
//   Per-template metrics (tpl_X_sent, tpl_X_accepted, tpl_X_replied, tpl_X_calls):
//     Derived from rows with a template field, using same logic as above.

const fs = require('fs');
const path = require('path');
const { load } = require('./lib/leads');

const ROOT = path.resolve(__dirname, '../..');
const METRICS = path.join(ROOT, 'metrics.yml');

// Statuses that imply we contacted them through OUR outreach pipeline
const OUTREACH_STATUSES = new Set(['dm_sent', 'replied', 'call_booked', 'call_done']);
// Statuses that imply they responded to us
const RESPONSE_STATUSES = new Set(['replied', 'call_booked', 'call_done']);
// Statuses that imply a call happened or was scheduled
const CALL_STATUSES = new Set(['call_booked', 'call_done', 'verbal', 'loi', 'paying']);

function deriveMetrics(rows) {
  const today = new Date().toISOString().slice(0, 10);

  const m = {
    outreach_sent: 0,
    connections_sent: 0,
    inmails_sent: 0,
    responses: 0,
    invitations_accepted: 0,
    discovery_calls: 0,
    calls_booked: 0,
    demo_candidates: 0,
    verbal_commitments: 0,
    lois_signed: 0,
    paying_customers: 0,
  };

  // Per-template-per-channel accumulators
  // conn_tpl = { A: { sent, accepted, replied, calls }, ... }  — connection requests
  // inmail_tpl = { A: { sent, replied, calls }, ... }           — InMails (no "accepted" concept)
  const conn_tpl = {};
  const inmail_tpl = {};
  // Follow-up metrics (no template — custom messages)
  const followups = { sent: 0, replied: 0, calls: 0 };
  // Legacy combined tpl for metrics.yml compatibility
  const tpl = {};
  // Per-week accumulators: { '2026-W15': { connections: N, inmails: N, followups: N, accepts: N, replies: N, calls: N } }
  const weeks = {};

  for (const r of rows) {
    const s = (r.status || 'new').trim();
    const tags = (r.tags || '').split(',').map(t => t.trim());
    const template = (r.template || '').trim();

    // --- Flags for this row ---
    const wasSent = OUTREACH_STATUSES.has(s) || !!r.contacted_at || (s === 'dead' && !!r.contacted_at);
    const didReply = RESPONSE_STATUSES.has(s) || !!r.replied_at;
    const wasAccepted = tags.includes('accepted');
    const isDemoCandidate = tags.includes('demo-candidate');
    const callDone = s === 'call_done' || (r.call_at && r.call_at <= today) || (s === 'dead' && r.call_at && r.call_at <= today);
    const callBooked = CALL_STATUSES.has(s) || (r.call_at && r.call_at > today);

    const channel = (r.channel || 'connection').trim();

    // --- Pipeline metrics ---
    if (wasSent) {
      m.outreach_sent++;
      if (channel === 'inmail') m.inmails_sent++;
      else m.connections_sent++;
    }
    if (didReply) m.responses++;
    if (wasAccepted) m.invitations_accepted++;
    if (isDemoCandidate) m.demo_candidates++;
    if (callDone) m.discovery_calls++;
    if (s === 'call_booked') m.calls_booked++;
    if (s === 'verbal' || s === 'loi' || s === 'paying') m.verbal_commitments++;
    if (s === 'loi' || s === 'paying') m.lois_signed++;
    if (s === 'paying') m.paying_customers++;

    // --- Follow-up tracking ---
    const hasFollowup = !!r.followed_up_at;
    if (hasFollowup) {
      followups.sent++;
      if (didReply) followups.replied++;
      if (callDone || callBooked) followups.calls++;
    }

    // --- Weekly breakdown ---
    if (wasSent && r.contacted_at) {
      const d = new Date(r.contacted_at);
      // ISO week: Mon=start
      const jan4 = new Date(d.getFullYear(), 0, 4);
      const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 86400000);
      const wk = Math.ceil((dayOfYear + jan4.getDay()) / 7);
      const wkKey = `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`;
      if (!weeks[wkKey]) weeks[wkKey] = { connections: 0, inmails: 0, followups: 0, accepts: 0, replies: 0, calls: 0 };
      if (channel === 'inmail') weeks[wkKey].inmails++;
      else weeks[wkKey].connections++;
      if (hasFollowup) weeks[wkKey].followups++;
      if (wasAccepted) weeks[wkKey].accepts++;
      if (didReply) weeks[wkKey].replies++;
      if (callDone || callBooked) weeks[wkKey].calls++;
    }

    // --- Per-template metrics (split by channel) ---
    if (template && wasSent) {
      // Legacy combined (for metrics.yml keys)
      if (!tpl[template]) tpl[template] = { sent: 0, accepted: 0, replied: 0, calls: 0 };
      tpl[template].sent++;
      if (wasAccepted) tpl[template].accepted++;
      if (didReply) tpl[template].replied++;
      if (callBooked || callDone) tpl[template].calls++;

      // Per-channel split
      if (channel === 'inmail') {
        if (!inmail_tpl[template]) inmail_tpl[template] = { sent: 0, replied: 0, calls: 0 };
        inmail_tpl[template].sent++;
        if (didReply) inmail_tpl[template].replied++;
        if (callBooked || callDone) inmail_tpl[template].calls++;
      } else {
        if (!conn_tpl[template]) conn_tpl[template] = { sent: 0, accepted: 0, replied: 0, calls: 0 };
        conn_tpl[template].sent++;
        if (wasAccepted) conn_tpl[template].accepted++;
        if (didReply) conn_tpl[template].replied++;
        if (callBooked || callDone) conn_tpl[template].calls++;
      }
    }
  }

  // Follow-up aggregate metrics
  m.followups_sent = followups.sent;
  m.followups_replied = followups.replied;
  m.followups_calls = followups.calls;

  // Flatten template metrics into m with tpl_X_* keys (legacy combined)
  for (const [t, stats] of Object.entries(tpl).sort()) {
    m[`tpl_${t}_sent`] = stats.sent;
    m[`tpl_${t}_accepted`] = stats.accepted;
    m[`tpl_${t}_replied`] = stats.replied;
    m[`tpl_${t}_calls`] = stats.calls;
  }

  return { metrics: m, templates: tpl, conn_tpl, inmail_tpl, followups, weeks };
}

function formatRate(n, d) {
  if (!d) return '0.0%';
  return (n / d * 100).toFixed(1) + '%';
}

function syncMetrics(opts = {}) {
  const { dryRun = false, quiet = false } = opts;

  const rows = load();
  const { metrics: derived, templates } = deriveMetrics(rows);

  // Read current metrics.yml
  let text = fs.readFileSync(METRICS, 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const changes = [];

  // Update existing keys
  for (const [key, newVal] of Object.entries(derived)) {
    const re = new RegExp(`^${key}:\\s*\\d+`, 'm');
    const match = text.match(re);
    if (match) {
      const oldVal = parseInt(match[0].split(':')[1].trim(), 10);
      if (oldVal !== newVal) {
        changes.push({ key, oldVal, newVal });
        text = text.replace(re, `${key}: ${newVal}`);
      }
    } else if (key.startsWith('tpl_')) {
      // New template key — append to template section
      // Will be handled below after checking if section exists
    }
  }

  // Ensure template metrics section exists and is up to date
  const tplSection = '\n# Template performance (derived from leads.csv)\n';
  if (!text.includes('# Template performance')) {
    text = text.trimEnd() + '\n' + tplSection;
  }

  // Write all tpl_* keys
  for (const [key, newVal] of Object.entries(derived)) {
    if (!key.startsWith('tpl_')) continue;
    const re = new RegExp(`^${key}:\\s*\\d+`, 'm');
    const match = text.match(re);
    if (match) {
      const oldVal = parseInt(match[0].split(':')[1].trim(), 10);
      if (oldVal !== newVal) {
        if (!changes.find(c => c.key === key)) {
          changes.push({ key, oldVal, newVal });
        }
        text = text.replace(re, `${key}: ${newVal}`);
      }
    } else {
      // New key — append after template section header
      const insertPoint = text.indexOf('# Template performance');
      const lineEnd = text.indexOf('\n', insertPoint);
      text = text.slice(0, lineEnd + 1) + `${key}: ${newVal}\n` + text.slice(lineEnd + 1);
      changes.push({ key, oldVal: '(new)', newVal });
    }
  }

  if (changes.length > 0) {
    text = text.replace(/^last_updated:\s*[\d-]+/m, `last_updated: ${today}`);
    if (!dryRun) {
      fs.writeFileSync(METRICS, text);
    }
  }

  if (!quiet) {
    if (changes.length === 0) {
      console.log('📊 metrics.yml: in sync with leads.csv');
    } else {
      const pipelineChanges = changes.filter(c => !c.key.startsWith('tpl_'));
      const tplChanges = changes.filter(c => c.key.startsWith('tpl_'));
      if (pipelineChanges.length) {
        console.log(`📊 metrics.yml: ${pipelineChanges.length} pipeline metric(s) ${dryRun ? 'would change' : 'synced'}:`);
        for (const c of pipelineChanges) {
          console.log(`   ${c.key}: ${c.oldVal} → ${c.newVal}`);
        }
      }
      if (tplChanges.length) {
        console.log(`📊 Template metrics ${dryRun ? 'would change' : 'synced'}:`);
        for (const c of tplChanges) {
          console.log(`   ${c.key}: ${c.oldVal} → ${c.newVal}`);
        }
      }
    }

    // Always print template summary table in non-quiet mode
    if (Object.keys(templates).length) {
      console.log('\n📈 Template performance:');
      console.log('   Tpl  Sent  Accept  Reply  Calls  Accept%  Reply%  Call%');
      console.log('   ───  ────  ──────  ─────  ─────  ───────  ──────  ─────');
      for (const [t, s] of Object.entries(templates).sort()) {
        console.log(`   ${t.padEnd(4)} ${String(s.sent).padStart(4)}  ${String(s.accepted).padStart(6)}  ${String(s.replied).padStart(5)}  ${String(s.calls).padStart(5)}  ${formatRate(s.accepted, s.sent).padStart(7)}  ${formatRate(s.replied, s.sent).padStart(6)}  ${formatRate(s.calls, s.sent).padStart(5)}`);
      }
    }
  }

  return { changes, derived, templates };
}

// CLI mode
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const quiet = args.includes('--quiet');
  syncMetrics({ dryRun, quiet });

  // Chain: regenerate the ICP conversion dashboard after metrics sync
  try {
    const dashArgs = [path.join(__dirname, 'update-dashboard.js')];
    if (dryRun) dashArgs.push('--dry-run');
    require('child_process').execSync(
      `node ${dashArgs.map(a => JSON.stringify(a)).join(' ')}`,
      { stdio: quiet ? 'ignore' : 'inherit' }
    );
  } catch (e) {
    // Don't fail sync-metrics if dashboard generation fails
    if (!quiet) console.error('⚠️  Dashboard update failed:', e.message);
  }

  // Chain: recalculate priorities based on fresh conversion data
  try {
    const recalcPath = path.join(__dirname, 'recalc-priority.js');
    if (require('fs').existsSync(recalcPath) && !dryRun) {
      require('child_process').execSync(
        `node ${JSON.stringify(recalcPath)}`,
        { stdio: quiet ? 'ignore' : 'inherit' }
      );
    }
  } catch (e) {
    if (!quiet) console.error('⚠️  Priority recalculation failed:', e.message);
  }
}

// Export for use by other scripts
module.exports = { syncMetrics, deriveMetrics };
