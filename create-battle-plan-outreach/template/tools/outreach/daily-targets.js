#!/usr/bin/env node
// Generate today's outreach checklist.
// Usage: node tools/outreach/daily-targets.js [count=30] [--source SOURCE] [--followups N] [--inmails N]
//
// Generates four sections:
//   0. Withdraw stale invitations (pending too long — pre-checked to withdraw)
//   1. Follow-ups (accepted but haven't replied, sorted by staleness)
//   2. InMails (stale dm_sent with no accept after 3+ days, high priority)
//   3. New DMs (status=new, sorted by priority)
//
// Default: 20 new + 10 follow-ups + 5 inmails = 35 actions
// Template assignment: country_template_map in templates.json → named template, rest round-robin
// LinkedIn limits: ~100 connection requests/week, 99 InMails/month (Sales Nav Core)

const fs = require('fs');
const path = require('path');
const { load } = require('./lib/leads');
const { deriveMetrics } = require('./sync-metrics');

const argv = process.argv.slice(2);
const countArg = argv.find(a => /^\d+$/.test(a));
const newCount = countArg ? parseInt(countArg) : 20;
const followupsIdx = argv.indexOf('--followups');
const followupCount = followupsIdx >= 0 ? parseInt(argv[followupsIdx + 1]) : 10;
const inmailsIdx = argv.indexOf('--inmails');
const inmailCount = inmailsIdx >= 0 ? parseInt(argv[inmailsIdx + 1]) : 5;
const sourceIdx = argv.indexOf('--source');
const sourceFilter = sourceIdx >= 0 ? argv[sourceIdx + 1] : 'all';

const today = new Date().toISOString().slice(0, 10);
const OUT = path.resolve(__dirname, `../../outreach/inbox/${today}.md`);
const TEMPLATES_PATH = path.resolve(__dirname, 'templates.json');

const rows = load();

// --- Pool 1: New leads ---
// Read excluded types from templates.json (optional field)
let EXCLUDED_COMPANY_TYPES = new Set();
if (fs.existsSync(TEMPLATES_PATH)) {
  const tplConfig = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
  if (tplConfig.excluded_company_types) {
    EXCLUDED_COMPANY_TYPES = new Set(tplConfig.excluded_company_types);
  }
}
let newPool = rows.filter(r => r.status === 'new');
newPool = newPool.filter(r => !EXCLUDED_COMPANY_TYPES.has((r.company_type || '').toLowerCase()));
if (sourceFilter !== 'all') newPool = newPool.filter(r => r.source === sourceFilter);
newPool.sort((a, b) => {
  const pa = parseInt(a.priority || '0') || 0;
  const pb = parseInt(b.priority || '0') || 0;
  if (pb !== pa) return pb - pa;
  const at1 = (a.tags || '').includes('tier1') ? 1 : 0;
  const bt1 = (b.tags || '').includes('tier1') ? 1 : 0;
  if (bt1 !== at1) return bt1 - at1;
  return (a.company || '').localeCompare(b.company || '');
});
const newPicks = newPool.slice(0, newCount);

// --- Pool 2: Follow-ups (accepted, dm_sent, no reply, 3+ days since last touch) ---
// Sort by "last touch" date (followed_up_at if set, else contacted_at), oldest first
const FOLLOWUP_COOLDOWN_DAYS = 3; // minimum days since last message before following up again
let followupPool = rows.filter(r => {
  if (r.status !== 'dm_sent') return false;
  if (!(r.tags || '').includes('accepted')) return false;
  const lastTouch = r.followed_up_at || r.contacted_at || '';
  if (!lastTouch) return false;
  const age = Math.floor((new Date(today) - new Date(lastTouch)) / 86400000);
  return age >= FOLLOWUP_COOLDOWN_DAYS;
});
followupPool.sort((a, b) => {
  const aDate = a.followed_up_at || a.contacted_at || '9999';
  const bDate = b.followed_up_at || b.contacted_at || '9999';
  return aDate.localeCompare(bDate); // oldest first
});
const followupPicks = followupPool.slice(0, followupCount);

// --- Pool 3: InMail candidates (dm_sent, NOT accepted, 3+ days old, high priority) ---
// These people ignored the connection request — try InMail as a second channel
const inmailBase = rows.filter(r => {
  if (r.status !== 'dm_sent') return false;
  if ((r.tags || '').includes('accepted')) return false; // already accepted, use follow-up instead
  if ((r.channel || '') === 'inmail') return false; // already InMailed
  if (!r.contacted_at) return false;
  const daysSinceContact = Math.floor((new Date(today) - new Date(r.contacted_at)) / 86400000);
  return daysSinceContact >= 3;
});
const inmailBaseCount = inmailBase.length;

// Smart gating: prefer high-priority, good-role leads for premium InMail channel
const INMAIL_MIN_PRIORITY = 70;
const INMAIL_PREFERRED_ROLES = /\b(ceo|founder|co-founder|cto|coo|cfo|chief|vp|vice president|director|head of|managing director|owner)\b/i;

// Read excluded types from templates.json (reuse same config)
const inmailExcludedTypes = EXCLUDED_COMPANY_TYPES;

// Apply smart gating
let inmailFiltered = inmailBase.filter(r => {
  const p = parseInt(r.priority || '0') || 0;
  if (p < INMAIL_MIN_PRIORITY) return false;
  if (inmailExcludedTypes.has((r.company_type || '').toLowerCase())) return false;
  return true;
});

// Sort: preferred roles first, then by priority, then oldest
inmailFiltered.sort((a, b) => {
  const aRole = INMAIL_PREFERRED_ROLES.test(a.title || '') ? 1 : 0;
  const bRole = INMAIL_PREFERRED_ROLES.test(b.title || '') ? 1 : 0;
  if (bRole !== aRole) return bRole - aRole;
  const pa = parseInt(a.priority || '0') || 0;
  const pb = parseInt(b.priority || '0') || 0;
  if (pb !== pa) return pb - pa;
  return (a.contacted_at || '').localeCompare(b.contacted_at || '');
});

const inmailPicks = inmailFiltered.slice(0, inmailCount);

// --- Weekly limit tracking ---
const now = new Date();
const weekStart = new Date(now);
weekStart.setDate(now.getDate() - now.getDay() + 1); // Monday
if (now.getDay() === 0) weekStart.setDate(weekStart.getDate() - 7); // Sunday = previous week's Monday
const weekStartStr = weekStart.toISOString().slice(0, 10);
const thisWeekConnections = rows.filter(r => {
  return r.contacted_at && r.contacted_at >= weekStartStr
    && (r.channel || 'connection') === 'connection'
    && r.status !== 'new';
}).length;
const thisMonthInMails = rows.filter(r => {
  return r.contacted_at && r.contacted_at.slice(0, 7) === today.slice(0, 7)
    && (r.channel || '') === 'inmail';
}).length;

// --- Template text + live stats ---
let templates = {};
if (fs.existsSync(TEMPLATES_PATH)) {
  templates = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
}
const { metrics: derived, conn_tpl, inmail_tpl, followups: fuStats } = deriveMetrics(rows);

// Config keys stored alongside template objects — exclude from ranking
const CONFIG_KEYS = new Set(['country_template_map', 'excluded_company_types']);
const ranked = Object.keys(templates)
  .filter(id => !CONFIG_KEYS.has(id) && id !== 'FU')
  .map(id => {
    const sent = derived[`tpl_${id}_sent`] || 0;
    const accepted = derived[`tpl_${id}_accepted`] || 0;
    const replied = derived[`tpl_${id}_replied`] || 0;
    const calls = derived[`tpl_${id}_calls`] || 0;
    const replyRate = sent > 0 ? replied / sent : 0;
    return { id, sent, accepted, replied, calls, replyRate, text: templates[id].text };
  })
  .sort((a, b) => b.replyRate - a.replyRate || b.sent - a.sent);
const defaultTemplate = ranked.length > 0 ? ranked[0].id : null;

const fmtPct = (n, d) => d > 0 ? `${(n / d * 100).toFixed(1)}%` : '—';

// --- Template assignment ---
// Read country→template mapping from templates.json (optional field)
let COUNTRY_TEMPLATE_MAP = {};
if (fs.existsSync(TEMPLATES_PATH)) {
  const tplConfig = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
  if (tplConfig.country_template_map) {
    COUNTRY_TEMPLATE_MAP = tplConfig.country_template_map;
  }
}

// Get available template IDs (exclude config keys + follow-up meta template)
function getTemplateIds() {
  if (!fs.existsSync(TEMPLATES_PATH)) return [];
  const tpl = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
  return Object.keys(tpl).filter(k => !CONFIG_KEYS.has(k) && k !== 'FU');
}

function assignTemplate(r, idx, pool) {
  // Check country mapping first
  if (COUNTRY_TEMPLATE_MAP[r.country]) return COUNTRY_TEMPLATE_MAP[r.country];
  // Round-robin across remaining templates
  const ids = getTemplateIds();
  if (ids.length === 0) return '';
  // Filter out mapped templates for round-robin
  const mappedIds = new Set(Object.values(COUNTRY_TEMPLATE_MAP));
  const unmapped = ids.filter(id => !mappedIds.has(id));
  const pool2 = unmapped.length > 0 ? unmapped : ids;
  return pool2[idx % pool2.length];
}

// --- Days since helper ---
function daysSince(dateStr) {
  if (!dateStr) return '?';
  const d = new Date(dateStr);
  const t = new Date(today);
  return Math.floor((t - d) / 86400000);
}

// --- Build output ---
const lines = [];
lines.push(`# Outreach blitz — ${today}`);
lines.push('');
const totalActions = newPicks.length + followupPicks.length + inmailPicks.length;
lines.push(`**Target: ${newPicks.length} new DMs + ${followupPicks.length} follow-ups + ${inmailPicks.length} InMails = ${totalActions} actions.** Tick the box as you send. Run \`node tools/outreach/flush-targets.js\` when done.`);
lines.push('');
lines.push(`Pools: ${newPool.length} new · ${followupPool.length} follow-up · ${inmailBase.length}/${inmailBaseCount} InMail qualified`);

// --- Stale invitation detection (same rules as stale-invitations.js) ---
const TIER1_DAYS = 7, TIER2_DAYS = 7, TIER3_DAYS = 14;
const RECENT_TOUCH_DAYS = 3;  // any touch within this window overrides staleness (see stale-invitations.js)
const pendingAll = rows.filter(r =>
  r.status === 'dm_sent' &&
  !(r.tags || '').includes('accepted') &&
  r.contacted_at &&
  (r.channel || 'connection') === 'connection'
);
const wasInmailed = (r) => {
  const notes = (r.notes || '').toLowerCase();
  return notes.includes('inmail') || (r.channel === 'inmail');
};
const daysSinceLastTouch = (r) => {
  const c = [r.contacted_at, r.followed_up_at, r.replied_at].filter(Boolean).map(daysSince);
  return c.length ? Math.min(...c) : Infinity;
};
const staleTier1 = [], staleTier2 = [], staleTier3 = [];
for (const r of pendingAll) {
  // Recent-touch buffer: skip leads with any message sent within RECENT_TOUCH_DAYS
  if (daysSinceLastTouch(r) < RECENT_TOUCH_DAYS) continue;
  const age = daysSince(r.contacted_at);
  if (wasInmailed(r) && age >= TIER1_DAYS) {
    staleTier1.push({ ...r, age, tier: 1 });
  } else if (EXCLUDED_COMPANY_TYPES.has((r.company_type || '').toLowerCase()) && age >= TIER2_DAYS) {
    staleTier2.push({ ...r, age, tier: 2 });
  } else if (age >= TIER3_DAYS) {
    staleTier3.push({ ...r, age, tier: 3 });
  }
}
const allStale = [...staleTier1, ...staleTier2, ...staleTier3].sort((a, b) => b.age - a.age);
const totalStale = allStale.length;
lines.push('');
// Limits
const connPct = Math.round(thisWeekConnections / 100 * 100);
const inmailPct = Math.round(thisMonthInMails / 99 * 100);
lines.push(`**Limits:** Connections this week: ${thisWeekConnections}/100 (${connPct}%) · InMails this month: ${thisMonthInMails}/99 (${inmailPct}%)`);
if (thisWeekConnections + newPicks.length > 90) {
  lines.push(`> ⚠️ Sending ${newPicks.length} more connections would put you at ${thisWeekConnections + newPicks.length}/100 — watch it!`);
}
lines.push('');
// Pipeline snapshot
lines.push(`**Pipeline:** ${derived.outreach_sent} sent (${derived.connections_sent} conn + ${derived.inmails_sent} inmail) · ${derived.invitations_accepted} accepts · ${derived.responses} replies · ${derived.discovery_calls} calls · ${derived.demo_candidates} demo candidates · ${derived.verbal_commitments} verbal`);
lines.push('');
// --- Connection request performance ---
if (Object.keys(conn_tpl).length > 0) {
  lines.push('## Connection request performance');
  lines.push('');
  lines.push('| Template | Sent | Accepts | Accept% | Replies | Reply% | Calls | Call% |');
  lines.push('|----------|------|---------|---------|---------|--------|-------|-------|');
  const connRanked = Object.entries(conn_tpl).sort((a, b) => b[1].sent - a[1].sent);
  let cTotS = 0, cTotA = 0, cTotR = 0, cTotC = 0;
  for (const [id, s] of connRanked) {
    const star = id === defaultTemplate ? ' ★' : '';
    lines.push(`| **${id}**${star} | ${s.sent} | ${s.accepted} | ${fmtPct(s.accepted, s.sent)} | ${s.replied} | ${fmtPct(s.replied, s.sent)} | ${s.calls} | ${fmtPct(s.calls, s.sent)} |`);
    cTotS += s.sent; cTotA += s.accepted; cTotR += s.replied; cTotC += s.calls;
  }
  // Unassigned connections
  const uS = derived.connections_sent - cTotS;
  const uA = derived.invitations_accepted - cTotA;
  if (uS > 0 || uA > 0) {
    const uR = Math.max(0, derived.responses - cTotR - (fuStats.replied || 0));
    const uC = Math.max(0, derived.discovery_calls - cTotC - (fuStats.calls || 0));
    lines.push(`| *(no tpl)* | ${uS} | ${uA} | ${fmtPct(uA, uS || 1)} | ${uR} | ${fmtPct(uR, uS || 1)} | ${uC} | ${fmtPct(uC, uS || 1)} |`);
    cTotS += uS; cTotA += uA; cTotR += uR; cTotC += uC;
  }
  lines.push(`| **TOTAL** | **${cTotS}** | **${cTotA}** | **${fmtPct(cTotA, cTotS)}** | **${cTotR}** | **${fmtPct(cTotR, cTotS)}** | **${cTotC}** | **${fmtPct(cTotC, cTotS)}** |`);
  lines.push('');
}

// --- InMail performance (only if data exists) ---
if (Object.keys(inmail_tpl).length > 0) {
  lines.push('## InMail performance');
  lines.push('');
  lines.push('| Template | Sent | Replies | Reply% | Calls | Call% |');
  lines.push('|----------|------|---------|--------|-------|-------|');
  for (const [id, s] of Object.entries(inmail_tpl).sort((a, b) => b[1].sent - a[1].sent)) {
    lines.push(`| **${id}** | ${s.sent} | ${s.replied} | ${fmtPct(s.replied, s.sent)} | ${s.calls} | ${fmtPct(s.calls, s.sent)} |`);
  }
  lines.push('');
}

// --- Follow-up performance ---
lines.push(`**Follow-ups:** ${fuStats.sent} sent · ${fuStats.replied} replied (${fmtPct(fuStats.replied, fuStats.sent)}) · ${fuStats.calls} calls (${fmtPct(fuStats.calls, fuStats.sent)})`);
lines.push('');

// Template texts as copyable quote blocks
if (ranked.length > 0) {
  lines.push('### Templates');
  lines.push('');
  for (const t of ranked) {
    lines.push(`**${t.id}**${t.id === defaultTemplate ? ' ★' : ''}`);
    lines.push(`> ${t.text}`);
    lines.push('');
  }
}
lines.push('**★ = best performer.** Country-mapped leads → assigned template, rest round-robin. Edit template code on any line to override.');
lines.push('');
lines.push('> **Legend:** `[x]` = sent · edit `` `B` ``→`` `C` `` to change template · `[x] reject` = dead · `[x] reject: reason` = dead + tagged');
lines.push('> **Emp/Rev/Type:** edit inline, syncs back to CSV on flush');
lines.push('');

// --- Section 0: Stale invitations to withdraw ---
if (totalStale > 0) {
  lines.push('---');
  lines.push('');
  lines.push(`## 🗑️ Withdraw stale invitations (${totalStale})`);
  lines.push('');
  lines.push('> These invitations have been pending too long. Withdraw them on LinkedIn → My Network → Manage → Sent.');
  lines.push('> **Default:** the main box is pre-checked → withdraw.');
  lines.push('> **Keep:** uncheck the main box → no change, lead stays pending.');
  lines.push('> **Last-shot InMail:** tick `📧 inmail instead` → marks InMail sent today, protects from withdrawal for 3 days. Edit the template letter (`` `B` ``) to override.');
  lines.push('> **Correct the data:** edit `type:` / `emp:` / `rev:` inline — priority will be recalculated on flush.');
  lines.push('');

  for (const r of allStale) {
    const name = `${r.first_name} ${r.last_name}`.trim() || '(no name)';
    const url = r.linkedin_url && !r.linkedin_url.startsWith('manual:') && !r.linkedin_url.startsWith('company:')
      ? r.linkedin_url : '';
    const nameLink = url ? `[${name}](${url})` : `**${name}**`;
    const company = r.company || '';
    const country = r.country || '';
    const emp = r.employees ? `emp:${r.employees}` : 'emp:';
    const rev = r.revenue ? `rev:${r.revenue}` : 'rev:';
    const ctype = r.company_type ? `type:${r.company_type}` : 'type:';
    const tags = (r.tags || '').split(',').filter(t => t && t !== 'salesnav-stage1' && t !== 'tier1' && t !== 'accepted').slice(0, 3).join(' ');
    const tagSuffix = tags ? ` _[${tags}]_` : '';
    const tpl = assignTemplate(r, 0, allStale);
    lines.push(`- [x] 🗑️ ${nameLink} · ${r.title || ''} · ${company} · ${country} · ${emp} · ${rev} · ${ctype} · sent: ${r.contacted_at} (${r.age}d, tier ${r.tier}) · p${r.priority || '?'}${tagSuffix}`);
    lines.push(`  - [ ] 📧 \`${tpl}\` inmail instead (last shot)`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
}

// --- Section 1: Follow-ups (accepted, no reply) ---
if (followupPicks.length > 0) {
  lines.push('---');
  lines.push('');
  lines.push(`## 🔄 Follow-ups (${followupPicks.length}) — accepted but no reply`);
  lines.push('');
  lines.push('> These people accepted your connection. A short follow-up message to book a call.');
  lines.push('> `last_touch` = followed_up_at or contacted_at. Oldest first.');
  lines.push('');
  // Follow-up template (copyable, not tracked)
  const fuTpl = templates['FU'];
  if (fuTpl && fuTpl.text) {
    lines.push('**Follow-up template** (replace `[Name]` and `[Role]`):');
    lines.push(`> ${fuTpl.text}`);
    lines.push('');
  }

  for (const r of followupPicks) {
    const name = `${r.first_name} ${r.last_name}`.trim() || '(no name)';
    const url = r.linkedin_url && !r.linkedin_url.startsWith('manual:') && !r.linkedin_url.startsWith('company:')
      ? r.linkedin_url : '';
    const nameLink = url ? `[${name}](${url})` : `**${name}**`;
    const lastTouch = r.followed_up_at || r.contacted_at || '?';
    const days = daysSince(lastTouch);
    const company = r.company || '';
    const country = r.country || '';
    const tags = (r.tags || '').split(',').filter(t => t && t !== 'salesnav-stage1' && t !== 'tier1' && t !== 'accepted').slice(0, 3).join(' ');
    const tagSuffix = tags ? ` _[${tags}]_` : '';

    const emp = r.employees ? `emp:${r.employees}` : 'emp:';
    const rev = r.revenue ? `rev:${r.revenue}` : 'rev:';
    const ctype = r.company_type ? `type:${r.company_type}` : 'type:';

    lines.push(`- [ ] 🔄 ${nameLink} · ${r.title || ''} · ${company} · ${country} · ${emp} · ${rev} · ${ctype} · last touch: ${lastTouch} (${days}d ago)${tagSuffix}`);
    lines.push(`  - [ ] reject`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
}

// --- Section 2: InMails (stale connection requests, try InMail) ---
if (inmailPicks.length > 0) {
  lines.push('---');
  lines.push('');
  lines.push(`## 📧 InMails (${inmailPicks.length}) — connection ignored 3+ days, try InMail`);
  lines.push('');
  lines.push('> These people haven\'t accepted your connection request. InMail bypasses the connection.');
  lines.push(`> This month: ${thisMonthInMails}/99 InMails used. Sorted by preferred roles → priority → age.`);
  lines.push(`> Filtered from ${inmailBaseCount} candidates → ${inmailFiltered.length} qualified (min p${INMAIL_MIN_PRIORITY}, preferred roles, excluded types)`);
  lines.push('');

  for (const r of inmailPicks) {
    const name = `${r.first_name} ${r.last_name}`.trim() || '(no name)';
    const url = r.linkedin_url && !r.linkedin_url.startsWith('manual:') && !r.linkedin_url.startsWith('company:')
      ? r.linkedin_url : '';
    const nameLink = url ? `[${name}](${url})` : `**${name}**`;
    const days = daysSince(r.contacted_at);
    const company = r.company || '';
    const country = r.country || '';
    const tags = (r.tags || '').split(',').filter(t => t && t !== 'salesnav-stage1' && t !== 'tier1').slice(0, 3).join(' ');
    const tagSuffix = tags ? ` _[${tags}]_` : '';
    const tpl = assignTemplate(r, 0, inmailPicks);

    const emp = r.employees ? `emp:${r.employees}` : 'emp:';
    const rev = r.revenue ? `rev:${r.revenue}` : 'rev:';
    const ctype = r.company_type ? `type:${r.company_type}` : 'type:';

    lines.push(`- [ ] 📧 \`${tpl}\` ${nameLink} · ${r.title || ''} · ${company} · ${country} · ${emp} · ${rev} · ${ctype} · conn sent: ${r.contacted_at} (${days}d ago) · p${r.priority || '?'}${tagSuffix}`);
    lines.push(`  - [ ] reject`);
    lines.push(`  - [ ] 🗑️ withdraw connection`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
}

// --- Section 3: New DMs ---
lines.push('');
lines.push(`## 📨 New DMs (${newPicks.length})`);
lines.push('');

let globalIdx = 0;
let lastSource = '';
for (const r of newPicks) {
  // Source header
  if (r.source !== lastSource) {
    if (lastSource) lines.push('');
    lines.push(`### ${r.source}`);
    lines.push('');
    lastSource = r.source;
  }

  // Legend reminder every 10 leads
  if (globalIdx > 0 && globalIdx % 10 === 0) {
    lines.push('');
    lines.push('> `[x]` = sent · `` `A` ``/`` `B` ``/`` `C` `` = template · emp/rev editable · `[x] reject` = dead');
    lines.push('');
  }

  const name = `${r.first_name} ${r.last_name}`.trim() || '(no name)';
  const url = r.linkedin_url && !r.linkedin_url.startsWith('manual:') && !r.linkedin_url.startsWith('company:')
    ? r.linkedin_url : '';
  const nameLink = url ? `[${name}](${url})` : `**${name}**`;
  const title = (r.title || '').replace(/\|/g, '/');
  const company = r.company || '';
  const country = r.country || '';
  const emp = r.employees ? `emp:${r.employees}` : 'emp:';
  const rev = r.revenue ? `rev:${r.revenue}` : 'rev:';
  const ctype = r.company_type ? `type:${r.company_type}` : 'type:';
  const tags = (r.tags || '').split(',').filter(t => t && t !== 'salesnav-stage1' && t !== 'tier1').slice(0, 3).join(' ');
  const tagSuffix = tags ? ` _[${tags}]_` : '';
  const tpl = assignTemplate(r, globalIdx, newPicks);

  lines.push(`- [ ] \`${tpl}\` ${nameLink} · ${title} · ${company} · ${country} · ${emp} · ${rev} · ${ctype} · p${r.priority || '?'}${tagSuffix}`);
  lines.push(`  - [ ] reject`);
  lines.push('');
  lines.push('---');
  lines.push('');

  globalIdx++;
}

lines.push('');
lines.push('---');
lines.push('');
lines.push('When done: `node tools/outreach/flush-targets.js`');
lines.push('');

fs.writeFileSync(OUT, lines.join('\n'));
console.log(`✓ Wrote ${OUT}`);
console.log(`  ${newPicks.length} new DMs + ${followupPicks.length} follow-ups + ${inmailPicks.length} InMails = ${totalActions} actions`);
if (totalStale > 0) console.log(`  🗑️ ${totalStale} stale invitations to withdraw (${staleTier1.length} T1 + ${staleTier2.length} T2 + ${staleTier3.length} T3)`);
console.log(`  New: top score ${newPicks[0]?.priority || '?'} · bottom ${newPicks[newPicks.length - 1]?.priority || '?'}`);
if (followupPicks.length) {
  const oldest = followupPicks[0];
  const oDate = oldest.followed_up_at || oldest.contacted_at || '?';
  console.log(`  Follow-ups: oldest last-touch ${oDate} (${daysSince(oDate)}d ago)`);
}
if (inmailPicks.length) {
  console.log(`  InMails: ${inmailPicks.length} candidates (oldest conn: ${inmailPicks[0]?.contacted_at || '?'})`);
}
console.log(`  Limits: Connections this week ${thisWeekConnections}/100 · InMails this month ${thisMonthInMails}/99`);
