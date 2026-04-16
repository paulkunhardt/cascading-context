#!/usr/bin/env node
// Regenerates docs/analysis/icp-conversion.md from leads.csv data.
// The dashboard is a derived view — like metrics.yml, never hand-edit it.
//
// Usage:
//   node tools/outreach/update-dashboard.js           # regenerate + write
//   node tools/outreach/update-dashboard.js --dry-run  # print to stdout, don't write
//
// Called automatically by sync-metrics.js at the end of the flush chain:
//   flush-* → sync-metrics → update-dashboard

const fs = require('fs');
const path = require('path');
const { load } = require('./lib/leads');
const { deriveMetrics } = require('./sync-metrics');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(ROOT, 'docs/analysis/icp-conversion.md');

// Company types excluded from new outreach (daily-targets.js mirrors this).
// These still appear in the dashboard but get "Excluded" verdict, not "Kill".
const EXCLUDED_TYPES = new Set();  // Configure via templates.json excluded_company_types

// Company types with 0% conversion that we keep anyway (manual override).
// Data-driven "Kill" verdict is suppressed for these — shows "Keep (manual)" instead.
const KEEP_OVERRIDE = new Set();   // No manual overrides in generic template

// ---------------------------------------------------------------------------
// Title classification
// ---------------------------------------------------------------------------
function classifyTitle(title) {
  const t = (title || '').toLowerCase();
  if (/\b(ceo|founder|co-founder|cofounder|managing director|owner|principal)\b/.test(t)) return 'CEO/Founder';
  if (/\b(cto|coo|cfo|cmo|cpo|chief)\b/.test(t)) return 'C-Suite';
  if (/\b(vp|vice president|director|head of)\b/.test(t)) return 'VP/Director';
  if (/\b(manager|lead|team lead|senior)\b/.test(t)) return 'Manager/Lead';
  return 'Individual';
}

// ---------------------------------------------------------------------------
// Employee band classification
// ---------------------------------------------------------------------------
function classifyEmployees(emp) {
  const n = parseInt(emp, 10);
  if (!n || n <= 0) return 'Unknown';
  if (n <= 20) return '1-20';
  if (n <= 50) return '21-50';
  if (n <= 100) return '51-100';
  if (n <= 200) return '101-200';
  if (n <= 500) return '201-500';
  return '500+';
}

const EMP_BAND_ORDER = ['1-20', '21-50', '51-100', '101-200', '201-500', '500+', 'Unknown'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);

function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function fmtPct(n, d) {
  return pct(n, d).toFixed(1) + '%';
}

// Truncate a label for Mermaid charts (max len)
function trunc(s, maxLen = 16) {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '.';
}

// Escape Mermaid label (remove problematic chars)
function mermaidLabel(s) {
  return s.replace(/["\n\r]/g, '').replace(/[^\w\s/().%-]/g, '');
}

// ---------------------------------------------------------------------------
// Row-level flags (mirrors sync-metrics.js logic)
// ---------------------------------------------------------------------------
const OUTREACH_STATUSES = new Set(['dm_sent', 'replied', 'call_booked', 'call_done', 'verbal', 'loi', 'paying', 'dead']);
const RESPONSE_STATUSES = new Set(['replied', 'call_booked', 'call_done']);

function rowFlags(r) {
  const s = (r.status || 'new').trim();
  const tags = (r.tags || '').split(',').map(t => t.trim());
  const wasSent = OUTREACH_STATUSES.has(s) || !!r.contacted_at;
  const didReply = RESPONSE_STATUSES.has(s) || !!r.replied_at;
  const wasAccepted = tags.includes('accepted');
  const callDone = s === 'call_done' || (r.call_at && r.call_at <= today) || (s === 'dead' && r.call_at && r.call_at <= today);
  const callBooked = ['call_booked', 'call_done', 'verbal', 'loi', 'paying'].includes(s) || (r.call_at && r.call_at > today);
  const hasCall = callDone || callBooked;
  const isVerbal = ['verbal', 'loi', 'paying'].includes(s);
  const isDead = s === 'dead';
  return { wasSent, didReply, wasAccepted, callDone, callBooked, hasCall, isVerbal, isDead, status: s, tags };
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------
function compute(rows) {
  // Overall funnel
  const overall = { contacted: 0, accepted: 0, replied: 0, call: 0, verbal: 0, dead: 0, notDead: 0 };

  // Grouped accumulators
  const byRole = {};
  const byBand = {};
  const byCountry = {};
  const byTemplate = {};
  const byCompanyType = {};

  // Cross-tab: companyType x role for replied+ leads
  const crossTab = {}; // { 'fintech|CEO/Founder': count }

  // Accepted but silent by role
  const acceptedSilent = {};

  // Track who replied per company type
  const whoReplied = {}; // { companyType: ['Name (Company)', ...] }

  // Untapped pool by company type
  const untapped = {};

  for (const r of rows) {
    const f = rowFlags(r);
    const role = classifyTitle(r.title);
    const band = classifyEmployees(r.employees);
    const country = (r.country || 'Unknown').trim() || 'Unknown';
    const template = (r.template || '').trim() || '(none)';
    const compType = (r.company_type || 'unknown').trim() || 'unknown';

    // Init buckets
    for (const [group, key] of [[byRole, role], [byBand, band], [byCountry, country], [byTemplate, template], [byCompanyType, compType]]) {
      if (!group[key]) group[key] = { sent: 0, accepted: 0, replied: 0, call: 0, verbal: 0, dead: 0 };
    }

    if (!untapped[compType]) untapped[compType] = 0;
    if (!whoReplied[compType]) whoReplied[compType] = [];
    if (!acceptedSilent[role]) acceptedSilent[role] = 0;

    if (f.wasSent) {
      overall.contacted++;
      byRole[role].sent++;
      byBand[band].sent++;
      byCountry[country].sent++;
      byTemplate[template].sent++;
      byCompanyType[compType].sent++;

      if (f.isDead) {
        overall.dead++;
        byRole[role].dead++;
        byBand[band].dead++;
        byCountry[country].dead++;
        byTemplate[template].dead++;
        byCompanyType[compType].dead++;
      }

      if (f.wasAccepted) {
        overall.accepted++;
        byRole[role].accepted++;
        byBand[band].accepted++;
        byCountry[country].accepted++;
        byTemplate[template].accepted++;
        byCompanyType[compType].accepted++;

        // Accepted but not replied
        if (!f.didReply) {
          acceptedSilent[role]++;
        }
      }

      if (f.didReply) {
        overall.replied++;
        byRole[role].replied++;
        byBand[band].replied++;
        byCountry[country].replied++;
        byTemplate[template].replied++;
        byCompanyType[compType].replied++;

        // Cross-tab
        const crossKey = `${compType}|${role}`;
        crossTab[crossKey] = (crossTab[crossKey] || 0) + 1;

        // Who replied
        const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
        const comp = r.company || '';
        whoReplied[compType].push(name ? `${name} (${comp})` : comp);
      }

      if (f.hasCall) {
        overall.call++;
        byRole[role].call++;
        byBand[band].call++;
        byCountry[country].call++;
        byTemplate[template].call++;
        byCompanyType[compType].call++;
      }

      if (f.isVerbal) {
        overall.verbal++;
        byRole[role].verbal++;
        byBand[band].verbal++;
        byCountry[country].verbal++;
        byTemplate[template].verbal++;
        byCompanyType[compType].verbal++;
      }
    } else {
      // Not sent = untapped pool
      untapped[compType]++;
    }
  }

  overall.notDead = overall.contacted - overall.dead;

  return { overall, byRole, byBand, byCountry, byTemplate, byCompanyType, crossTab, whoReplied, untapped, acceptedSilent };
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------
function generateMarkdown(data) {
  const { overall, byRole, byBand, byCountry, byTemplate, byCompanyType, crossTab, whoReplied, untapped, acceptedSilent } = data;
  const lines = [];
  const w = (s) => lines.push(s);

  // --- Header ---
  w('# ICP Conversion Analysis');
  w('');
  w(`**Last Updated:** ${today}`);
  w('**Status:** Active');
  w('**Role:** cascade-target');
  w('**Compression:** none');
  w('');

  // --- TL;DR (dynamic) ---
  // For "top" selections, prefer named categories over catch-alls ("Other", "unknown")
  const topRole = Object.entries(byRole).filter(([k, v]) => v.sent >= 5 && k !== 'Individual').sort((a, b) => pct(b[1].replied, b[1].sent) - pct(a[1].replied, a[1].sent))[0]
    || Object.entries(byRole).filter(([, v]) => v.sent >= 5).sort((a, b) => pct(b[1].replied, b[1].sent) - pct(a[1].replied, a[1].sent))[0];
  const topBand = Object.entries(byBand).filter(([k, v]) => v.sent >= 5 && k !== 'Unknown').sort((a, b) => pct(b[1].replied, b[1].sent) - pct(a[1].replied, a[1].sent))[0];
  const compTypes = Object.entries(byCompanyType).filter(([k, v]) => v.sent >= 5 && k !== 'unknown').sort((a, b) => pct(b[1].replied, b[1].sent) - pct(a[1].replied, a[1].sent));
  const topCompType = compTypes[0];
  const deadZones = compTypes.filter(([k, v]) => v.replied === 0 && !KEEP_OVERRIDE.has(k)).map(([k]) => k);

  // Countries with >= 10 sends, sorted by reply rate — exclude "Unknown"
  const topCountries = Object.entries(byCountry).filter(([k, v]) => v.sent >= 10 && k !== 'Unknown').sort((a, b) => pct(b[1].replied, b[1].sent) - pct(a[1].replied, a[1].sent));
  const topCountry = topCountries[0];

  // Templates with sends, sorted by call rate
  const tplSorted = Object.entries(byTemplate).filter(([k, v]) => k !== '(none)' && v.sent >= 5).sort((a, b) => pct(b[1].call, b[1].sent) - pct(a[1].call, a[1].sent));
  const bestTpl = tplSorted[0];
  const worstTpl = tplSorted.length > 1 ? tplSorted[tplSorted.length - 1] : null;

  const totalAcceptedSilent = Object.values(acceptedSilent).reduce((a, b) => a + b, 0);

  let tldr = `**TL;DR:** ${overall.contacted} leads contacted, ${fmtPct(overall.accepted, overall.contacted)} accept rate, ${fmtPct(overall.replied, overall.contacted)} reply rate, ${fmtPct(overall.call, overall.contacted)} call rate, ${fmtPct(overall.verbal, overall.contacted)} verbal.`;

  if (topRole) {
    // Compare top role against the biggest pool with worse conversion (not "Individual")
    const secondRole = Object.entries(byRole)
      .filter(([k, v]) => k !== topRole[0] && k !== 'Individual' && v.sent >= 10)
      .sort((a, b) => b[1].sent - a[1].sent)[0]; // pick by largest pool
    if (secondRole && pct(topRole[1].replied, topRole[1].sent) > pct(secondRole[1].replied, secondRole[1].sent)) {
      const ratio = pct(topRole[1].replied, topRole[1].sent) / (pct(secondRole[1].replied, secondRole[1].sent) || 0.1);
      tldr += ` ${topRole[0]} convert ${ratio.toFixed(0)}x better than ${secondRole[0]} (${fmtPct(topRole[1].replied, topRole[1].sent)} vs ${fmtPct(secondRole[1].replied, secondRole[1].sent)} reply).`;
    } else if (secondRole) {
      tldr += ` ${topRole[0]} reply at ${fmtPct(topRole[1].replied, topRole[1].sent)} (${topRole[1].sent} sends).`;
    }
  }
  if (topBand) tldr += ` ${topBand[0]} employee band is the sweet spot.`;
  if (topCompType && compTypes.length > 1) {
    const secondCT = compTypes.find(([k]) => k !== topCompType[0] && byCompanyType[k].replied > 0);
    if (secondCT) {
      const ratio = pct(topCompType[1].replied, topCompType[1].sent) / (pct(secondCT[1].replied, secondCT[1].sent) || 0.1);
      tldr += ` ${topCompType[0].charAt(0).toUpperCase() + topCompType[0].slice(1)} converts ${ratio.toFixed(0)}x better than ${secondCT[0]} (${fmtPct(topCompType[1].replied, topCompType[1].sent)} vs ${fmtPct(secondCT[1].replied, secondCT[1].sent)} reply).`;
    }
  }
  if (deadZones.length) tldr += ` ${deadZones.map(z => z.charAt(0).toUpperCase() + z.slice(1)).join(', ')} are dead zones — kill from pipeline.`;
  if (totalAcceptedSilent > 0) {
    // Find role with most silent accepts
    const topSilent = Object.entries(acceptedSilent).sort((a, b) => b[1] - a[1])[0];
    if (topSilent && topSilent[1] > 2) tldr += ` ${topSilent[0]}s accept but rarely call.`;
  }
  if (bestTpl && worstTpl) {
    tldr += ` Template ${bestTpl[0]} drives calls; ${worstTpl[0]} underperforms.`;
  }

  w(tldr);
  w('');
  w('---');
  w('');

  // --- 1. Overall Funnel ---
  w('## 1. Overall Funnel');
  w('');
  w('```mermaid');
  w('xychart-beta');
  w(`    title "Outreach Funnel (n=${overall.contacted} contacted)"`);
  w('    x-axis ["Contacted", "Accepted", "Replied", "Call", "Verbal"]');
  w(`    y-axis "Leads" 0 --> ${Math.ceil(overall.contacted * 1.1)}`);
  w(`    bar [${overall.contacted}, ${overall.accepted}, ${overall.replied}, ${overall.call}, ${overall.verbal}]`);
  w('```');
  w('');

  const acceptOfReplied = overall.replied > 0 ? Math.round(overall.replied / overall.accepted * 100) : 0;
  const replyToCall = overall.replied > 0 ? Math.round(overall.call / overall.replied * 100) : 0;
  w(`**Insight:** Steep drop from Contacted (${overall.contacted}) to Accepted (${overall.accepted}, ${fmtPct(overall.accepted, overall.contacted)}). Of those who accept, ${acceptOfReplied}% reply — acceptance is the main filter, not interest. Once someone replies, ${replyToCall}% reach a call. The funnel's bottleneck is getting the initial connection accepted or InMail opened.`);
  w('');
  w('---');
  w('');

  // --- 2. Role Conversion ---
  w('## 2. Role Conversion');
  w('');
  const roleSorted = Object.entries(byRole).sort((a, b) => b[1].sent - a[1].sent);
  const roleLabels = roleSorted.map(([k, v]) => `"${mermaidLabel(k)} (${v.sent})"`);
  const roleReplyPct = roleSorted.map(([, v]) => pct(v.replied, v.sent));
  const roleCallPct = roleSorted.map(([, v]) => pct(v.call, v.sent));
  const roleYMax = Math.max(Math.ceil(Math.max(...roleReplyPct, ...roleCallPct) * 1.2), 5);

  w('```mermaid');
  w('xychart-beta');
  w('    title "Reply % and Call % by Role"');
  w(`    x-axis [${roleLabels.join(', ')}]`);
  w(`    y-axis "Conversion %" 0 --> ${roleYMax}`);
  w(`    bar [${roleReplyPct.join(', ')}]`);
  w(`    bar [${roleCallPct.join(', ')}]`);
  w('```');
  w('');
  w('> Legend: First bar = Reply %, Second bar = Call %');
  w('');

  // Role insight
  if (topRole) {
    const secondRole = Object.entries(byRole).filter(([k, v]) => k !== topRole[0] && v.sent >= 10).sort((a, b) => pct(b[1].replied, b[1].sent) - pct(a[1].replied, a[1].sent));
    let roleInsight = `**Insight:** ${topRole[0]} reply at ${fmtPct(topRole[1].replied, topRole[1].sent)} from ${topRole[1].sent} sends`;
    if (secondRole.length) {
      const ratio = pct(topRole[1].replied, topRole[1].sent) / (pct(secondRole[0][1].replied, secondRole[0][1].sent) || 0.1);
      roleInsight += ` — ${ratio.toFixed(0)}x the rate of ${secondRole[0][0]} (${secondRole[0][1].sent} sends, ${fmtPct(secondRole[0][1].replied, secondRole[0][1].sent)} reply)`;
    }
    roleInsight += '.';

    w(roleInsight);
  }
  w('');
  w('---');
  w('');

  // --- 3. Company Size ---
  w('## 3. Company Size');
  w('');
  const bandSorted = EMP_BAND_ORDER.filter(b => byBand[b] && byBand[b].sent > 0).map(b => [b, byBand[b]]);
  const bandLabels = bandSorted.map(([k, v]) => `"${k} (${v.sent})"`);
  const bandReplyPct = bandSorted.map(([, v]) => pct(v.replied, v.sent));
  const bandCallPct = bandSorted.map(([, v]) => pct(v.call, v.sent));
  const bandYMax = Math.max(Math.ceil(Math.max(...bandReplyPct, ...bandCallPct) * 1.2), 5);

  w('```mermaid');
  w('xychart-beta');
  w('    title "Reply % and Call % by Employee Band"');
  w(`    x-axis [${bandLabels.join(', ')}]`);
  w(`    y-axis "Conversion %" 0 --> ${bandYMax}`);
  w(`    bar [${bandReplyPct.join(', ')}]`);
  w(`    bar [${bandCallPct.join(', ')}]`);
  w('```');
  w('');
  w('> Legend: First bar = Reply %, Second bar = Call %');
  w('');

  // Band insight
  const bestBand = bandSorted.filter(([k]) => k !== 'Unknown').sort((a, b) => pct(b[1].replied, b[1].sent) - pct(a[1].replied, a[1].sent))[0];
  const zeroBands = bandSorted.filter(([k, v]) => k !== 'Unknown' && v.replied === 0 && v.sent >= 5).map(([k]) => k);
  let bandInsight = '';
  if (zeroBands.length) {
    bandInsight += `Companies in the ${zeroBands.join(' and ')} band${zeroBands.length > 1 ? 's' : ''} do not reply — they may be too small for this type of outreach. `;
  }
  if (bestBand) {
    bandInsight += `The ${bestBand[0]} band is the sweet spot: ${bestBand[1].sent} sent with ${fmtPct(bestBand[1].replied, bestBand[1].sent)} reply and ${fmtPct(bestBand[1].call, bestBand[1].sent)} call rate. `;
  }
  bandInsight += 'Focus outreach on the bands with proven conversion.';
  w(`**Insight:** ${bandInsight}`);
  w('');
  w('---');
  w('');

  // --- 4. Country Performance ---
  w('## 4. Country Performance');
  w('');
  const countrySorted = Object.entries(byCountry).sort((a, b) => b[1].sent - a[1].sent);
  const top10Countries = countrySorted.slice(0, 10);

  // Pie chart (sends)
  w('### Sends by Country (Top 10)');
  w('');
  const pieEntries = top10Countries.filter(([, v]) => v.sent > 0);
  if (pieEntries.length) {
    w('```mermaid');
    w('pie title "Outreach Sent by Country (Top 10)"');
    for (const [k, v] of pieEntries) {
      w(`    "${mermaidLabel(k)}" : ${v.sent}`);
    }
    w('```');
  }
  w('');

  // Reply rate bar chart (countries with >= 10 sends)
  w('### Reply Rate by Country');
  w('');
  const countryForChart = countrySorted.filter(([k, v]) => v.sent >= 10 && k !== 'Unknown').sort((a, b) => b[1].sent - a[1].sent);
  if (countryForChart.length) {
    const cLabels = countryForChart.map(([k, v]) => `"${trunc(k, 10)} (${v.sent})"`);
    const cReply = countryForChart.map(([, v]) => pct(v.replied, v.sent));
    const cYMax = Math.max(Math.ceil(Math.max(...cReply) * 1.2), 5);

    w('```mermaid');
    w('xychart-beta');
    w('    title "Reply % by Country (where sent >= 10)"');
    w(`    x-axis [${cLabels.join(', ')}]`);
    w(`    y-axis "Reply %" 0 --> ${cYMax}`);
    w(`    bar [${cReply.join(', ')}]`);
    w('```');
  }
  w('');

  // Country insight
  const bestCountry = countryForChart.sort((a, b) => pct(b[1].replied, b[1].sent) - pct(a[1].replied, a[1].sent))[0];
  let countryInsight = '';
  if (bestCountry) {
    countryInsight += `${bestCountry[0]} leads with ${fmtPct(bestCountry[1].replied, bestCountry[1].sent)} reply rate`;
    if (bestCountry[1].call > 0) countryInsight += ` and ${fmtPct(bestCountry[1].call, bestCountry[1].sent)} call rate`;
    countryInsight += '. ';
  }
  const deadCountries = countryForChart.filter(([, v]) => v.replied === 0).map(([k]) => k);
  if (deadCountries.length) {
    countryInsight += `${deadCountries.join(', ')} show${deadCountries.length === 1 ? 's' : ''} zero engagement. `;
  }
  countryInsight += 'Consider doubling down on countries with proven conversion for near-term pipeline.';
  w(`**Insight:** ${countryInsight}`);
  w('');
  w('---');
  w('');

  // --- 5. Template Performance ---
  w('## 5. Template Performance');
  w('');
  const tplEntries = Object.entries(byTemplate).filter(([, v]) => v.sent > 0).sort((a, b) => b[1].sent - a[1].sent);
  if (tplEntries.length) {
    const tLabels = tplEntries.map(([k, v]) => `"${mermaidLabel(trunc(k, 12))} (${v.sent})"`);
    const tAccept = tplEntries.map(([, v]) => pct(v.accepted, v.sent));
    const tReply = tplEntries.map(([, v]) => pct(v.replied, v.sent));
    const tCall = tplEntries.map(([, v]) => pct(v.call, v.sent));
    const tYMax = Math.max(Math.ceil(Math.max(...tAccept, ...tReply, ...tCall) * 1.2), 5);

    w('```mermaid');
    w('xychart-beta');
    w('    title "Template Funnel: Accept %, Reply %, Call %"');
    w(`    x-axis [${tLabels.join(', ')}]`);
    w(`    y-axis "Conversion %" 0 --> ${tYMax}`);
    w(`    bar [${tAccept.join(', ')}]`);
    w(`    bar [${tReply.join(', ')}]`);
    w(`    bar [${tCall.join(', ')}]`);
    w('```');
    w('');
    w('> Legend: First bar = Accept %, Second bar = Reply %, Third bar = Call %');
    w('');

    // Template insight
    const bestTplEntry = tplEntries.filter(([k]) => k !== '(none)').sort((a, b) => pct(b[1].call, b[1].sent) - pct(a[1].call, a[1].sent))[0];
    const worstTplEntry = tplEntries.filter(([k]) => k !== '(none)').sort((a, b) => pct(a[1].call, a[1].sent) - pct(b[1].call, b[1].sent))[0];
    let tplInsight = '';
    if (bestTplEntry) {
      tplInsight += `Template ${bestTplEntry[0]} has the best full-funnel conversion — ${fmtPct(bestTplEntry[1].accepted, bestTplEntry[1].sent)} accept, ${fmtPct(bestTplEntry[1].replied, bestTplEntry[1].sent)} reply, ${fmtPct(bestTplEntry[1].call, bestTplEntry[1].sent)} call. `;
    }
    if (worstTplEntry && worstTplEntry[0] !== (bestTplEntry || [''])[0]) {
      tplInsight += `Template ${worstTplEntry[0]} has the most volume (${worstTplEntry[1].sent}) but `;
      if (worstTplEntry[1].call === 0) tplInsight += 'zero calls — needs rework or retirement. ';
      else tplInsight += `only ${fmtPct(worstTplEntry[1].call, worstTplEntry[1].sent)} call rate. `;
    }
    tplInsight += 'Consider A-style personalization for all templates.';
    w(`**Insight:** ${tplInsight}`);
  }
  w('');
  w('---');
  w('');

  // --- 6. Pipeline Waterfall ---
  w('## 6. Pipeline Waterfall');
  w('');
  w('```mermaid');
  w('xychart-beta');
  w('    title "Pipeline Waterfall — Where Leads Drop Off"');
  w('    x-axis ["Contacted", "Not Dead", "Accepted", "Replied", "Call", "Verbal"]');
  w(`    y-axis "Leads" 0 --> ${Math.ceil(overall.contacted * 1.1)}`);
  w(`    bar [${overall.contacted}, ${overall.notDead}, ${overall.accepted}, ${overall.replied}, ${overall.call}, ${overall.verbal}]`);
  w('```');
  w('');

  const deadPct = fmtPct(overall.dead, overall.contacted);
  const notDeadPct = fmtPct(overall.notDead, overall.contacted);
  const acceptOfNotDead = fmtPct(overall.accepted, overall.notDead);
  const replyOfAccepted = fmtPct(overall.replied, overall.accepted);
  const callOfReplied = fmtPct(overall.call, overall.replied);
  const verbalOfCall = fmtPct(overall.verbal, overall.call);

  w('| Stage | Count | Drop-off | Conversion from previous |');
  w('|-------|-------|----------|-------------------------|');
  w(`| Contacted | ${overall.contacted} | — | — |`);
  w(`| Not Dead | ${overall.notDead} | -${overall.dead} (${deadPct} dead) | ${notDeadPct} |`);
  w(`| Accepted | ${overall.accepted} | -${overall.notDead - overall.accepted} | ${acceptOfNotDead} of not-dead |`);
  w(`| Replied | ${overall.replied} | -${overall.accepted - overall.replied} | ${replyOfAccepted} of accepted |`);
  w(`| Call booked/done | ${overall.call} | -${overall.replied - overall.call} | ${callOfReplied} of replied |`);
  w(`| Verbal commitment | ${overall.verbal} | -${overall.call - overall.verbal} | ${verbalOfCall} of calls |`);
  w('');

  const biggestDrop = overall.notDead - overall.accepted;
  const biggestDropPct = Math.round(biggestDrop / overall.notDead * 100);
  w(`**Insight:** The biggest absolute drop is Contacted-to-Accepted (${biggestDrop} leads lost, ${biggestDropPct}% drop). This is normal for cold LinkedIn outreach but highlights the need for volume. Once accepted, the funnel is relatively efficient: ${replyOfAccepted} of accepts reply, ${callOfReplied} of replies become calls. The dead rate (${deadPct}) is healthy — most non-responders are simply silent, not hostile. The ${totalAcceptedSilent} accepted-but-not-replied leads are the highest-value follow-up pool.`);
  w('');
  w('---');
  w('');

  // --- 7. Company Type Conversion ---
  w('## 7. Company Type Conversion');
  w('');
  const ctSorted = Object.entries(byCompanyType).filter(([, v]) => v.sent > 0).sort((a, b) => pct(b[1].replied, b[1].sent) - pct(a[1].replied, a[1].sent));

  if (ctSorted.length) {
    // Reply % chart
    const ctLabels = ctSorted.map(([k]) => `"${trunc(mermaidLabel(k), 12)}"`);
    const ctReply = ctSorted.map(([, v]) => pct(v.replied, v.sent));
    const ctYMax = Math.max(Math.ceil(Math.max(...ctReply) * 1.2), 5);

    w('```mermaid');
    w('xychart-beta');
    w('    title "Reply % by Company Type (contacted only)"');
    w(`    x-axis [${ctLabels.join(', ')}]`);
    w(`    y-axis "Reply %" 0 --> ${ctYMax}`);
    w(`    bar [${ctReply.join(', ')}]`);
    w('```');
    w('');

    // Call % chart
    const ctCall = ctSorted.map(([, v]) => pct(v.call, v.sent));
    const ctCallYMax = Math.max(Math.ceil(Math.max(...ctCall) * 1.2), 5);

    w('```mermaid');
    w('xychart-beta');
    w('    title "Call % by Company Type"');
    w(`    x-axis [${ctLabels.join(', ')}]`);
    w(`    y-axis "Call %" 0 --> ${ctCallYMax}`);
    w(`    bar [${ctCall.join(', ')}]`);
    w('```');
    w('');

    // Table
    w('| Company Type | Sent | Accept% | Reply% | Call% | Dead | Who Replied |');
    w('|---|---|---|---|---|---|---|');
    for (const [k, v] of ctSorted) {
      const who = (whoReplied[k] || []).join(', ') || '—';
      w(`| **${k}** | ${v.sent} | ${fmtPct(v.accepted, v.sent)} | **${fmtPct(v.replied, v.sent)}** | **${fmtPct(v.call, v.sent)}** | ${v.dead} | ${who} |`);
    }
    w('');

    // Company type insight
    const bestCT = ctSorted[0];
    const deadCTs = ctSorted.filter(([, v]) => v.replied === 0 && v.sent >= 5);
    let ctInsight = '';
    if (bestCT) {
      ctInsight += `**${bestCT[0]}** has the highest reply rate (${fmtPct(bestCT[1].replied, bestCT[1].sent)} from ${bestCT[1].sent} sends). `;
    }
    // Compare to b2b-saas if it exists
    const saas = byCompanyType['b2b-saas'];
    if (saas && bestCT && bestCT[0] !== 'b2b-saas' && saas.replied > 0) {
      const ratio = pct(bestCT[1].replied, bestCT[1].sent) / (pct(saas.replied, saas.sent) || 0.1);
      ctInsight += `That's ${ratio.toFixed(0)}x better than b2b-saas (${fmtPct(saas.replied, saas.sent)}). `;
    }
    if (deadCTs.length) {
      ctInsight += `**${deadCTs.map(([k, v]) => `${k} (${v.sent} sent)`).join(', ')}** show zero replies — dead zones. `;
    }
    w(`**Insight:** ${ctInsight}`);
    w('');
  }

  // Untapped pool
  const totalUntapped = Object.values(untapped).reduce((a, b) => a + b, 0);
  if (totalUntapped > 0) {
    w(`### Untapped Pool by Company Type (${totalUntapped.toLocaleString('en-US')} unsent leads)`);
    w('');
    w('| Type | Available | % of Pool | Verdict |');
    w('|---|---|---|---|');
    const untappedSorted = Object.entries(untapped).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    for (const [k, v] of untappedSorted) {
      const poolPct = fmtPct(v, totalUntapped);
      const ct = byCompanyType[k];
      let verdict = 'Neutral — too few sends to judge';
      if (EXCLUDED_TYPES.has(k)) {
        verdict = '**Excluded** — removed from daily batches';
      } else if (KEEP_OVERRIDE.has(k) && ct && ct.replied === 0) {
        verdict = 'Keep (manual override) — 0% so far but expected ICP';
      } else if (ct) {
        if (ct.replied === 0 && ct.sent >= 10) verdict = '**Kill** — 0% conversion, waste of slots';
        else if (ct.replied === 0 && ct.sent >= 5) verdict = '**Kill** — 0% conversion';
        else if (ct.call > 0 && pct(ct.replied, ct.sent) > 5) verdict = '**Boost priority** — strong conversion';
        else if (ct.replied > 0 && pct(ct.replied, ct.sent) > 3) verdict = 'Keep — decent conversion';
        else if (ct.replied > 0) verdict = 'Keep — some conversion';
        else if (ct.accepted > 0 && ct.call === 0) verdict = '**Deprioritize** — accept but don\'t call';
      }
      w(`| ${k} | ${v} | ${poolPct} | ${verdict} |`);
    }
    w('');
  }

  w('---');
  w('');

  // --- Cross-tab ---
  if (Object.keys(crossTab).length > 0) {
    w('## 8. Cross-Tab: Company Type x Role (Replied+ Leads)');
    w('');
    // Get unique company types and roles from cross-tab
    const ctypes = [...new Set(Object.keys(crossTab).map(k => k.split('|')[0]))].sort();
    const roles = [...new Set(Object.keys(crossTab).map(k => k.split('|')[1]))].sort();
    w(`| Company Type | ${roles.join(' | ')} | Total |`);
    w(`|---|${roles.map(() => '---|').join('')}---|`);
    for (const ct of ctypes) {
      let total = 0;
      const cells = roles.map(r => {
        const v = crossTab[`${ct}|${r}`] || 0;
        total += v;
        return v || '—';
      });
      w(`| **${ct}** | ${cells.join(' | ')} | ${total} |`);
    }
    w('');
    w('---');
    w('');
  }

  // --- Accepted-but-Silent ---
  if (totalAcceptedSilent > 0) {
    w('## 9. Accepted-but-Silent Breakdown');
    w('');
    w('| Role | Accepted & Silent | % of Silent Pool |');
    w('|---|---|---|');
    const silentSorted = Object.entries(acceptedSilent).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    for (const [k, v] of silentSorted) {
      w(`| ${k} | ${v} | ${fmtPct(v, totalAcceptedSilent)} |`);
    }
    w('');
    w('---');
    w('');
  }

  // --- Key Findings ---
  w('## Key Findings');
  w('');

  // Generate findings dynamically
  const findings = [];

  // Best ICP combination
  if (topRole && topBand) {
    const topCountryNames = topCountries.filter(([k, v]) => v.replied > 0 && k !== 'Unknown').slice(0, 3).map(([k]) => k);
    findings.push(`**Best ICP: ${topRole[0]} at a ${topBand[0]} person company in ${topCountryNames.join(', ') || 'Western Europe'}** — this combination shows the highest conversion across all funnel stages`);
  }

  // Worst converting large pool
  const largePoolBad = Object.entries(byRole).filter(([, v]) => v.sent >= 50).sort((a, b) => pct(a[1].replied, a[1].sent) - pct(b[1].replied, b[1].sent))[0];
  if (largePoolBad) {
    findings.push(`**${largePoolBad[0]}s are the biggest pool but worst converters** — ${largePoolBad[1].sent} sent, ${fmtPct(largePoolBad[1].replied, largePoolBad[1].sent)} reply, ${fmtPct(largePoolBad[1].call, largePoolBad[1].sent)} call`);
  }

  // Company type comparison
  if (topCompType && compTypes.length > 1) {
    const second = compTypes.find(([k, v]) => k !== topCompType[0] && v.replied > 0);
    if (second) {
      findings.push(`**${topCompType[0]} > ${second[0]}** — ${fmtPct(topCompType[1].replied, topCompType[1].sent)} vs ${fmtPct(second[1].replied, second[1].sent)} reply, ${fmtPct(topCompType[1].call, topCompType[1].sent)} vs ${fmtPct(second[1].call, second[1].sent)} call`);
    }
  }

  // Dead zones
  if (deadZones.length) {
    const deadTotal = deadZones.reduce((sum, z) => sum + (byCompanyType[z] ? byCompanyType[z].sent : 0), 0);
    const deadPool = deadZones.reduce((sum, z) => sum + (untapped[z] || 0), 0);
    findings.push(`**${deadZones.join(', ')} = dead zones** — ${deadTotal} sends, zero replies combined. Kill from pipeline — frees ~${deadPool} slots`);
  }

  // Sub-50 employees
  const sub50 = ['1-20', '21-50'].filter(b => byBand[b] && byBand[b].sent >= 5 && byBand[b].replied === 0);
  if (sub50.length) {
    findings.push(`**Sub-50 employee companies do not engage** — they may be too small for this type of outreach`);
  }

  // Template underperformer
  if (worstTpl && byTemplate[worstTpl[0]] && byTemplate[worstTpl[0]].call === 0 && byTemplate[worstTpl[0]].sent >= 20) {
    findings.push(`**Template ${worstTpl[0]} underperforms** — high volume (${byTemplate[worstTpl[0]].sent}) but zero calls. The messaging likely misses the mark`);
  }

  // Country comparison: flag when a non-dominant country outperforms the largest-volume country
  const volumeSortedCountries = Object.entries(byCountry).filter(([k, v]) => v.sent >= 10 && k !== 'Unknown').sort((a, b) => b[1].sent - a[1].sent);
  const dominantCountry = volumeSortedCountries[0];
  if (bestCountry && dominantCountry && bestCountry[0] !== dominantCountry[0] && dominantCountry[1].sent >= 10) {
    findings.push(`**${bestCountry[0]} outperforms ${dominantCountry[0]}** — ${fmtPct(bestCountry[1].replied, bestCountry[1].sent)} vs ${fmtPct(dominantCountry[1].replied, dominantCountry[1].sent)} reply rate. Consider rebalancing outreach mix`);
  }

  // Accepted-but-silent opportunity
  if (totalAcceptedSilent > 0) {
    findings.push(`**The ${totalAcceptedSilent} accepted-but-silent leads are the best follow-up opportunity** — they've shown intent by accepting, just need a nudge`);
  }

  for (const f of findings) {
    w(`- ${f}`);
  }

  w('');

  // --- Sweet Spot ---
  w('## Sweet Spot Definition');
  w('');
  // Prefer named roles over "Individual" for sweet spot definition
  const allRolesByConv = Object.entries(byRole).filter(([, v]) => v.replied > 0 && v.sent >= 3).sort((a, b) => pct(b[1].replied, b[1].sent) - pct(a[1].replied, a[1].sent));
  const namedRoles = allRolesByConv.filter(([k]) => k !== 'Individual').slice(0, 2).map(([k]) => k);
  const bestRoles = namedRoles.length >= 2 ? namedRoles : allRolesByConv.slice(0, 2).map(([k]) => k);
  const bestBandsArr = bandSorted.filter(([k, v]) => k !== 'Unknown' && v.replied > 0).sort((a, b) => pct(b[1].replied, b[1].sent) - pct(a[1].replied, a[1].sent)).slice(0, 2).map(([k]) => k);
  // Merge adjacent bands into a range (e.g. "51-100" + "101-200" → "51-200")
  let bandRange = bestBandsArr.join(' or ');
  if (bestBandsArr.length === 2) {
    const nums = bestBandsArr.map(b => b.split('-').map(Number)).flat().filter(n => !isNaN(n));
    if (nums.length >= 2) bandRange = `${Math.min(...nums)}-${Math.max(...nums)}`;
  }
  const bestCTypes = compTypes.filter(([, v]) => v.replied > 0).slice(0, 3).map(([k]) => k);
  const bestCountries = topCountries.filter(([k, v]) => v.replied > 0 && k !== 'Unknown').slice(0, 4).map(([k]) => k);

  w(`> **Primary ICP:** ${bestRoles.join(' or ')} at a ${bandRange} employee **${bestCTypes.join(' or ')}** company in ${bestCountries.join(', ') || 'Western Europe'}.${bestCTypes[0] ? ` ${bestCTypes[0].charAt(0).toUpperCase() + bestCTypes[0].slice(1)} should be over-indexed.` : ''}`);
  w('');

  // Deprioritize
  const deprioritize = [];
  if (largePoolBad) deprioritize.push(`${largePoolBad[0]}s at companies <50 employees`);
  const deadCountriesList = countryForChart ? countryForChart.filter(([, v]) => v.replied === 0).map(([k]) => k) : [];
  if (deadCountriesList.length) deprioritize.push(`${deadCountriesList.join(', ')} markets`);
  if (deprioritize.length) {
    w(`> **Deprioritize:** ${deprioritize.join(', ')}.`);
    w('');
  }

  // Kill
  if (deadZones.length) {
    const killDetails = deadZones.map(z => {
      const v = byCompanyType[z];
      return `${z.charAt(0).toUpperCase() + z.slice(1)} (0/${v ? v.sent : 0})`;
    });
    const deadPool = deadZones.reduce((sum, z) => sum + (untapped[z] || 0), 0);
    w(`> **Kill from pipeline:** ${killDetails.join(', ')}. These represent ~${deadPool} unsent leads that should be excluded from daily batches.`);
    w('');
  }

  // --- Next Steps ---
  w('## Next Steps');
  w('');
  const steps = [];
  if (topRole && largePoolBad && topRole[0] !== largePoolBad[0]) {
    steps.push(`**Rebalance role targeting:** Shift away from ${largePoolBad[0]}-heavy targeting toward ${topRole[0]} roles`);
  }
  if (worstTpl && byTemplate[worstTpl[0]] && byTemplate[worstTpl[0]].call === 0 && byTemplate[worstTpl[0]].sent >= 10) {
    steps.push(`**Rework Template ${worstTpl[0]}:** Either retire or A/B test a new version — zero calls from ${byTemplate[worstTpl[0]].sent} sends is unacceptable`);
  }
  if (bestCountry && bestCountry[1].sent >= 10) {
    steps.push(`**Double down on ${bestCountry[0]}:** Reply rate ${fmtPct(bestCountry[1].replied, bestCountry[1].sent)} — consider localized templates`);
  }
  if (totalAcceptedSilent > 0) {
    steps.push(`**Follow up on the ${totalAcceptedSilent} accepted-but-silent leads:** These are warm — schedule follow-up messages`);
  }
  for (const s of steps) {
    w(`- ${s}`);
  }
  w('');

  // --- Methodology ---
  w('## Methodology');
  w('');
  w('> This dashboard is auto-generated from `outreach/leads.csv` by `tools/outreach/update-dashboard.js`.');
  w('> It runs automatically after every `flush-*` or `sync-metrics` operation.');
  w('> **Do not hand-edit this file** — changes will be overwritten on next update.');
  w('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function updateDashboard(opts = {}) {
  const { dryRun = false } = opts;

  const rows = load();
  const data = compute(rows);
  const md = generateMarkdown(data);

  // Compare key numbers with existing file
  let oldNumbers = null;
  if (fs.existsSync(OUTPUT)) {
    const oldContent = fs.readFileSync(OUTPUT, 'utf8');
    const match = oldContent.match(/(\d+) leads contacted/);
    if (match) oldNumbers = { contacted: parseInt(match[1], 10) };
  }

  if (dryRun) {
    console.log(md);
    console.log('\n--- DRY RUN — not written ---');
  } else {
    // Ensure directory exists
    const dir = path.dirname(OUTPUT);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OUTPUT, md);
  }

  // Print summary
  const summary = [
    `  Contacted: ${data.overall.contacted}`,
    `  Accepted:  ${data.overall.accepted} (${fmtPct(data.overall.accepted, data.overall.contacted)})`,
    `  Replied:   ${data.overall.replied} (${fmtPct(data.overall.replied, data.overall.contacted)})`,
    `  Calls:     ${data.overall.call} (${fmtPct(data.overall.call, data.overall.contacted)})`,
    `  Verbal:    ${data.overall.verbal} (${fmtPct(data.overall.verbal, data.overall.contacted)})`,
  ];

  if (oldNumbers && oldNumbers.contacted !== data.overall.contacted) {
    summary.push(`  Changed: contacted ${oldNumbers.contacted} → ${data.overall.contacted}`);
  }

  if (!dryRun) {
    console.log(`📊 Dashboard ${dryRun ? 'would be' : ''} written to docs/analysis/icp-conversion.md`);
  }
  for (const l of summary) console.log(l);

  return data;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  updateDashboard({
    dryRun: args.includes('--dry-run'),
  });
}

module.exports = { updateDashboard, classifyTitle, classifyEmployees, compute };
