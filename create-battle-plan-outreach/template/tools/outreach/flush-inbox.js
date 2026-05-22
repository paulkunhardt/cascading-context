#!/usr/bin/env node
// Reads outreach/inbox/manual.txt (or any *.txt in inbox/), one URL per line.
// For each LinkedIn URL, adds it to leads.csv as source=manual_dm, status=new.
// Does NOT enrich (no API calls). The user fills in details later or daily-targets uses what's there.
// If you want enrichment, run the linkedin-enricher pipeline manually on the appended rows.

const fs = require('fs');
const path = require('path');
const { load, save, upsert } = require('./lib/leads');

const INBOX = path.resolve(__dirname, '../../outreach/inbox');

function urlToLead(url) {
  const slug = url.match(/\/in\/([^\/?#]+)/)?.[1] || url;
  return {
    linkedin_url: url.replace(/\/$/, ''),
    first_name: '',
    last_name: '',
    title: '',
    company: '',
    domain: '',
    industry: '',
    employees: '',
    country: '',
    source: 'manual_dm',
    tags: 'manual-paste',
    status: 'new',
    priority: '50', // medium default
    contacted_at: '',
    replied_at: '',
    notes: `Pasted via inbox ${new Date().toISOString().slice(0, 10)}. Slug: ${slug}`,
  };
}

function main() {
  if (!fs.existsSync(INBOX)) { console.error('No inbox dir'); process.exit(1); }
  const files = fs.readdirSync(INBOX).filter(n => n.endsWith('.txt'));
  if (!files.length) { console.log('No .txt files in inbox/'); return; }

  const rows = load();
  let inserted = 0, skipped = 0;
  const processed = [];

  for (const f of files) {
    const fp = path.join(INBOX, f);
    const lines = fs.readFileSync(fp, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (!line.includes('linkedin.com/')) continue;
      const url = line.match(/(https?:\/\/[^\s]+)/)?.[1];
      if (!url) continue;
      const lead = urlToLead(url);
      const result = upsert(rows, lead, { overwrite: false });
      if (result.action === 'inserted') inserted++;
      else skipped++;
    }
    processed.push(f);
  }
  save(rows);

  // Move processed files to archive
  const ARCHIVE = path.resolve(__dirname, '../../outreach/archive');
  if (!fs.existsSync(ARCHIVE)) fs.mkdirSync(ARCHIVE, { recursive: true });
  for (const f of processed) {
    const stamp = new Date().toISOString().slice(0, 10);
    fs.renameSync(path.join(INBOX, f), path.join(ARCHIVE, `${stamp}-${f}`));
  }

  console.log(`✓ flush-inbox: inserted=${inserted} skipped=${skipped} (already in CRM)`);
  console.log(`  Archived ${processed.length} file(s)`);
}

main();
