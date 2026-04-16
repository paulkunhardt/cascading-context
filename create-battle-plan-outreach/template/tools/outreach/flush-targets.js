#!/usr/bin/env node
// Reads today's checklist, finds checked boxes, marks those leads as dm_sent.
// Updates: leads.csv, metrics.yml#outreach_sent, battle plan day log.
// Then archives the checklist file.

const fs = require('fs');
const path = require('path');
const { load, save, normKey } = require('./lib/leads');
const { syncMetrics } = require('./sync-metrics');

const ROOT = path.resolve(__dirname, '../..');
const today = new Date().toISOString().slice(0, 10);
const INBOX = path.join(ROOT, 'outreach/inbox');
const ARCHIVE = path.join(ROOT, 'outreach/archive');
const BATTLE = path.join(ROOT, 'docs/battle-plan.md');
const TEMPLATES_PATH = path.resolve(__dirname, 'templates.json');

function classifyRejection(reason) {
  if (!reason) return 'rej-manual';
  const r = reason.toLowerCase();
  if (/revenue|too small|tiny|size/.test(r)) return 'rej-revenue';
  if (/role|title|wrong person|not decision/.test(r)) return 'rej-role';
  if (/employee|headcount|too few|too many/.test(r)) return 'rej-company-size';
  if (/not icp|wrong fit|irrelevant|not target/.test(r)) return 'rej-not-icp';
  if (/competitor|vendor|sells to us/.test(r)) return 'rej-competitor';
  return 'rej-manual';
}

function findTodayFile() {
  const f = path.join(INBOX, `${today}.md`);
  if (fs.existsSync(f)) return f;
  // Fallback: most recent YYYY-MM-DD.md (also check legacy today-*.md)
  const files = fs.readdirSync(INBOX).filter(n => /^\d{4}-\d{2}-\d{2}\.md$/.test(n) || n.startsWith('today-')).sort().reverse();
  return files.length ? path.join(INBOX, files[0]) : null;
}

function parseChecked(md) {
  const checked = [];
  const rejected = [];

  // Detect format: table or legacy list
  const isTable = md.includes('| ✓ |') || md.includes('| Tpl |');

  if (isTable) {
    // Table format:
    // | ✓ | Lead | Role · Company · Country | p | Tpl | ✗ |
    // |---|------|--------------------------|---|-----|---|
    // | x | [Name](url) | Title · Company · Country | 100 | B |   |
    const lines = md.split('\n');
    let inLeadTable = false;
    for (const line of lines) {
      // Detect start of a lead table (has ✓ header)
      if (line.includes('| ✓ |')) { inLeadTable = true; continue; }
      // Detect end of table (non-table line after we started)
      if (inLeadTable && !line.startsWith('|')) { inLeadTable = false; continue; }
      // Skip if not in a lead table, or separator row
      if (!inLeadTable || !line.startsWith('|') || line.match(/^\|\s*-/)) continue;
      // Split on | but keep empty cells (don't filter(Boolean))
      const raw = line.split('|');
      const cells = raw.slice(1, raw.length - 1).map(c => c.trim());
      if (cells.length < 6) continue;

      const sent = cells[0].toLowerCase() === 'x';
      const leadCell = cells[1];
      const metaCell = cells[2];

      // Detect column layout: 6 cols (old) vs 8 cols (new with Emp/Rev)
      let employees = '', revenue = '', template = '', rejCell = '';
      if (cells.length >= 8) {
        // New: ✓ | Lead | Meta | Emp | Rev | p | Tpl | ✗
        employees = cells[3] || '';
        revenue = cells[4] || '';
        template = cells[6] || '';
        rejCell = cells[7] || '';
      } else {
        // Old: ✓ | Lead | Meta | p | Tpl | ✗
        template = cells[4] || '';
        rejCell = cells[5] || '';
      }
      // Reject cell: "x" for bare reject, or "x: reason text" for rejection with reason
      const rejMatch = rejCell.match(/^x(?::\s*(.+))?$/i);
      const rej = !!rejMatch;
      const rejReason = rej ? (rejMatch[1] || '').trim() : '';

      // Extract name and URL from lead cell: [Name](url) or just Name
      let name = '', url = '';
      const linkMatch = leadCell.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        name = linkMatch[1].trim();
        url = linkMatch[2].replace(/\/$/, '').trim();
      } else {
        name = leadCell.replace(/\*\*/g, '').trim();
      }

      // Extract company from meta cell (second segment after first ·)
      const metaParts = metaCell.split('·').map(s => s.trim());
      const company = metaParts.length >= 2 ? metaParts[1].replace(/_\[.*\]_/, '').trim() : '';

      if (rej) {
        rejected.push({ name, company, url, reason: rejReason });
      } else if (sent) {
        checked.push({ name, company, url, template, employees, revenue });
      }
    }
  } else {
    // List format: - [ ] `B` [Name](url) · Title · Company · Country · emp:100 · rev:2.5M · p100
    //          or: - [ ] 🔄 [Name](url) · Title · Company · Country · last touch: 2026-04-10 (4d ago)
    //                - [ ] reject
    const lines = md.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match withdrawal format: - [x] 🗑️ [Name](url) · Title · Company · Country · emp:X · rev:Y · type:Z · sent: 2026-03-31 (15d, tier 3) · pN
      const withdrawMatch = line.match(/^- \[([xX ])\]\s+🗑️\s+/);
      if (withdrawMatch) {
        const isChecked = withdrawMatch[1].toLowerCase() === 'x';
        // Extract name and URL
        let name = '', url = '';
        const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) { name = linkMatch[1].trim(); url = linkMatch[2].replace(/\/$/, '').trim(); }
        else { const boldMatch = line.match(/\*\*([^*]+)\*\*/); if (boldMatch) name = boldMatch[1].trim(); }
        // Extract segments: after "🗑️ " or "🗑️ [Name](url) · "
        const afterIcon = line.replace(/^- \[[xX ]\]\s+🗑️\s+/, '');
        const segments = afterIcon.split('·').map(s => s.trim());
        // segments[0] = name link; [1] = title; [2] = company; [3] = country; rest = emp/rev/type/sent/p
        const title = segments[1] || '';
        let company = segments[2] || '';
        const country = (segments[3] || '').replace(/emp:.*/, '').trim();
        // Extract editable metadata from inline markers (can appear anywhere on line)
        const empMatch = line.match(/emp:(\d+)/);
        const revMatch = line.match(/rev:([^\s·]+)/);
        const typeMatch = line.match(/type:([^\s·]+)/);
        const employees = empMatch ? empMatch[1] : '';
        const revenue = revMatch && revMatch[1] !== '' ? revMatch[1] : '';
        const company_type = typeMatch && typeMatch[1] !== '' ? typeMatch[1] : '';
        // Tier and age
        const tierMatch = line.match(/\((\d+)d,\s*tier\s+(\d+)\)/);
        const age = tierMatch ? parseInt(tierMatch[1]) : 0;
        const tier = tierMatch ? parseInt(tierMatch[2]) : 0;
        // Look ahead for inmail-instead checkbox (replaces the old reject checkbox)
        let inmailInstead = false;
        let inmailTemplate = '';
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          if (lines[j].match(/^- \[/)) break;
          // - [x] 📧 `B` inmail instead (last shot)
          const im = lines[j].match(/^\s+- \[([xX])\]\s+📧\s+`([^`]+)`\s+inmail\s+instead/i);
          if (im) { inmailInstead = true; inmailTemplate = im[2].trim(); }
        }
        if (inmailInstead) {
          // Override: don't withdraw, mark as InMail sent today instead
          checked.push({ name, company, url, template: inmailTemplate, title, country, employees, revenue, company_type, isInmail: true, isWithdrawalOverride: true });
        } else if (isChecked) {
          // Normal withdrawal — still honor any inline metadata corrections
          checked.push({ name, company, url, isWithdrawal: true, withdrawAge: age, withdrawTier: tier, title, country, employees, revenue, company_type });
        } else {
          // Main unchecked and no inmail → keep as-is, but still apply metadata corrections if present
          // (Someone may have fixed type:consulting → type:b2b-saas and wants the data corrected even without acting today.)
          if (title || country || employees || revenue || company_type) {
            checked.push({ name, company, url, isMetadataOnly: true, title, country, employees, revenue, company_type });
          }
        }
        continue;
      }
      // Match follow-up format: - [x] 🔄 [Name](url) · ...
      const followupMatch = line.match(/^- \[([xX ])\]\s+🔄\s+/);
      // Match InMail format: - [x] 📧 `B` [Name](url) · ...
      const inmailMatch = !followupMatch && line.match(/^- \[([xX ])\]\s+📧\s+`([^`]+)`\s+/);
      // Match new DM format: - [x] `B` [Name](url) · ...
      const m = followupMatch || inmailMatch || line.match(/^- \[([xX ])\]\s+`([^`]+)`\s+/);
      if (!m) continue;
      const parentChecked = m[1].toLowerCase() === 'x';
      const isFollowup = !!followupMatch;
      const isInmail = !!inmailMatch;
      const template = (isFollowup) ? '' : (m[2] || '').trim();

      // Extract name and URL
      let name = '', url = '';
      const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        name = linkMatch[1].trim();
        url = linkMatch[2].replace(/\/$/, '').trim();
      } else {
        const boldMatch = line.match(/\*\*([^*]+)\*\*/);
        if (boldMatch) name = boldMatch[1].trim();
      }

      // Extract title, company, country from segments: Name · Title · Company · Country · emp:X · rev:Y · pN
      const afterTemplate = line.replace(/^- \[[xX ]\]\s+`[^`]+`\s+/, '');
      const segments = afterTemplate.split('·').map(s => s.trim());
      let segStart = 0;
      if (segments[0] && (segments[0].includes('[') || segments[0].includes('**'))) segStart = 1;
      const title = segments.length > segStart ? segments[segStart].trim() : '';
      let company = segments.length > segStart + 1 ? segments[segStart + 1].trim() : '';
      const country = segments.length > segStart + 2 ? segments[segStart + 2].replace(/emp:.*/, '').trim() : '';

      // Extract emp, rev, and type from inline markers
      const empMatch = line.match(/emp:(\d+)/);
      const revMatch = line.match(/rev:([^\s·]+)/);
      const typeMatch = line.match(/type:([^\s·]+)/);
      const employees = empMatch ? empMatch[1] : '';
      const revenue = revMatch && revMatch[1] !== '' ? revMatch[1] : '';
      const company_type = typeMatch && typeMatch[1] !== '' ? typeMatch[1] : '';

      // Look ahead for reject + withdraw-now sub-checkboxes
      // Precedence: reject > withdraw-now > parent (send).
      let rejectChecked = false;
      let rejectReason = '';
      let withdrawNowChecked = false;
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        if (lines[j].match(/^- \[/)) break;
        const rej = lines[j].match(/^\s+- \[([xX])\]\s+reject(?::\s*(.+))?/i);
        if (rej) { rejectChecked = true; rejectReason = (rej[2] || '').trim(); }
        const wd = lines[j].match(/^\s+- \[([xX])\]\s+🗑️\s+withdraw\s+connection/i);
        if (wd) { withdrawNowChecked = true; }
      }

      if (rejectChecked) {
        rejected.push({ name, company, url, reason: rejectReason });
      } else if (withdrawNowChecked) {
        checked.push({ name, company, url, isWithdrawal: true, withdrawAge: 0, withdrawTier: 0, title, country, employees, revenue, company_type, isManualWithdraw: true });
      } else if (parentChecked) {
        checked.push({ name, company, url, template, title, country, employees, revenue, company_type, isFollowup, isInmail });
      }
    }
  }
  return { checked, rejected };
}

function findLead(rows, item) {
  if (item.url) {
    const found = rows.find(r => (r.linkedin_url || '').replace(/\/$/, '').toLowerCase() === item.url.toLowerCase());
    if (found) return found;
  }
  // Fallback: name + company
  const nameLower = item.name.toLowerCase();
  return rows.find(r => {
    const n = `${r.first_name} ${r.last_name}`.trim().toLowerCase();
    return n === nameLower && (r.company || '').toLowerCase() === item.company.toLowerCase();
  });
}

// Metrics are now derived by sync-metrics.js — no manual bumping needed

function appendBattlePlanLog(count, leads, withdrawnCount = 0) {
  const text = fs.readFileSync(BATTLE, 'utf8');
  // Find today's day section. Format: "## Day N — YYYY-MM-DD" or similar.
  const lines = text.split('\n');
  // Find the most recent line with today's date in a header
  let insertIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ') && lines[i].includes(today)) {
      // Insert at end of this section (next ## or end of file)
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith('## ') && j > i) { insertIdx = j; break; }
      }
      if (insertIdx === -1) insertIdx = lines.length;
      break;
    }
  }
  if (insertIdx === -1) {
    console.warn('No section for today found in battle plan; skipping log append');
    return false;
  }
  const sample = leads.slice(0, 5).map(l => `${l.first_name} ${l.last_name} (${l.company})`).join(', ');
  const withdrawNote = withdrawnCount > 0 ? ` Withdrew ${withdrawnCount} stale invitations.` : '';
  const note = [
    '',
    `> **[outreach flush ${new Date().toTimeString().slice(0, 5)}]** Sent ${count} DMs via blitz checklist.${withdrawNote} Sample: ${sample}${leads.length > 5 ? `, +${leads.length - 5} more` : ''}.`,
    '',
  ];
  lines.splice(insertIdx, 0, ...note);
  fs.writeFileSync(BATTLE, lines.join('\n'));
  return true;
}

function updateTemplateStats(rows) {
  // Recount template stats from leads.csv (source of truth)
  let templates = {};
  if (fs.existsSync(TEMPLATES_PATH)) {
    templates = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
  }
  // Reset sent/replies counts, preserve text
  for (const id of Object.keys(templates)) {
    // Skip config keys (non-template entries)
    if (!templates[id] || typeof templates[id] !== 'object') continue;
    if (typeof templates[id].text !== 'string') continue;
    templates[id].sent = 0;
    templates[id].replies = 0;
    templates[id].calls = 0;
  }
  // Count from CSV
  for (const r of rows) {
    const tpl = r.template;
    if (!tpl) continue;
    if (!templates[tpl]) {
      templates[tpl] = { text: '(unknown — add text to templates.json)', sent: 0, replies: 0, calls: 0 };
    }
    // Anyone with a template who's past 'new' was sent
    if (r.status !== 'new') templates[tpl].sent++;
    // Replied or beyond = a response
    if (['replied', 'call_booked', 'call_done', 'verbal', 'loi', 'paying'].includes(r.status)) {
      templates[tpl].replies++;
    }
    // Call or beyond
    if (['call_booked', 'call_done', 'verbal', 'loi', 'paying'].includes(r.status)) {
      templates[tpl].calls++;
    }
  }
  fs.writeFileSync(TEMPLATES_PATH, JSON.stringify(templates, null, 2));
}

function main() {
  const file = findTodayFile();
  if (!file) {
    console.error('No checklist file found in outreach/inbox/');
    process.exit(1);
  }
  const md = fs.readFileSync(file, 'utf8');
  const { checked, rejected } = parseChecked(md);
  if (!checked.length && !rejected.length) {
    console.log('No checked or rejected boxes found. Use [x] to send, [-] to reject in', file);
    process.exit(0);
  }

  const rows = load();

  // Helper: apply inline metadata corrections to a lead row and log what changed
  function applyMetadataEdits(lead, item) {
    const changes = [];
    if (item.title && item.title !== lead.title) { changes.push(`title`); lead.title = item.title; }
    if (item.country && item.country !== lead.country) { changes.push(`country`); lead.country = item.country; }
    if (item.employees && item.employees !== lead.employees) { changes.push(`emp`); lead.employees = item.employees; }
    if (item.revenue && item.revenue !== lead.revenue) { changes.push(`rev`); lead.revenue = item.revenue; }
    if (item.company_type && item.company_type !== lead.company_type) { changes.push(`type:${lead.company_type}→${item.company_type}`); lead.company_type = item.company_type; }
    return changes;
  }

  // Process withdrawals first (separate from sent tally)
  const withdrawn = [];
  const withdrawUnmatched = [];
  const metadataOnly = [];
  const nonWithdrawalChecked = [];
  for (const item of checked) {
    if (item.isWithdrawal) {
      const lead = findLead(rows, item);
      if (!lead) { withdrawUnmatched.push(item); continue; }
      const mdChanges = applyMetadataEdits(lead, item);
      lead.status = 'withdrawn';
      const mdNote = mdChanges.length ? ` [corrected ${mdChanges.join(',')}]` : '';
      const reason = item.isManualWithdraw
        ? `manual withdraw during pipeline review`
        : `stale ${item.withdrawAge}d, tier ${item.withdrawTier}`;
      lead.notes = `Withdrawn ${today} (${reason})${mdNote} | ${lead.notes || ''}`.replace(/\| $/, '');
      withdrawn.push(lead);
    } else if (item.isMetadataOnly) {
      const lead = findLead(rows, item);
      if (!lead) continue;
      const mdChanges = applyMetadataEdits(lead, item);
      if (mdChanges.length) {
        lead.notes = `Metadata corrected ${today}: ${mdChanges.join(', ')} | ${lead.notes || ''}`.replace(/\| $/, '');
        metadataOnly.push(lead);
      }
    } else {
      nonWithdrawalChecked.push(item);
    }
  }

  // Process sent leads
  const matched = [];
  const followedUp = [];
  const inmailed = [];
  const unmatched = [];
  for (const item of nonWithdrawalChecked) {
    const lead = findLead(rows, item);
    if (!lead) { unmatched.push(item); continue; }
    if (item.isFollowup) {
      // Follow-up: update followed_up_at, don't change status
      lead.followed_up_at = today;
      lead.notes = `Follow-up sent ${today} | ${lead.notes || ''}`.replace(/\| $/, '');
      if (item.company_type && item.company_type !== lead.company_type) lead.company_type = item.company_type;
      followedUp.push(lead);
    } else if (item.isInmail) {
      // InMail: mark channel as inmail, stamp followed_up_at so the 3-day
      // recent-touch buffer protects this lead from premature withdrawal.
      // Dual-template model: InMail template goes to `inmail_template`, NEVER
      // overwrites `template` (which tracks the original connection template).
      // This preserves proper attribution when a user switches B→C for an InMail.
      lead.channel = 'inmail';
      lead.followed_up_at = today;
      const wasOverride = item.isWithdrawalOverride;
      const prefix = wasOverride ? `InMail sent ${today} (last-shot override of withdraw)` : `InMail sent ${today}`;
      lead.notes = `${prefix} | ${lead.notes || ''}`.replace(/\| $/, '');
      if (item.template) lead.inmail_template = item.template;
      applyMetadataEdits(lead, item);
      inmailed.push(lead);
    } else if (lead.status === 'new') {
      lead.status = 'dm_sent';
      lead.contacted_at = today;
      // Sync back ALL edits from the blitz sheet — what gets flushed is the new truth
      if (item.template) lead.template = item.template;
      if (item.title && item.title !== lead.title) lead.title = item.title;
      if (item.company && item.company !== lead.company) lead.company = item.company;
      if (item.country && item.country !== lead.country) lead.country = item.country;
      if (item.employees && item.employees !== lead.employees) lead.employees = item.employees;
      if (item.revenue) lead.revenue = item.revenue;
      if (item.company_type && item.company_type !== lead.company_type) lead.company_type = item.company_type;
      matched.push(lead);
    } else {
      // Already past new, no-op but record
      matched.push(lead);
    }
  }

  // Process rejected leads — mark as dead with note and reason tag
  const rejectedMatched = [];
  for (const item of rejected) {
    const lead = findLead(rows, item);
    if (!lead) continue;
    if (lead.status === 'new') {
      lead.status = 'dead';
      const reason = item.reason || '';
      if (reason) {
        lead.notes = `Rejected ${today}: ${reason} | ${lead.notes || ''}`.replace(/\| $/, '');
        const reasonTag = classifyRejection(reason);
        const tags = (lead.tags || '').split(',').filter(Boolean);
        if (!tags.includes(reasonTag)) tags.push(reasonTag);
        lead.tags = tags.join(',');
      } else {
        lead.notes = `Rejected in blitz ${today} — not ICP on manual review | ${lead.notes || ''}`.replace(/\| $/, '');
        const tags = (lead.tags || '').split(',').filter(Boolean);
        if (!tags.includes('rej-manual')) tags.push('rej-manual');
        lead.tags = tags.join(',');
      }
      rejectedMatched.push(lead);
    }
  }

  save(rows);

  // Update template stats from full CSV (recount from source of truth)
  updateTemplateStats(rows);

  const newDms = matched.filter(l => l.contacted_at === today).length;
  appendBattlePlanLog(newDms, matched, withdrawn.length);

  // Derive all metrics from CSV (single source of truth)
  syncMetrics();

  // Archive the file
  if (!fs.existsSync(ARCHIVE)) fs.mkdirSync(ARCHIVE, { recursive: true });
  const archived = path.join(ARCHIVE, path.basename(file));
  fs.renameSync(file, archived);

  console.log(`\n✓ Flushed ${newDms} DMs (${matched.length} checked, ${matched.length - newDms} already past new)`);
  if (withdrawn.length) console.log(`  🗑️ Withdrew ${withdrawn.length} stale invitations`);
  if (followedUp.length) console.log(`  🔄 Followed up on ${followedUp.length} accepted leads (followed_up_at → ${today})`);
  if (inmailed.length) console.log(`  📧 InMailed ${inmailed.length} leads (channel → inmail, followed_up_at → ${today})`);
  if (metadataOnly.length) console.log(`  ✏️  Corrected metadata on ${metadataOnly.length} leads (kept pending)`);
  if (rejectedMatched.length) console.log(`  ❌ Rejected ${rejectedMatched.length} leads (marked dead)`);
  console.log(`  Archived → ${path.relative(ROOT, archived)}`);
  const allUnmatched = [...unmatched, ...withdrawUnmatched];
  if (allUnmatched.length) {
    console.log(`\n⚠️  ${allUnmatched.length} checked items did not match any lead:`);
    allUnmatched.forEach(u => console.log(`  - ${u.name} (${u.company})`));
  }
}

main();
