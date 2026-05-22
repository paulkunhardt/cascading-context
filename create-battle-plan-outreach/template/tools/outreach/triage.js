#!/usr/bin/env node
// tools/outreach/triage.js — read-only lead-triage report.
//
// Surfaces 4 buckets of leads that need user attention. Run standalone
// (`node tools/outreach/triage.js`) or pair with an interactive triage
// skill that walks you through each bucket one lead at a time.
//
// Usage: node tools/outreach/triage.js [--bucket BUCKET] [--limit N] [--json]
//
// Buckets:
//   1. ⚠️  Ball in our court  — status=replied, no followed_up_at since their reply, ≥2d (uncapped)
//   2. Awaiting reply        — we followed up ≥4d ago, no response (top 10 by priority)
//   3. Silent accepts        — status=dm_sent + 'accepted' tag + no reply + last touch ≥7d (top 10 by priority)
//   4. Stalled active        — status in {call_done, verbal, call_booked} + last touch ≥7d (uncapped)
//
// Excludes: status in {dead, withdrawn, paying, loi}, tags include any of DEAD_TAGS.
//
// Tunables: edit the threshold constants below to fit your pipeline cadence.
// Extend DEAD_TAGS with project-specific tags that should exclude a lead from
// triage even if its status isn't `dead` (e.g. 'gatekeeper-decline', 'wrong-icp',
// 'parked'). Leave empty if you only rely on status for terminal-state.

const { load } = require('./lib/leads');
// events.yml is the single source of truth for time-based events. Defensive: if the
// events directory is missing (very old installs or base-package-only), provide a
// no-op stub so triage still runs on status/replied_at/followed_up_at signals alone.
let events;
try { events = require('../events/lib/events'); }
catch (e) { events = { eventsByLead: () => [] }; }

const args = process.argv.slice(2);
const filterBucket = (() => {
  const i = args.indexOf('--bucket');
  return i >= 0 ? args[i + 1] : null;
})();
const limitOverride = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) : null;
})();
const asJson = args.includes('--json');

// Tags that should exclude a lead from triage even if status isn't `dead`.
// Extend with your project's terminal-but-not-status-dead tags.
const DEAD_TAGS = [];
const BALL_THRESHOLD_DAYS = 2;
const AWAITING_THRESHOLD_DAYS = 4;
const SILENT_ACCEPT_THRESHOLD_DAYS = 7;
const STALLED_ACTIVE_THRESHOLD_DAYS = 7;
const AWAITING_LIMIT = limitOverride || 10;
const SILENT_LIMIT = limitOverride || 10;

const dayMs = 1000 * 60 * 60 * 24;
const now = Date.now();

function ageDays(dateStr) {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (isNaN(t)) return null;
  return Math.floor((now - t) / dayMs);
}

function hasDeadTag(r) {
  if (!DEAD_TAGS.length) return false;
  const tags = (r.tags || '').toLowerCase().split(',').map(t => t.trim());
  return DEAD_TAGS.some(t => tags.includes(t));
}

function hasTag(r, tag) {
  const tags = (r.tags || '').toLowerCase().split(',').map(t => t.trim());
  return tags.includes(tag.toLowerCase());
}

function fmtName(r) {
  return [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.company || '(unnamed)';
}

function priorityNum(r) {
  const p = parseInt(r.priority, 10);
  return isNaN(p) ? 0 : p;
}

function lastTouchDays(r) {
  // Most recent of: followed_up_at, replied_at, contacted_at, plus most recent event for this lead.
  const eventDates = events.eventsByLead(r.linkedin_url)
    .map(e => e.start ? e.start.slice(0, 10) : null)
    .filter(Boolean);
  const dates = [r.followed_up_at, r.replied_at, r.contacted_at, ...eventDates]
    .map(ageDays)
    .filter(d => d !== null);
  if (!dates.length) return null;
  return Math.min(...dates);
}

function classify(leads) {
  const buckets = { ball: [], awaiting: [], silent: [], stalled: [] };
  for (const r of leads) {
    if (['dead', 'withdrawn', 'paying', 'loi'].includes(r.status)) continue;
    if (hasDeadTag(r)) continue;

    if (r.status === 'replied' && r.replied_at) {
      const repliedTs = new Date(r.replied_at).getTime();
      const followedTs = r.followed_up_at ? new Date(r.followed_up_at).getTime() : 0;
      const replyAge = ageDays(r.replied_at);
      if (followedTs >= repliedTs) {
        const followAge = ageDays(r.followed_up_at);
        if (followAge >= AWAITING_THRESHOLD_DAYS) {
          buckets.awaiting.push({ r, age: followAge });
        }
      } else {
        if (replyAge >= BALL_THRESHOLD_DAYS) {
          buckets.ball.push({ r, age: replyAge });
        }
      }
      continue;
    }

    if (r.status === 'dm_sent' && hasTag(r, 'accepted') && !r.replied_at) {
      const lt = lastTouchDays(r);
      if (lt !== null && lt >= SILENT_ACCEPT_THRESHOLD_DAYS) {
        buckets.silent.push({ r, age: lt });
      }
      continue;
    }

    if (['call_done', 'verbal', 'call_booked'].includes(r.status)) {
      const lt = lastTouchDays(r);
      if (lt !== null && lt >= STALLED_ACTIVE_THRESHOLD_DAYS) {
        buckets.stalled.push({ r, age: lt });
      }
    }
  }

  buckets.ball.sort((a, b) => b.age - a.age);
  buckets.stalled.sort((a, b) => b.age - a.age);
  buckets.awaiting.sort((a, b) => priorityNum(b.r) - priorityNum(a.r) || b.age - a.age);
  buckets.silent.sort((a, b) => priorityNum(b.r) - priorityNum(a.r) || b.age - a.age);

  buckets.awaiting = buckets.awaiting.slice(0, AWAITING_LIMIT);
  buckets.silent = buckets.silent.slice(0, SILENT_LIMIT);

  return buckets;
}

function summarizeNotes(notes, max = 140) {
  if (!notes) return '';
  const first = notes.split(' | ')[0].trim();
  if (first.length <= max) return first;
  return first.slice(0, max - 1) + '…';
}

function renderJson(buckets) {
  const out = {};
  for (const [name, items] of Object.entries(buckets)) {
    out[name] = items.map(({ r, age }) => ({
      name: fmtName(r),
      company: r.company,
      title: r.title,
      country: r.country,
      status: r.status,
      priority: priorityNum(r),
      tags: r.tags,
      age_days: age,
      last_replied_at: r.replied_at,
      last_followed_up_at: r.followed_up_at,
      last_contacted_at: r.contacted_at,
      linkedin_url: r.linkedin_url,
      notes_first: summarizeNotes(r.notes),
    }));
  }
  out.counts = {
    ball: buckets.ball.length,
    awaiting: buckets.awaiting.length,
    silent: buckets.silent.length,
    stalled: buckets.stalled.length,
  };
  return JSON.stringify(out, null, 2);
}

function renderMarkdown(buckets) {
  const lines = [];
  const today = new Date().toISOString().slice(0, 10);
  lines.push(`# Lead triage — ${today}`);
  lines.push('');
  lines.push(`Buckets: ${buckets.ball.length} ball · ${buckets.awaiting.length} awaiting · ${buckets.silent.length} silent accepts · ${buckets.stalled.length} stalled active`);
  lines.push('');

  const renderBucket = (title, items, opts = {}) => {
    if (!items.length) return;
    lines.push(`## ${title} (${items.length})`);
    lines.push('');
    for (const { r, age } of items) {
      const name = fmtName(r);
      const role = [r.title, r.company].filter(Boolean).join(' / ');
      const meta = [
        `${age}d`,
        `p${priorityNum(r)}`,
        r.country,
        opts.showStatus ? r.status : null,
      ].filter(Boolean).join(' · ');
      lines.push(`- **${name}** — ${role}  _(${meta})_`);
      const note = summarizeNotes(r.notes);
      if (note) lines.push(`  > ${note}`);
    }
    lines.push('');
  };

  renderBucket('⚠️  Ball in our court', buckets.ball);
  renderBucket('Awaiting reply (≥4d since our follow-up)', buckets.awaiting);
  renderBucket('Silent accepts (≥7d, never replied)', buckets.silent);
  renderBucket('Stalled active pipeline (≥7d no movement)', buckets.stalled, { showStatus: true });

  return lines.join('\n');
}

function main() {
  const leads = load();
  const buckets = classify(leads);

  if (filterBucket) {
    const valid = ['ball', 'awaiting', 'silent', 'stalled'];
    if (!valid.includes(filterBucket)) {
      console.error(`Invalid --bucket. Use one of: ${valid.join(', ')}`);
      process.exit(1);
    }
    for (const k of valid) {
      if (k !== filterBucket) buckets[k] = [];
    }
  }

  if (asJson) {
    console.log(renderJson(buckets));
  } else {
    console.log(renderMarkdown(buckets));
  }
}

main();
