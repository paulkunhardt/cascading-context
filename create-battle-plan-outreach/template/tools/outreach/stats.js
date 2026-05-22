#!/usr/bin/env node
const { load } = require('./lib/leads');

function tally(rows, key) {
  const counts = {};
  for (const r of rows) {
    const v = r[key] || '(blank)';
    if (key === 'tags') {
      for (const t of v.split(',').filter(Boolean)) counts[t] = (counts[t] || 0) + 1;
    } else {
      counts[v] = (counts[v] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function print(title, entries, limit = null) {
  console.log(`\n${title}`);
  console.log('─'.repeat(title.length));
  const shown = limit ? entries.slice(0, limit) : entries;
  for (const [k, v] of shown) {
    console.log(`  ${String(v).padStart(5)}  ${k}`);
  }
  if (limit && entries.length > limit) console.log(`  … +${entries.length - limit} more`);
}

const rows = load();
console.log(`\n📋 leads.csv — ${rows.length} total`);
print('By status', tally(rows, 'status'));
print('By source', tally(rows, 'source'));
print('By country', tally(rows, 'country'), 10);
print('By tag', tally(rows, 'tags'), 15);

// Template performance — split by channel
const { deriveMetrics, isoWeekKey } = require('./sync-metrics');
const { metrics: derived, conn_tpl, inmail_tpl, followups, weeks } = deriveMetrics(rows);
const fmtPct = (n, d) => d > 0 ? `${(n / d * 100).toFixed(1)}%` : '  —';

// Helper: print a template table
function printTplTable(title, data, hasAccept) {
  if (Object.keys(data).length === 0) return;
  console.log(`\n${title}`);
  if (hasAccept) {
    console.log('  Tpl  Sent  Accept  Accept%  Reply  Reply%  Calls  Call%');
    console.log('  ───  ────  ──────  ───────  ─────  ──────  ─────  ─────');
    const sorted = Object.entries(data).sort((a, b) => b[1].sent - a[1].sent);
    let totS = 0, totA = 0, totR = 0, totC = 0;
    for (const [id, s] of sorted) {
      console.log(`  ${id.padEnd(4)} ${String(s.sent).padStart(4)}  ${String(s.accepted).padStart(6)}  ${fmtPct(s.accepted, s.sent).padStart(7)}  ${String(s.replied).padStart(5)}  ${fmtPct(s.replied, s.sent).padStart(6)}  ${String(s.calls).padStart(5)}  ${fmtPct(s.calls, s.sent).padStart(5)}`);
      totS += s.sent; totA += s.accepted; totR += s.replied; totC += s.calls;
    }
    // Unassigned connections
    const uS = derived.connections_sent - totS;
    const uA = derived.invitations_accepted - totA;
    const uR = derived.responses - totR - (derived.followups_replied || 0);
    const uC = derived.discovery_calls - totC - (derived.followups_calls || 0);
    if (uS > 0 || uA > 0) {
      console.log(`  ${'—'.padEnd(4)} ${String(uS).padStart(4)}  ${String(uA).padStart(6)}  ${fmtPct(uA, uS || 1).padStart(7)}  ${String(Math.max(0, uR)).padStart(5)}  ${fmtPct(Math.max(0, uR), uS || 1).padStart(6)}  ${String(Math.max(0, uC)).padStart(5)}  ${fmtPct(Math.max(0, uC), uS || 1).padStart(5)}  (no tpl)`);
    }
  } else {
    // InMail: no accept column
    console.log('  Tpl  Sent  Reply  Reply%  Calls  Call%');
    console.log('  ───  ────  ─────  ──────  ─────  ─────');
    const sorted = Object.entries(data).sort((a, b) => b[1].sent - a[1].sent);
    for (const [id, s] of sorted) {
      console.log(`  ${id.padEnd(4)} ${String(s.sent).padStart(4)}  ${String(s.replied).padStart(5)}  ${fmtPct(s.replied, s.sent).padStart(6)}  ${String(s.calls).padStart(5)}  ${fmtPct(s.calls, s.sent).padStart(5)}`);
    }
  }
}

// Connection request performance
printTplTable('📈 Connection request performance (by template)', conn_tpl, true);

// InMail performance (only show if data exists)
if (Object.keys(inmail_tpl).length > 0) {
  printTplTable('📧 InMail performance (by template)', inmail_tpl, false);
}

// Follow-up performance
console.log(`\n🔄 Follow-ups: ${followups.sent} sent · ${followups.replied} replied (${fmtPct(followups.replied, followups.sent).trim()}) · ${followups.calls} calls (${fmtPct(followups.calls, followups.sent).trim()})`);

// FU template breakdown — attribution by follow-up template (FU / FU-B / FU-C / FU-FREE / blank=legacy).
// Connection-note template tracks the FIRST touch (immutable); followup_template tracks what the
// operator actually wrote on the follow-up. Reply/call attribution per FU style lets you measure
// "is `FU-B` better for NONE-connected leads than the standard `FU`?"
const fuByTpl = {};
for (const r of rows) {
  if (!r.followed_up_at) continue;
  const ftpl = r.followup_template || '(legacy)';
  if (!fuByTpl[ftpl]) fuByTpl[ftpl] = { sent: 0, replied: 0, calls: 0 };
  fuByTpl[ftpl].sent++;
  if (r.replied_at) fuByTpl[ftpl].replied++;
  if (['call_booked', 'call_done', 'verbal', 'loi', 'paying'].includes(r.status)) fuByTpl[ftpl].calls++;
}
const FU_ORDER = ['FU', 'FU-B', 'FU-C', 'FU-FREE', '(legacy)'];
const fuEntries = FU_ORDER.filter(k => fuByTpl[k]);
if (fuEntries.length > 0) {
  console.log('\n   FU template breakdown (which follow-up style after accept)');
  console.log('   Tpl       Sent  Reply  Reply%  Calls  Call%');
  console.log('   ────────  ────  ─────  ──────  ─────  ─────');
  for (const k of fuEntries) {
    const s = fuByTpl[k];
    console.log(`   ${k.padEnd(8)}  ${String(s.sent).padStart(4)}  ${String(s.replied).padStart(5)}  ${fmtPct(s.replied, s.sent).padStart(6)}  ${String(s.calls).padStart(5)}  ${fmtPct(s.calls, s.sent).padStart(5)}`);
  }
}

// Weekly breakdown
const sortedWeeks = Object.entries(weeks).sort((a, b) => a[0].localeCompare(b[0]));
if (sortedWeeks.length > 0) {
  console.log('\n📅 Weekly breakdown');
  console.log('  Week       Conn  InMail  Total  Accept  Acc%   Reply  Rep%   Calls  Cal%');
  console.log('  ─────────  ────  ──────  ─────  ──────  ─────  ─────  ─────  ─────  ─────');
  let totConn = 0, totInmail = 0, totTotal = 0, totAcc = 0, totRep = 0, totCal = 0;
  for (const [wk, w] of sortedWeeks) {
    const total = w.connections + w.inmails;
    console.log(`  ${wk.padEnd(9)}  ${String(w.connections).padStart(4)}  ${String(w.inmails).padStart(6)}  ${String(total).padStart(5)}  ${String(w.accepts).padStart(6)}  ${fmtPct(w.accepts, total).padStart(5)}  ${String(w.replies).padStart(5)}  ${fmtPct(w.replies, total).padStart(5)}  ${String(w.calls).padStart(5)}  ${fmtPct(w.calls, total).padStart(5)}`);
    totConn += w.connections; totInmail += w.inmails; totTotal += total;
    totAcc += w.accepts; totRep += w.replies; totCal += w.calls;
  }
  console.log(`  ${'TOTAL'.padEnd(9)}  ${String(totConn).padStart(4)}  ${String(totInmail).padStart(6)}  ${String(totTotal).padStart(5)}  ${String(totAcc).padStart(6)}  ${fmtPct(totAcc, totTotal).padStart(5)}  ${String(totRep).padStart(5)}  ${fmtPct(totRep, totTotal).padStart(5)}  ${String(totCal).padStart(5)}  ${fmtPct(totCal, totTotal).padStart(5)}`);

  // Current week safety check (proper ISO 8601)
  const currentWk = isoWeekKey(new Date());
  const thisWeek = weeks[currentWk];
  if (thisWeek) {
    console.log(`\n  ⚠️  This week (${currentWk}): ${thisWeek.connections} connection requests sent (LinkedIn limit: ~100/week)`);
    if (thisWeek.connections >= 80) console.log(`  🔴 APPROACHING LIMIT — slow down connection requests!`);
    else if (thisWeek.connections >= 50) console.log(`  🟡 Over halfway — pace yourself.`);
    else console.log(`  🟢 Plenty of room.`);
  }
}

// Pipeline summary line
console.log(`\n📊 Pipeline: ${derived.outreach_sent} sent (${derived.connections_sent} conn + ${derived.inmails_sent} inmail) · ${derived.invitations_accepted} accepts · ${derived.responses} replies · ${derived.discovery_calls} calls · ${derived.demo_candidates} demo candidates · ${derived.verbal_commitments} verbal`);

// Highlight pipeline
const pipeline = rows.filter(r => ['replied', 'call_booked', 'call_done', 'verbal', 'loi'].includes(r.status));
console.log(`\n🔥 Active pipeline: ${pipeline.length}`);
for (const r of pipeline) {
  console.log(`  [${r.status.padEnd(11)}] ${r.first_name} ${r.last_name} · ${r.company}`);
}
console.log();
