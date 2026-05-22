#!/usr/bin/env node
// The "dropbox" UX — paste free-form updates into outreach/inbox/updates.md,
// run this, and Haiku parses each line into structured changes to leads.csv.
//
// Usage:
//   1. Edit outreach/inbox/updates.md (or create it)
//   2. Write one update per line (or bullet), e.g.:
//      - Ernst Dolce replied, call booked today 16:30, email ernst.dolce@banqora.com
//      - Manouk from Langwatch finally responded, asking for a call next week
//      - NEW: https://linkedin.com/in/somebody — cold DM sent today, source=manual_dm
//      - Kariz = dead, not interested
//   3. node tools/outreach/flush-updates.js
//
// Cost: ~€0.0001 per update (Haiku). Free for zero updates.

const fs = require('fs');
const path = require('path');
const { load, save, upsert } = require('./lib/leads');
const { syncMetrics } = require('./sync-metrics');

const ROOT = path.resolve(__dirname, '../..');
const UPDATES_PATH = path.join(ROOT, 'outreach/inbox/updates.md');
const ARCHIVE = path.join(ROOT, 'outreach/archive');

// Load .env
try {
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

let USE_FALLBACK = false;
if (!process.env.ANTHROPIC_API_KEY) {
  USE_FALLBACK = true;
  console.log('⚠️  No ANTHROPIC_API_KEY set. Using regex fallback.');
  console.log('   Handles: "Name replied", "Name = dead", "call booked/done", LinkedIn URLs.');
  console.log('   For complex updates, add ANTHROPIC_API_KEY to .env\n');
}

const SYSTEM = `You are a CRM update parser. Given a free-form line about outreach activity, extract structured fields.

Return ONLY JSON matching this schema:
{
  "kind": "update" | "new_lead" | "unclear",
  "match": { "name"?: string, "company"?: string, "linkedin_url"?: string, "email"?: string },
  "changes": {
    "status"?: "new"|"dm_sent"|"replied"|"call_booked"|"call_done"|"verbal"|"loi"|"paying"|"dead",
    "email"?: string,
    "call_at"?: "YYYY-MM-DD",
    "replied_at"?: "YYYY-MM-DD",
    "contacted_at"?: "YYYY-MM-DD",
    "notes_append"?: string
  },
  "new_lead_fields"?: { "linkedin_url"?: string, "first_name"?: string, "last_name"?: string, "company"?: string, "email"?: string, "title"?: string, "source"?: string, "notes"?: string },
  "confidence": 0-100,
  "reasoning": "one short sentence"
}

Status semantics:
- "replied" = they answered our DM but no call yet
- "call_booked" = a specific call time is confirmed
- "call_done" = call already happened
- "verbal" = verbal commitment to buy/LOI discussed
- "dead" = not interested, wrong fit, or ghost
Default today's date if the line says "today", "yesterday" means yesterday's date. Today is provided.
If the line starts with "NEW:" or contains a LinkedIn URL for an unknown person, set kind="new_lead".
If you cannot confidently identify the target lead, set kind="unclear" and explain why.`;

function parseLineRegex(line, todayStr) {
  const lower = line.toLowerCase();
  const yesterday = new Date(new Date(todayStr).getTime() - 86400000).toISOString().slice(0, 10);

  // Resolve relative dates
  const resolveDate = (text) => {
    if (/today/i.test(text)) return todayStr;
    if (/yesterday/i.test(text)) return yesterday;
    const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
    return dateMatch ? dateMatch[1] : todayStr;
  };

  // Extract name: first capitalized words
  const nameMatch = line.match(/^[-*]?\s*([A-Z][a-zà-ö]+(?:\s+(?:von\s+|de\s+|van\s+)?[A-Z][a-zà-ö]+)*)/);
  const name = nameMatch ? nameMatch[1].trim() : '';

  // Extract company: "from X" or "at X"
  const companyMatch = line.match(/(?:from|at)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)/);
  const company = companyMatch ? companyMatch[1] : '';

  // Extract email
  const emailMatch = line.match(/([\w.-]+@[\w.-]+\.\w+)/);
  const email = emailMatch ? emailMatch[1] : '';

  // NEW lead: LinkedIn URL
  if (/linkedin\.com\/in\//.test(lower)) {
    const urlMatch = line.match(/(https?:\/\/[^\s,]+linkedin\.com\/in\/[^\s,]+)/);
    return {
      kind: 'new_lead',
      new_lead_fields: { linkedin_url: urlMatch ? urlMatch[1] : '', source: 'manual_dm', notes: line },
      confidence: 80,
      reasoning: 'regex: LinkedIn URL detected'
    };
  }

  // DEAD: "dead", "not interested", "wrong fit", "ghost"
  if (/\b(dead|not interested|wrong fit|ghost(?:ed)?|no reply|unresponsive|rejected)\b/i.test(lower)) {
    return {
      kind: 'update',
      match: { name, company },
      changes: { status: 'dead', notes_append: line },
      confidence: 70,
      reasoning: 'regex: dead/rejected detected'
    };
  }

  // CALL DONE: "call done", "spoke with", "had a call", "talked to"
  if (/\b(call done|call happened|spoke with|talked to|had a call|call went)\b/i.test(lower)) {
    return {
      kind: 'update',
      match: { name, company },
      changes: { status: 'call_done', notes_append: line },
      confidence: 70,
      reasoning: 'regex: call done detected'
    };
  }

  // CALL BOOKED: "call booked", "meeting scheduled", "call on", "chat on"
  if (/\b(call|meeting|chat)\s*(booked|scheduled|set|confirmed|on\s+\d|tomorrow|next)\b/i.test(lower)) {
    const changes = { status: 'call_booked', notes_append: line };
    const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) changes.call_at = dateMatch[1];
    if (email) changes.email = email;
    return {
      kind: 'update',
      match: { name, company },
      changes,
      confidence: 70,
      reasoning: 'regex: call booked detected'
    };
  }

  // REPLIED: "replied", "responded", "answered", "got back"
  if (/\b(replied|responded|answered|got back|wrote back)\b/i.test(lower)) {
    const changes = { status: 'replied', replied_at: resolveDate(line), notes_append: line };
    if (email) changes.email = email;
    // Check if call is also mentioned
    if (/\b(call|meeting|chat)\b/i.test(lower) && /\b(booked|scheduled|set|confirmed|tomorrow|next)\b/i.test(lower)) {
      changes.status = 'call_booked';
      const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) changes.call_at = dateMatch[1];
    }
    return {
      kind: 'update',
      match: { name, company },
      changes,
      confidence: 70,
      reasoning: 'regex: reply detected'
    };
  }

  // VERBAL: "verbal", "committed", "loi"
  if (/\b(verbal|committed|loi|letter of intent)\b/i.test(lower)) {
    return {
      kind: 'update',
      match: { name, company },
      changes: { status: 'verbal', notes_append: line },
      confidence: 60,
      reasoning: 'regex: verbal commitment detected'
    };
  }

  // DM SENT: "sent", "dm sent", "messaged", "reached out"
  if (/\b(dm sent|sent|messaged|reached out|contacted)\b/i.test(lower) && name) {
    return {
      kind: 'update',
      match: { name, company },
      changes: { status: 'dm_sent', contacted_at: resolveDate(line), notes_append: line },
      confidence: 60,
      reasoning: 'regex: outreach sent detected'
    };
  }

  // Can't parse
  return {
    kind: 'unclear',
    confidence: 0,
    reasoning: 'regex: could not parse — set ANTHROPIC_API_KEY for AI-powered parsing'
  };
}

async function callHaiku(line, todayStr) {
  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: SYSTEM + `\nToday: ${todayStr}`,
    messages: [{ role: 'user', content: line }],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Haiku ${res.status}: ${t}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in response: ${text}`);
  return JSON.parse(jsonMatch[0]);
}

function findLead(rows, match) {
  if (match.linkedin_url) {
    const u = match.linkedin_url.replace(/\/+$/, '').toLowerCase();
    const found = rows.find(r => (r.linkedin_url || '').replace(/\/+$/, '').toLowerCase() === u);
    if (found) return found;
  }
  if (match.email) {
    const e = match.email.toLowerCase();
    const found = rows.find(r => (r.email || '').toLowerCase() === e);
    if (found) return found;
  }
  const name = (match.name || '').toLowerCase().trim();
  const company = (match.company || '').toLowerCase().trim();
  if (name) {
    // Fuzzy-ish: last token of name + company substring
    const lastToken = name.split(/\s+/).pop();
    const matches = rows.filter(r => {
      const n = `${r.first_name} ${r.last_name}`.toLowerCase();
      const c = (r.company || '').toLowerCase();
      const nameHit = n.includes(lastToken) || lastToken.length > 3 && n.split(/\s+/).some(t => t.startsWith(lastToken));
      const companyHit = !company || c.includes(company) || company.includes(c);
      return nameHit && companyHit;
    });
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null; // ambiguous
  }
  if (company) {
    const matches = rows.filter(r => (r.company || '').toLowerCase().includes(company));
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function extractLines(md) {
  const out = [];
  for (const raw of md.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>')) continue;
    // Strip bullet markers
    const cleaned = trimmed.replace(/^[-*]\s+/, '').trim();
    if (cleaned.length < 5) continue;
    out.push(cleaned);
  }
  return out;
}

// Metrics are now derived by sync-metrics.js — no manual bumping needed

async function main() {
  if (!fs.existsSync(UPDATES_PATH)) {
    console.log(`No updates file at ${path.relative(ROOT, UPDATES_PATH)}`);
    console.log(`Create it and drop free-form update lines, then run this again.`);
    process.exit(0);
  }
  const md = fs.readFileSync(UPDATES_PATH, 'utf8');
  const lines = extractLines(md);
  if (!lines.length) { console.log('No update lines found.'); return; }

  const today = new Date().toISOString().slice(0, 10);
  const rows = load();
  const applied = [];
  const unclear = [];
  const newLeads = [];

  for (const line of lines) {
    try {
      const parsed = USE_FALLBACK ? parseLineRegex(line, today) : await callHaiku(line, today);
      if (parsed.kind === 'new_lead') {
        const fields = parsed.new_lead_fields || {};
        const lead = {
          linkedin_url: fields.linkedin_url || `manual:${Date.now()}`,
          first_name: fields.first_name || '',
          last_name: fields.last_name || '',
          title: fields.title || '',
          company: fields.company || '',
          domain: '', industry: '', employees: '', country: '',
          email: fields.email || '',
          source: fields.source || 'manual_dm',
          tags: 'manual-update',
          status: 'new',
          priority: '60',
          contacted_at: '', replied_at: '',
          notes: fields.notes || line,
        };
        upsert(rows, lead, { overwrite: false });
        newLeads.push({ line, lead });
        continue;
      }
      if (parsed.kind === 'unclear' || parsed.confidence < 50) {
        unclear.push({ line, reason: parsed.reasoning });
        continue;
      }
      const lead = findLead(rows, parsed.match || {});
      if (!lead) { unclear.push({ line, reason: `No lead matched ${JSON.stringify(parsed.match)}` }); continue; }
      const prevStatus = lead.status;
      const ch = parsed.changes || {};
      for (const k of ['status', 'email', 'replied_at', 'contacted_at']) {
        if (ch[k]) lead[k] = ch[k];
      }
      // call_at is routed to events.yml — events are the single source of truth for
      // time-based events. The Haiku schema still emits call_at when the user mentions
      // "call Thursday 14:00" because that's the easiest English-to-field mapping.
      if (ch.call_at) {
        try {
          const E = require('../events/lib/events');
          const start = ch.call_at.length === 10 ? `${ch.call_at}T00:00:00+00:00` : ch.call_at;
          const isFuture = ch.call_at.slice(0, 10) >= today;
          const state = E.load();
          const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.company;
          E.upsert(state, {
            title: `${isFuture ? 'Call (scheduled)' : 'Call'} — ${name}${lead.company ? ` / ${lead.company}` : ''}`,
            start,
            end: E.defaultEnd(start, 30),
            type: 'unspecified',
            status: isFuture ? 'scheduled' : 'done',
            attendees: [],
            lead_id: lead.linkedin_url || null,
            location: null,
            notes: null,
            source: 'flush-updates',
          });
          E.save(state);
        } catch (e) {
          // events module not installed — fall back to no-op. The user can run
          // tools/events/migrate-from-csv.js later if they install the events system.
        }
      }
      if (ch.notes_append) {
        lead.notes = ch.notes_append + ' | ' + (lead.notes || '');
      }
      applied.push({ line, lead, prevStatus, changes: ch });
    } catch (e) {
      unclear.push({ line, reason: `Error: ${e.message}` });
    }
  }

  save(rows);

  // Derive all metrics from CSV (single source of truth)
  syncMetrics();

  // Archive updates file
  if (!fs.existsSync(ARCHIVE)) fs.mkdirSync(ARCHIVE, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.renameSync(UPDATES_PATH, path.join(ARCHIVE, `updates-${stamp}.md`));

  console.log(`\n✓ flush-updates: ${applied.length} applied, ${newLeads.length} new leads, ${unclear.length} unclear\n`);
  for (const a of applied) {
    const name = `${a.lead.first_name} ${a.lead.last_name}`.trim() || a.lead.company;
    const statusChange = a.changes.status && a.changes.status !== a.prevStatus ? ` [${a.prevStatus} → ${a.changes.status}]` : '';
    console.log(`  ✓ ${name}${statusChange}`);
    console.log(`      "${a.line.slice(0, 80)}"`);
  }
  for (const n of newLeads) {
    console.log(`  + NEW: ${n.lead.first_name} ${n.lead.last_name} · ${n.lead.company}`);
  }
  if (unclear.length) {
    console.log(`\n⚠️  Unclear (left in inbox for manual review):`);
    for (const u of unclear) {
      console.log(`  ? ${u.line.slice(0, 80)}`);
      console.log(`      → ${u.reason}`);
    }
    // Re-append unclear lines to a new updates.md for next pass
    fs.writeFileSync(UPDATES_PATH, '# Unclear updates (retry or edit)\n\n' + unclear.map(u => `- ${u.line}`).join('\n') + '\n');
  }
  console.log();
}

main().catch(e => { console.error(e); process.exit(1); });
