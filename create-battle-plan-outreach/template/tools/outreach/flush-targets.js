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
      // Line: "| x | [Name](url) | meta | 100 | B |   |"
      // split('|') → ['', ' x ', ' [Name](url) ', ' meta ', ' 100 ', ' B ', '   ', '']
      // Drop first and last empty strings from leading/trailing pipes
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
      const rej = rejCell.toLowerCase() === 'x';

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
        rejected.push({ name, company, url });
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

      // Extract emp and rev from inline markers
      const empMatch = line.match(/emp:(\d+)/);
      const revMatch = line.match(/rev:([^\s·]+)/);
      const employees = empMatch ? empMatch[1] : '';
      const revenue = revMatch && revMatch[1] !== '' ? revMatch[1] : '';

      // Look ahead for reject checkbox
      let rejectChecked = false;
      let rejectReason = '';
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (lines[j].match(/^- \[/)) break;
        const rej = lines[j].match(/^\s+- \[([xX])\]\s+reject(?::\s*(.+))?/i);
        if (rej) {
          rejectChecked = true;
          rejectReason = rej[2] ? rej[2].trim() : '';
        }
      }

      if (rejectChecked) {
        rejected.push({ name, company, url, reason: rejectReason });
      } else if (parentChecked) {
        checked.push({ name, company, url, template, title, country, employees, revenue, isFollowup, isInmail });
      }
    }
  }
  return { checked, rejected };
}

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

function appendBattlePlanLog(count, leads) {
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
  const note = [
    '',
    `> **[outreach flush ${new Date().toTimeString().slice(0, 5)}]** Sent ${count} DMs via blitz checklist. Sample: ${sample}${leads.length > 5 ? `, +${leads.length - 5} more` : ''}.`,
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

  // Process sent leads
  const matched = [];
  const followedUp = [];
  const inmailed = [];
  const unmatched = [];
  for (const item of checked) {
    const lead = findLead(rows, item);
    if (!lead) { unmatched.push(item); continue; }
    if (item.isFollowup) {
      // Follow-up: update followed_up_at, don't change status
      lead.followed_up_at = today;
      lead.notes = `Follow-up sent ${today} | ${lead.notes || ''}`.replace(/\| $/, '');
      followedUp.push(lead);
    } else if (item.isInmail) {
      // InMail: mark channel as inmail, update template if provided
      lead.channel = 'inmail';
      lead.notes = `InMail sent ${today} | ${lead.notes || ''}`.replace(/\| $/, '');
      if (item.template) lead.template = item.template;
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
      matched.push(lead);
    } else {
      // Already past new, no-op but record
      matched.push(lead);
    }
  }

  // Process rejected leads — mark as dead with note
  const rejectedMatched = [];
  for (const item of rejected) {
    const lead = findLead(rows, item);
    if (!lead) continue;
    if (lead.status === 'new') {
      lead.status = 'dead';
      const rejTag = classifyRejection(item.reason);
      const tags = (lead.tags || '').split(',').filter(Boolean);
      if (!tags.includes(rejTag)) tags.push(rejTag);
      lead.tags = tags.join(',');
      lead.notes = `Rejected ${today}${item.reason ? ': ' + item.reason : ''} | ${lead.notes || ''}`.replace(/\| $/, '');
      rejectedMatched.push(lead);
    }
  }

  save(rows);

  // Update template stats from full CSV (recount from source of truth)
  updateTemplateStats(rows);

  const newDms = matched.filter(l => l.contacted_at === today).length;
  appendBattlePlanLog(newDms, matched);

  // Derive all metrics from CSV (single source of truth)
  syncMetrics();

  // Archive the file
  if (!fs.existsSync(ARCHIVE)) fs.mkdirSync(ARCHIVE, { recursive: true });
  const archived = path.join(ARCHIVE, path.basename(file));
  fs.renameSync(file, archived);

  console.log(`\n✓ Flushed ${newDms} DMs (${matched.length} checked, ${matched.length - newDms} already past new)`);
  if (followedUp.length) console.log(`  🔄 Followed up on ${followedUp.length} accepted leads (followed_up_at → ${today})`);
  if (inmailed.length) console.log(`  📧 InMailed ${inmailed.length} leads (channel → inmail)`);
  if (rejectedMatched.length) console.log(`  ❌ Rejected ${rejectedMatched.length} leads (marked dead)`);
  console.log(`  Archived → ${path.relative(ROOT, archived)}`);
  if (unmatched.length) {
    console.log(`\n⚠️  ${unmatched.length} checked items did not match any lead:`);
    unmatched.forEach(u => console.log(`  - ${u.name} (${u.company})`));
  }
}

main();
