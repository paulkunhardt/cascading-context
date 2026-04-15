#!/usr/bin/env node
// Recalculates priority scores for all unsent leads based on conversion data + rejection patterns.
//
// This closes the learning loop:
//   Blitz → send/reject → Flush captures reasons + outcomes →
//   recalc-priority.js adjusts all unsent lead scores → Next blitz picks better leads
//
// Usage:
//   node tools/outreach/recalc-priority.js              # recalculate + apply
//   node tools/outreach/recalc-priority.js --dry-run    # show what would change
//   node tools/outreach/recalc-priority.js --explain    # show scoring weights
//
// Scoring factors (weighted):
//   1. Role conversion rates (from actual outreach data)        0-30
//   2. Company type conversion rates                            0-25
//   3. Country conversion rates                                 0-18
//   4. Employee band conversion rates                           0-15
//   5. Rejection pattern penalties                              up to -15
//
// The score is 0-88 (data-driven) or clamped to 0-100. Higher = picked first.

const { load, save } = require('./lib/leads');

const dryRun = process.argv.includes('--dry-run');
const explain = process.argv.includes('--explain');

// --- Helpers ---
const OUTREACH_STATUSES = new Set(['dm_sent', 'replied', 'call_booked', 'call_done', 'verbal', 'loi', 'paying', 'dead', 'withdrawn']);

function classifyRole(title) {
  const t = (title || '').toLowerCase();
  if (/founder|ceo|chief executive|managing director/.test(t)) return 'ceo-founder';
  if (/\bc[ts]o\b|chief.*technology|chief.*operating|vp.*eng|head.*eng|director.*eng/.test(t)) return 'cto-tech';
  if (/\bcoo\b|chief.*operating/.test(t)) return 'c-suite';
  if (/\bvp\b/.test(t)) return 'vp';
  if (/head of|director/.test(t)) return 'director';
  if (/manager/.test(t)) return 'manager';
  return 'other';
}

function classifyEmpBand(emp) {
  const n = parseInt(emp || '0') || 0;
  if (n === 0) return 'unknown';
  if (n <= 20) return '1-20';
  if (n <= 50) return '21-50';
  if (n <= 100) return '51-100';
  if (n <= 200) return '101-200';
  return '201+';
}

// --- Step 1: Compute conversion rates from actual data ---
function computeConversionRates(rows) {
  const contacted = rows.filter(r => OUTREACH_STATUSES.has(r.status));

  function rates(group, keyFn) {
    const buckets = {};
    for (const r of group) {
      const key = keyFn(r);
      if (!buckets[key]) buckets[key] = { sent: 0, replied: 0, calls: 0, dead: 0, rejected: 0 };
      buckets[key].sent++;
      if (['replied', 'call_booked', 'call_done', 'verbal', 'loi', 'paying'].includes(r.status)) buckets[key].replied++;
      if (['call_booked', 'call_done', 'verbal', 'loi', 'paying'].includes(r.status)) buckets[key].calls++;
      if (r.status === 'dead') buckets[key].dead++;
      if ((r.notes || '').includes('Rejected')) buckets[key].rejected++;
    }
    return buckets;
  }

  return {
    byRole: rates(contacted, r => classifyRole(r.title)),
    byType: rates(contacted, r => (r.company_type || 'unknown').toLowerCase()),
    byCountry: rates(contacted, r => r.country || 'unknown'),
    byEmpBand: rates(contacted, r => classifyEmpBand(r.employees)),
  };
}

// --- Step 2: Compute rejection pattern penalties ---
function computeRejectionPenalties(rows) {
  const penalties = {};

  for (const r of rows) {
    const tags = (r.tags || '').split(',');
    for (const tag of tags) {
      if (tag.startsWith('rej-')) {
        // Count rejections by company_type, role, country, emp band
        const role = classifyRole(r.title);
        const type = (r.company_type || 'unknown').toLowerCase();
        const country = r.country || 'unknown';
        const empBand = classifyEmpBand(r.employees);

        // Each rejection adds a small penalty to matching attributes
        penalties[`role:${role}`] = (penalties[`role:${role}`] || 0) + 1;
        penalties[`type:${type}`] = (penalties[`type:${type}`] || 0) + 1;
        penalties[`country:${country}`] = (penalties[`country:${country}`] || 0) + 1;
        penalties[`emp:${empBand}`] = (penalties[`emp:${empBand}`] || 0) + 1;
        penalties[`tag:${tag}`] = (penalties[`tag:${tag}`] || 0) + 1;
      }
    }
  }
  return penalties;
}

// --- Step 3: Score a single lead ---
function scoreLead(r, convRates, rejPenalties) {
  let score = 0;
  const breakdown = {};

  // --- A. Role score (0-30) based on conversion data ---
  const role = classifyRole(r.title);
  const roleData = convRates.byRole[role];
  if (roleData && roleData.sent >= 5) {
    // Enough data: use actual reply rate
    const replyRate = roleData.replied / roleData.sent;
    const callRate = roleData.calls / roleData.sent;
    // Weight reply 60%, call 40% — calls matter more but need replies first
    const roleScore = Math.round((replyRate * 0.6 + callRate * 0.4) * 200);
    score += Math.min(30, roleScore);
    breakdown.role = `${role}: ${Math.min(30, roleScore)} (${(replyRate * 100).toFixed(1)}% reply, ${(callRate * 100).toFixed(1)}% call, n=${roleData.sent})`;
  } else {
    // Not enough data: use seniority heuristic
    const senScore = seniorityHeuristic(r.title);
    score += Math.round(senScore * 0.3); // 0-30
    breakdown.role = `${role}: ${Math.round(senScore * 0.3)} (heuristic, n=${roleData?.sent || 0})`;
  }

  // --- B. Company type score (0-25) ---
  const type = (r.company_type || 'unknown').toLowerCase();
  const typeData = convRates.byType[type];
  if (typeData && typeData.sent >= 5) {
    const replyRate = typeData.replied / typeData.sent;
    const callRate = typeData.calls / typeData.sent;
    const typeScore = Math.round((replyRate * 0.5 + callRate * 0.5) * 200);
    score += Math.min(25, typeScore);
    breakdown.type = `${type}: ${Math.min(25, typeScore)} (${(replyRate * 100).toFixed(1)}% reply, n=${typeData.sent})`;
  } else {
    // Default: mid-range
    score += 10;
    breakdown.type = `${type}: 10 (insufficient data, n=${typeData?.sent || 0})`;
  }

  // --- C. Country score (0-18) ---
  const country = r.country || 'unknown';
  const countryData = convRates.byCountry[country];
  if (countryData && countryData.sent >= 8) {
    const replyRate = countryData.replied / countryData.sent;
    const countryScore = Math.round(replyRate * 150);
    score += Math.min(18, countryScore);
    breakdown.country = `${country}: ${Math.min(18, countryScore)} (${(replyRate * 100).toFixed(1)}% reply, n=${countryData.sent})`;
  } else {
    // Fallback: geo heuristic (English-speaking and Northern/Western Europe tend to respond faster)
    const c = country.toLowerCase();
    let geo = 4;
    if (/united kingdom|uk|netherlands|sweden|denmark|finland|norway|ireland/.test(c)) geo = 15;
    else if (/germany|austria|switzerland/.test(c)) geo = 12;
    else if (/france|united states|canada/.test(c)) geo = 10;
    else if (/spain|italy|portugal|belgium|poland/.test(c)) geo = 6;
    score += geo;
    breakdown.country = `${country}: ${geo} (heuristic, n=${countryData?.sent || 0})`;
  }

  // --- D. Employee band score (0-15) ---
  const empBand = classifyEmpBand(r.employees);
  const empData = convRates.byEmpBand[empBand];
  if (empData && empData.sent >= 5) {
    const replyRate = empData.replied / empData.sent;
    const empScore = Math.round(replyRate * 150);
    score += Math.min(15, empScore);
    breakdown.emp = `${empBand}: ${Math.min(15, empScore)} (${(replyRate * 100).toFixed(1)}% reply, n=${empData.sent})`;
  } else {
    // Heuristic: 51-100 sweet spot
    const n = parseInt(r.employees || '0') || 0;
    let emp = 5;
    if (n >= 51 && n <= 100) emp = 12;
    else if (n >= 30 && n <= 200) emp = 9;
    else if (n > 200 && n <= 500) emp = 7;
    score += emp;
    breakdown.emp = `${empBand}: ${emp} (heuristic)`;
  }

  // --- E. Rejection pattern penalties ---
  let penalty = 0;
  const rolePen = rejPenalties[`role:${role}`] || 0;
  const typePen = rejPenalties[`type:${type}`] || 0;
  const countryPen = rejPenalties[`country:${country}`] || 0;
  const empPen = rejPenalties[`emp:${empBand}`] || 0;
  // Each rejection in the same bucket costs -2 (capped at -15)
  penalty = Math.min(15, (rolePen + typePen + countryPen + empPen) * 2);
  score -= penalty;
  if (penalty > 0) breakdown.penalty = `-${penalty} (role:${rolePen} type:${typePen} country:${countryPen} emp:${empPen})`;

  // Clamp
  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, breakdown };
}

function seniorityHeuristic(title) {
  const t = (title || '').toLowerCase();
  if (/founder|ceo|chief executive/.test(t)) return 100;
  if (/\bc[ts]o\b|chief technology|chief security/.test(t)) return 90;
  if (/\bcoo\b|chief operating/.test(t)) return 85;
  if (/\bvp\s/.test(t)) return 80;
  if (/head of/.test(t)) return 75;
  if (/director/.test(t)) return 65;
  if (/lead|principal|senior/.test(t)) return 55;
  if (/manager/.test(t)) return 45;
  return 30;
}

// --- Main ---
function recalcPriority(opts = {}) {
  const { dryRun: dryRunOpt = false } = opts;
  const isDry = dryRun || dryRunOpt;

  const rows = load();
  const convRates = computeConversionRates(rows);
  const rejPenalties = computeRejectionPenalties(rows);

  if (explain) {
    console.log('=== Conversion Rates (from outreach data) ===\n');

    console.log('By Role:');
    for (const [role, d] of Object.entries(convRates.byRole).sort((a, b) => b[1].sent - a[1].sent)) {
      const rr = d.sent > 0 ? (d.replied / d.sent * 100).toFixed(1) : '—';
      const cr = d.sent > 0 ? (d.calls / d.sent * 100).toFixed(1) : '—';
      console.log(`  ${role.padEnd(20)} sent:${String(d.sent).padStart(4)} reply:${rr.padStart(5)}% call:${cr.padStart(5)}%`);
    }

    console.log('\nBy Company Type:');
    for (const [type, d] of Object.entries(convRates.byType).sort((a, b) => b[1].sent - a[1].sent)) {
      const rr = d.sent > 0 ? (d.replied / d.sent * 100).toFixed(1) : '—';
      const cr = d.sent > 0 ? (d.calls / d.sent * 100).toFixed(1) : '—';
      console.log(`  ${type.padEnd(20)} sent:${String(d.sent).padStart(4)} reply:${rr.padStart(5)}% call:${cr.padStart(5)}%`);
    }

    console.log('\nBy Country (top 10):');
    for (const [country, d] of Object.entries(convRates.byCountry).sort((a, b) => b[1].sent - a[1].sent).slice(0, 10)) {
      const rr = d.sent > 0 ? (d.replied / d.sent * 100).toFixed(1) : '—';
      console.log(`  ${country.padEnd(20)} sent:${String(d.sent).padStart(4)} reply:${rr.padStart(5)}%`);
    }

    console.log('\nBy Employee Band:');
    for (const [band, d] of Object.entries(convRates.byEmpBand).sort((a, b) => b[1].sent - a[1].sent)) {
      const rr = d.sent > 0 ? (d.replied / d.sent * 100).toFixed(1) : '—';
      console.log(`  ${band.padEnd(20)} sent:${String(d.sent).padStart(4)} reply:${rr.padStart(5)}%`);
    }

    console.log('\nRejection Penalties:');
    if (Object.keys(rejPenalties).length === 0) {
      console.log('  (none yet — penalties accumulate as you reject leads in blitz docs)');
    } else {
      for (const [key, count] of Object.entries(rejPenalties).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${key.padEnd(30)} rejections:${count} → -${count * 2} priority`);
      }
    }
    return;
  }

  // Recalculate priorities for unsent leads
  const unsent = rows.filter(r => r.status === 'new');
  console.log(`Recalculating priorities for ${unsent.length} unsent leads...`);

  let changed = 0;
  const deltas = [];
  const sampleUp = [];
  const sampleDown = [];

  for (const r of unsent) {
    const { score, breakdown } = scoreLead(r, convRates, rejPenalties);
    const oldPriority = parseInt(r.priority || '0') || 0;
    const delta = score - oldPriority;

    if (score !== oldPriority) {
      changed++;
      deltas.push(delta);
      if (delta >= 10 && sampleUp.length < 5) {
        sampleUp.push({ name: `${r.first_name} ${r.last_name}`, company: r.company, old: oldPriority, new: score, breakdown });
      }
      if (delta <= -10 && sampleDown.length < 5) {
        sampleDown.push({ name: `${r.first_name} ${r.last_name}`, company: r.company, old: oldPriority, new: score, breakdown });
      }
      if (!isDry) {
        r.priority = String(score);
      }
    }
  }

  if (!isDry && changed > 0) {
    save(rows);
  }

  // Report
  const avgDelta = deltas.length > 0 ? (deltas.reduce((s, d) => s + d, 0) / deltas.length).toFixed(1) : 0;
  const maxUp = deltas.length > 0 ? Math.max(...deltas) : 0;
  const maxDown = deltas.length > 0 ? Math.min(...deltas) : 0;

  console.log(`\n=== Priority Recalculation ${isDry ? '(DRY RUN)' : ''} ===`);
  console.log(`Unsent leads: ${unsent.length}`);
  console.log(`Changed:      ${changed} (${(changed / unsent.length * 100).toFixed(1)}%)`);
  console.log(`Avg delta:    ${avgDelta > 0 ? '+' : ''}${avgDelta}`);
  console.log(`Max increase: +${maxUp}`);
  console.log(`Max decrease: ${maxDown}`);

  if (sampleUp.length > 0) {
    console.log('\nBiggest upgrades:');
    for (const s of sampleUp) {
      console.log(`  ${s.name} (${s.company}): p${s.old} → p${s.new} (+${s.new - s.old})`);
      for (const [k, v] of Object.entries(s.breakdown)) {
        console.log(`    ${k}: ${v}`);
      }
    }
  }

  if (sampleDown.length > 0) {
    console.log('\nBiggest downgrades:');
    for (const s of sampleDown) {
      console.log(`  ${s.name} (${s.company}): p${s.old} → p${s.new} (${s.new - s.old})`);
      for (const [k, v] of Object.entries(s.breakdown)) {
        console.log(`    ${k}: ${v}`);
      }
    }
  }

  // Distribution
  const buckets = { '0-20': 0, '21-40': 0, '41-60': 0, '61-80': 0, '81-100': 0 };
  for (const r of unsent) {
    const p = parseInt(r.priority || '0') || 0;
    if (p <= 20) buckets['0-20']++;
    else if (p <= 40) buckets['21-40']++;
    else if (p <= 60) buckets['41-60']++;
    else if (p <= 80) buckets['61-80']++;
    else buckets['81-100']++;
  }
  console.log('\nPriority distribution (unsent):');
  for (const [band, count] of Object.entries(buckets)) {
    const bar = '█'.repeat(Math.round(count / unsent.length * 40));
    console.log(`  p${band.padEnd(6)} ${String(count).padStart(5)} ${bar}`);
  }

  if (isDry) {
    console.log('\n(dry run — no changes written. Remove --dry-run to apply.)');
  } else if (changed > 0) {
    console.log(`\n✅ ${changed} priorities updated in leads.csv`);
    // Sync metrics after updating priorities
    try {
      const { syncMetrics } = require('./sync-metrics');
      syncMetrics({ quiet: true });
    } catch (e) { /* ignore */ }
  } else {
    console.log('\n✅ All priorities already optimal — no changes needed.');
  }
}

// CLI entry point
if (require.main === module) {
  recalcPriority();
}

module.exports = { recalcPriority };
