# Outreach Add-on Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a generic, open-source outreach tracking add-on for Battle Plan — installable via `npx create-battle-plan-outreach` — with full pipeline tooling (daily targets, flush scripts, metrics sync, mermaid dashboard) and a Claude-facing README that interactively onboards new users.

**Architecture:** Separate NPM package (`create-battle-plan-outreach/`) alongside existing `create-battle-plan/`. Template files under `create-battle-plan-outreach/template/` get copied into an existing Battle Plan project. Scripts in `tools/outreach/` are generified from the compliance-wizard originals — all compliance/security-specific logic removed, template assignment made configurable via `templates.json`. The `flush-updates.js` script has a regex fallback when no Anthropic API key is present.

**Tech Stack:** Node.js (CLI), vanilla JS (no deps), bash shell scripts

**Source material:** All outreach scripts live at `/Users/paulvonkunhardt/Projects/compliance-wizard/tools/outreach/` — generify from there, don't write from scratch.

---

## File Structure

### New files to create (in `create-battle-plan-outreach/`)

```
create-battle-plan-outreach/
├── bin/cli.js                          # NPX installer CLI
├── package.json                        # NPM package config
├── .npmignore                          # Exclude dev files
└── template/
    ├── outreach/
    │   ├── README.md                   # Claude-facing system doc + interactive onboarding
    │   ├── leads.csv                   # Headers-only CSV (23 columns)
    │   ├── inbox/
    │   │   └── updates.md.template     # Free-form update dropbox template
    │   └── archive/
    │       └── .gitkeep
    └── tools/
        └── outreach/
            ├── lib/
            │   ├── csv.js              # RFC 4180 CSV parser (as-is from source)
            │   └── leads.js            # CSV i/o + upsert (path adjusted)
            ├── daily-targets.js        # Generified daily blitz generator
            ├── flush-targets.js        # Checklist → leads.csv flusher
            ├── flush-updates.js        # Free-form NLP parser (Haiku + regex fallback)
            ├── flush-accepts.js        # Connection accept batch processor
            ├── flush-inbox.js          # Manual URL inbox processor
            ├── sync-metrics.js         # Derive metrics.yml from leads.csv
            ├── update-dashboard.js     # Mermaid conversion dashboard generator
            ├── stats.js                # CLI tally/pipeline summary
            ├── lookup.js               # Fuzzy name lookup
            └── templates.json          # Empty template config with examples
```

### Files to modify (in existing repo)

```
README.md                               # Add Outreach Add-on section
CLAUDE.md                               # Add Outreach System section
```

---

## Task 1: Core Library — csv.js and leads.js

**Files:**
- Create: `create-battle-plan-outreach/template/tools/outreach/lib/csv.js`
- Create: `create-battle-plan-outreach/template/tools/outreach/lib/leads.js`

These are the foundation — every other script depends on them.

- [ ] **Step 1: Create directory structure**

Run:
```bash
mkdir -p create-battle-plan-outreach/template/tools/outreach/lib
mkdir -p create-battle-plan-outreach/template/outreach/inbox
mkdir -p create-battle-plan-outreach/template/outreach/archive
mkdir -p create-battle-plan-outreach/bin
```

- [ ] **Step 2: Copy csv.js as-is from source**

Copy `/Users/paulvonkunhardt/Projects/compliance-wizard/tools/outreach/lib/csv.js` verbatim — it's already fully generic (RFC 4180 parser, no deps, no domain logic).

- [ ] **Step 3: Create leads.js with adjusted path**

Copy from `/Users/paulvonkunhardt/Projects/compliance-wizard/tools/outreach/lib/leads.js` but change the `LEADS_PATH` to use a dynamic root resolution:

```js
const LEADS_PATH = path.resolve(__dirname, '../../../outreach/leads.csv');
```

This path is the same as the source — it resolves from `tools/outreach/lib/` up to project root then into `outreach/leads.csv`. Keep everything else identical: HEADERS array, VALID_STATUS set, load/save/normKey/upsert functions.

- [ ] **Step 4: Create empty leads.csv with headers only**

Create `create-battle-plan-outreach/template/outreach/leads.csv` containing just the header row:

```
linkedin_url,first_name,last_name,title,company,domain,industry,company_type,employees,revenue,country,email,source,tags,status,priority,contacted_at,replied_at,call_at,followed_up_at,channel,template,notes
```

- [ ] **Step 5: Create updates.md.template**

Copy from `/Users/paulvonkunhardt/Projects/compliance-wizard/outreach/inbox/updates.md.template` — it's already generic. Just remove the `€0.0001` cost reference and replace with "uses Claude Haiku if API key is set, otherwise regex fallback".

- [ ] **Step 6: Create archive/.gitkeep**

```bash
touch create-battle-plan-outreach/template/outreach/archive/.gitkeep
```

- [ ] **Step 7: Commit**

```bash
git add create-battle-plan-outreach/template/tools/outreach/lib/ create-battle-plan-outreach/template/outreach/
git commit -m "feat(outreach): add core library — csv parser, leads i/o, empty CSV template"
```

---

## Task 2: templates.json — Generic Template Config

**Files:**
- Create: `create-battle-plan-outreach/template/tools/outreach/templates.json`

- [ ] **Step 1: Create generic templates.json**

Replace the compliance-specific Antler/GRC templates with generic placeholders that show the structure:

```json
{
  "A": {
    "text": "Hi [Name], I'm [your role] at [company]. We're working on [problem area] and I'd love to hear your take — is [specific pain point] something you deal with? Would be great to chat briefly. Cheers, [Your Name]",
    "sent": 0,
    "replies": 0,
    "calls": 0
  },
  "B": {
    "text": "Hi [Name], I noticed [something specific about them/their company]. I'm exploring [your area] and curious whether [specific question]. Happy to share what I've learned so far. Up for a quick chat? [Your Name]",
    "sent": 0,
    "replies": 0,
    "calls": 0
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add create-battle-plan-outreach/template/tools/outreach/templates.json
git commit -m "feat(outreach): add generic templates.json with placeholder examples"
```

---

## Task 3: daily-targets.js — Generified Blitz Generator

**Files:**
- Create: `create-battle-plan-outreach/template/tools/outreach/daily-targets.js`

- [ ] **Step 1: Copy and generify daily-targets.js**

Copy from `/Users/paulvonkunhardt/Projects/compliance-wizard/tools/outreach/daily-targets.js`. Changes needed:

1. **Remove compliance-specific exclusions:** Remove `EXCLUDED_COMPANY_TYPES` hardcoded set (`b2c`, `consulting`, `cybersec-vendor`). Instead, read from `templates.json` if it has an `excluded_company_types` array, otherwise no exclusions.

2. **Generify template assignment:** Replace the `GERMAN_COUNTRIES` hardcoded set and the `assignTemplate()` function. New logic:
   - Read `templates.json` for a `country_template_map` field (e.g., `{"Germany": "A", "Austria": "A"}`)
   - If a lead's country matches a mapped template, use that
   - Otherwise, round-robin across remaining templates
   - If no mapping exists, round-robin all templates

3. **Keep everything else identical:** Pool logic (new/follow-up/InMail), sorting, rate limit tracking, checklist generation, template performance table — all generic already.

4. **Remove the `deriveMetrics` import dependency on sync-metrics.js** — this is fine, it already works via `require('./sync-metrics')`. Just make sure the path works.

- [ ] **Step 2: Verify the require paths work**

The script requires `./lib/leads` and `./sync-metrics` — both will exist in the same relative location in the template.

- [ ] **Step 3: Commit**

```bash
git add create-battle-plan-outreach/template/tools/outreach/daily-targets.js
git commit -m "feat(outreach): add generified daily-targets.js with configurable template assignment"
```

---

## Task 4: flush-targets.js — Checklist Flusher

**Files:**
- Create: `create-battle-plan-outreach/template/tools/outreach/flush-targets.js`

- [ ] **Step 1: Copy flush-targets.js as-is**

Copy from `/Users/paulvonkunhardt/Projects/compliance-wizard/tools/outreach/flush-targets.js`. This script is already generic — it:
- Parses checked checkboxes from the daily blitz file
- Matches leads by URL or name+company
- Updates status to `dm_sent`, sets `contacted_at`
- Handles follow-ups and InMails
- Handles rejections (marks as dead)
- Calls `syncMetrics()` and archives the file

No changes needed. Just copy verbatim.

- [ ] **Step 2: Commit**

```bash
git add create-battle-plan-outreach/template/tools/outreach/flush-targets.js
git commit -m "feat(outreach): add flush-targets.js checklist flusher"
```

---

## Task 5: flush-updates.js — Free-form NLP Parser with Regex Fallback

**Files:**
- Create: `create-battle-plan-outreach/template/tools/outreach/flush-updates.js`

- [ ] **Step 1: Copy and add regex fallback**

Copy from `/Users/paulvonkunhardt/Projects/compliance-wizard/tools/outreach/flush-updates.js`. Changes:

1. **Add regex fallback before the Haiku call.** When `ANTHROPIC_API_KEY` is not set, instead of `process.exit(1)`, set a flag `USE_FALLBACK = true`.

2. **Add `parseLineRegex(line, todayStr)` function** that handles common patterns:

```js
function parseLineRegex(line, todayStr) {
  const lower = line.toLowerCase();

  // Extract name: first capitalized words or quoted name
  const nameMatch = line.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
  const name = nameMatch ? nameMatch[1] : '';

  // Extract company: "from X" or "at X"
  const companyMatch = line.match(/(?:from|at)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)/);
  const company = companyMatch ? companyMatch[1] : '';

  // Detect status changes
  if (/\b(replied|responded|answered|got back)\b/i.test(lower)) {
    const result = { kind: 'update', match: { name, company }, changes: { status: 'replied', replied_at: todayStr }, confidence: 70, reasoning: 'regex: reply detected' };
    // Check for call booking in same line
    if (/\b(call|meeting|chat)\s*(booked|scheduled|set|confirmed|tomorrow|next|on\s+\d)/i.test(lower)) {
      result.changes.status = 'call_booked';
      const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) result.changes.call_at = dateMatch[1];
    }
    // Check for email
    const emailMatch = line.match(/[\w.-]+@[\w.-]+\.\w+/);
    if (emailMatch) result.changes.email = emailMatch[0];
    return result;
  }

  if (/\b(dead|not interested|wrong fit|ghost|no reply|unresponsive)\b/i.test(lower)) {
    return { kind: 'update', match: { name, company }, changes: { status: 'dead', notes_append: line }, confidence: 70, reasoning: 'regex: dead/rejected detected' };
  }

  if (/\b(call done|call happened|spoke with|talked to|had a call)\b/i.test(lower)) {
    return { kind: 'update', match: { name, company }, changes: { status: 'call_done' }, confidence: 70, reasoning: 'regex: call done detected' };
  }

  if (/\b(verbal|committed|loi|letter of intent)\b/i.test(lower)) {
    return { kind: 'update', match: { name, company }, changes: { status: 'verbal' }, confidence: 60, reasoning: 'regex: verbal commitment detected' };
  }

  // LinkedIn URL = new lead
  if (/linkedin\.com\/in\//.test(lower)) {
    const urlMatch = line.match(/(https?:\/\/[^\s,]+linkedin\.com\/in\/[^\s,]+)/);
    return { kind: 'new_lead', new_lead_fields: { linkedin_url: urlMatch ? urlMatch[1] : '', source: 'manual_dm' }, confidence: 80, reasoning: 'regex: LinkedIn URL detected' };
  }

  return { kind: 'unclear', confidence: 0, reasoning: 'regex: could not parse — set ANTHROPIC_API_KEY for AI parsing' };
}
```

3. **In the main loop**, replace the `callHaiku` call with:

```js
const parsed = USE_FALLBACK ? parseLineRegex(line, today) : await callHaiku(line, today);
```

4. **On first run without API key**, print a one-time message:
```
⚠️  No ANTHROPIC_API_KEY set. Using regex fallback — handles simple updates like
    "Name replied", "Name = dead", "Name call booked 2026-04-20".
    For complex free-form updates, add ANTHROPIC_API_KEY to .env
```

5. **Remove the compliance-specific system prompt flavoring** in the Haiku system message. The current prompt is already generic ("CRM update parser") — just verify there's no compliance-specific text.

- [ ] **Step 2: Commit**

```bash
git add create-battle-plan-outreach/template/tools/outreach/flush-updates.js
git commit -m "feat(outreach): add flush-updates.js with Haiku + regex fallback"
```

---

## Task 6: flush-accepts.js, flush-inbox.js, lookup.js — Utility Scripts

**Files:**
- Create: `create-battle-plan-outreach/template/tools/outreach/flush-accepts.js`
- Create: `create-battle-plan-outreach/template/tools/outreach/flush-inbox.js`
- Create: `create-battle-plan-outreach/template/tools/outreach/lookup.js`

- [ ] **Step 1: Copy flush-accepts.js as-is**

Copy from `/Users/paulvonkunhardt/Projects/compliance-wizard/tools/outreach/flush-accepts.js`. Already fully generic — fuzzy name matching, tag management, metric sync.

- [ ] **Step 2: Copy flush-inbox.js as-is**

Copy from `/Users/paulvonkunhardt/Projects/compliance-wizard/tools/outreach/flush-inbox.js`. Already generic — reads URLs from inbox/manual.txt, appends to leads.csv.

- [ ] **Step 3: Copy lookup.js as-is**

Copy from `/Users/paulvonkunhardt/Projects/compliance-wizard/tools/outreach/lookup.js`. Already generic — fuzzy name search against leads.csv.

- [ ] **Step 4: Commit**

```bash
git add create-battle-plan-outreach/template/tools/outreach/flush-accepts.js create-battle-plan-outreach/template/tools/outreach/flush-inbox.js create-battle-plan-outreach/template/tools/outreach/lookup.js
git commit -m "feat(outreach): add flush-accepts, flush-inbox, lookup utility scripts"
```

---

## Task 7: sync-metrics.js — Metrics Derivation

**Files:**
- Create: `create-battle-plan-outreach/template/tools/outreach/sync-metrics.js`

- [ ] **Step 1: Copy and generify sync-metrics.js**

Copy from `/Users/paulvonkunhardt/Projects/compliance-wizard/tools/outreach/sync-metrics.js`. Changes:

1. **Remove the compliance-specific Sven referral comments** — keep the derivation logic identical but remove comments referencing specific people.

2. **Make ROOT path resolution work relative to the script:**
```js
const ROOT = path.resolve(__dirname, '../..');
```
This already works — `tools/outreach/sync-metrics.js` → up 2 = project root. Keep as-is.

3. **Keep the dashboard chain call** at the bottom — it tries to run `update-dashboard.js` after sync and gracefully fails if it doesn't exist.

4. **Keep module exports** — `flush-targets.js` and `daily-targets.js` both import `deriveMetrics` from this module.

- [ ] **Step 2: Commit**

```bash
git add create-battle-plan-outreach/template/tools/outreach/sync-metrics.js
git commit -m "feat(outreach): add sync-metrics.js — derives metrics.yml from leads.csv"
```

---

## Task 8: stats.js — Pipeline Summary

**Files:**
- Create: `create-battle-plan-outreach/template/tools/outreach/stats.js`

- [ ] **Step 1: Copy stats.js as-is**

Copy from `/Users/paulvonkunhardt/Projects/compliance-wizard/tools/outreach/stats.js`. Already fully generic — prints tallies by status/source/country/tag, template performance, weekly breakdown, pipeline highlight, rate limit warnings.

- [ ] **Step 2: Commit**

```bash
git add create-battle-plan-outreach/template/tools/outreach/stats.js
git commit -m "feat(outreach): add stats.js pipeline summary"
```

---

## Task 9: update-dashboard.js — Mermaid Conversion Dashboard

**Files:**
- Create: `create-battle-plan-outreach/template/tools/outreach/update-dashboard.js`

- [ ] **Step 1: Copy and generify update-dashboard.js**

Copy from `/Users/paulvonkunhardt/Projects/compliance-wizard/tools/outreach/update-dashboard.js`. Changes:

1. **Remove compliance-specific classifiers:**
   - Remove `EXCLUDED_TYPES` set (`b2c`, `consulting`, `cybersec-vendor`)
   - Remove `KEEP_OVERRIDE` set (`healthtech`)
   - Remove `classifyTitle()` function that maps to `CEO/Founder`, `CTO/Tech`, `CISO/Security`, `GRC/Compliance`
   - Replace with a generic `classifyTitle()` that groups by common patterns: `C-Suite` (CEO/CTO/COO/CFO/CMO), `VP/Director` (VP, Director, Head of), `Manager` (Manager, Lead, Team Lead), `Individual` (everything else)

2. **Remove compliance-specific insights** in the TL;DR generator:
   - Remove CISO-specific insight ("CISOs barely engage")
   - Remove GRC-specific insight ("GRC/Compliance is n=...")
   - Remove Germany comparison insight
   - Keep the generic comparisons (top role, top band, top company type, dead zones, template performance)

3. **Keep all mermaid chart generation** — the funnel chart, role conversion chart, company size chart, country chart, company type chart, template comparison chart are all generic.

4. **Keep the company type verdict logic** but remove compliance-specific overrides. The generic verdict system (Kill/Pause/Keep/Scale based on conversion rates) works for any domain.

5. **Keep the output path:** `docs/analysis/icp-conversion.md`

- [ ] **Step 2: Commit**

```bash
git add create-battle-plan-outreach/template/tools/outreach/update-dashboard.js
git commit -m "feat(outreach): add generified mermaid conversion dashboard"
```

---

## Task 10: outreach/README.md — Claude-Facing Interactive Onboarding Doc

**Files:**
- Create: `create-battle-plan-outreach/template/outreach/README.md`

This is the most important file. It serves dual purpose:
1. Human-readable documentation of the entire outreach system
2. Claude-facing instructions for interactive onboarding

- [ ] **Step 1: Write the README**

Structure:

```markdown
# Outreach System

> **For Claude:** If `.outreach-initialized` does NOT exist in the project root, run the Interactive Setup section below before doing anything else with the outreach system.

## What This Is

A CSV-powered outreach tracking system that integrates with Battle Plan's cascade protocol. `leads.csv` is the single source of truth for every person you've contacted or plan to contact. All metrics are derived from it automatically — you never update numbers by hand.

## Interactive Setup

> **For Claude:** Walk the user through this one question at a time. Be conversational. After all steps are complete, create `.outreach-initialized` in the project root.

### Step 1: Import Your Leads

Ask the user: **"Do you have a list of leads already? This could be a CSV export from LinkedIn, a spreadsheet, a CRM export, or even just a list of names and companies."**

Based on their answer:

- **They have a CSV:** Help them map their columns to the leads.csv schema. Read their file, identify which columns match (name, company, title, LinkedIn URL, email, etc.), and write the mapped data into `outreach/leads.csv`. Fill missing columns with blanks. Set all statuses to `new`.

- **They have a spreadsheet/list:** Help them structure it. Ask for the data, parse it, and write to leads.csv.

- **They have nothing yet:** That's fine. Explain they can add leads later via:
  - Dropping LinkedIn URLs into `outreach/inbox/manual.txt` and running `node tools/outreach/flush-inbox.js`
  - Telling Claude about leads in natural language (Claude writes to leads.csv directly)
  - Any CSV import later

### Step 2: Set Up Templates

Ask: **"What message do you send when you reach out to someone? Paste your template(s) — or describe your approach and I'll help you write one."**

Save their templates to `tools/outreach/templates.json` with letter keys (A, B, C...).

If they want geographic or segment-based template routing, add a `country_template_map` field:
```json
{
  "country_template_map": { "Germany": "A", "Austria": "A" },
  "A": { "text": "...", "sent": 0, "replies": 0, "calls": 0 },
  "B": { "text": "...", "sent": 0, "replies": 0, "calls": 0 }
}
```

### Step 3: Configure Metrics

Add outreach metrics to the project's `metrics.yml`:
```yaml
# Outreach pipeline (derived from leads.csv — do not edit manually)
outreach_sent: 0
responses: 0
invitations_accepted: 0
discovery_calls: 0
calls_booked: 0
verbal_commitments: 0
```

Tell the user: these update automatically whenever they flush their outreach. No manual editing needed.

### Step 4: Explain the Daily Workflow

Walk through this with the user:

> **Your daily outreach loop:**
>
> 1. **Morning:** Run `node tools/outreach/daily-targets.js` — generates today's blitz checklist at `outreach/inbox/YYYY-MM-DD.md`
> 2. **During the day:** Open the checklist, send messages, tick boxes as you go
> 3. **Evening:** Run `node tools/outreach/flush-targets.js` — marks sent leads in CSV, syncs metrics, archives checklist
>
> **When things happen between blitzes:**
> - Someone replies? Write it in `outreach/inbox/updates.md` and run `node tools/outreach/flush-updates.js`
> - People accept your connection? Drop names in `outreach/inbox/accepts.txt` and run `node tools/outreach/flush-accepts.js`
> - Found someone new to reach out to? Drop their LinkedIn URL in `outreach/inbox/manual.txt` and run `node tools/outreach/flush-inbox.js`
>
> **The cascade handles the rest.** Every flush script syncs metrics.yml → battle-plan.md → domain docs automatically.

### Step 5: Create .outreach-initialized

After the user confirms they understand the workflow:
```bash
echo "Initialized on $(date +%Y-%m-%d)" > .outreach-initialized
```

Tell the user: "You're all set. Run `node tools/outreach/daily-targets.js` to generate your first blitz list, or tell me about leads you want to add."

---

## How It Works

### The Pipeline

```
Your leads (any source)
        │
        ▼
   leads.csv          ← single source of truth (23 columns)
        │
   ┌────┼────┐
   │    │    │
   ▼    ▼    ▼
 daily  flush  flush     ← three input paths
targets targets updates
   │    │    │
   └────┼────┘
        │
        ▼
  sync-metrics.js      ← derives all numbers from CSV
        │
        ▼
   metrics.yml         ← cascade protocol takes over
        │
        ▼
  battle-plan.md       ← your command center
```

### leads.csv Schema

| Column | Purpose |
|--------|---------|
| `linkedin_url` | **Primary key.** For manual entries: `manual:{slug}` |
| `first_name`, `last_name` | Contact name |
| `title` | Job title |
| `company`, `domain` | Company info |
| `industry`, `company_type` | Segmentation |
| `employees`, `revenue` | Company size |
| `country` | Geography |
| `email` | Contact email |
| `source` | Where the lead came from (`linkedin`, `referral`, `manual_dm`, etc.) |
| `tags` | Comma-separated tags (e.g., `accepted`, `tier1`, `demo-candidate`) |
| `status` | Pipeline stage (see below) |
| `priority` | 0-100 score for outreach ordering |
| `contacted_at` | Date first message sent |
| `replied_at` | Date they replied |
| `call_at` | Date of scheduled/completed call |
| `followed_up_at` | Date of most recent follow-up |
| `channel` | `connection` or `inmail` |
| `template` | Which message template was used (A, B, C...) |
| `notes` | Free text |

### Status Flow

```
new → dm_sent → replied → call_booked → call_done → verbal → loi → paying
                       ↘ dead (no reply / not interested / wrong fit)
```

### Scripts Reference

| Script | What it does | Cost |
|--------|-------------|------|
| `daily-targets.js [N]` | Generate today's blitz checklist (default 20 new + 10 follow-ups + 5 InMails) | Free |
| `flush-targets.js` | Process checked boxes from blitz → update leads.csv | Free |
| `flush-updates.js` | Parse free-form updates → update leads.csv | Free (regex) or ~$0.0001/line (Haiku) |
| `flush-accepts.js` | Batch-process connection accepts | Free |
| `flush-inbox.js` | Add LinkedIn URLs from inbox/manual.txt | Free |
| `sync-metrics.js` | Derive metrics.yml from leads.csv | Free |
| `update-dashboard.js` | Regenerate mermaid conversion dashboard | Free |
| `stats.js` | Print pipeline summary to terminal | Free |
| `lookup.js "Name"` | Fuzzy-search leads.csv | Free |

### Template Performance Tracking

Templates are defined in `tools/outreach/templates.json`. Every flush recounts stats from leads.csv (source of truth). The daily blitz checklist shows a performance table:

| Template | Sent | Accepts | Accept% | Replies | Reply% |
|----------|------|---------|---------|---------|--------|

Use this data to A/B test your messaging. Kill underperformers, double down on what works.

### Rate Limits

The daily-targets script tracks LinkedIn's rate limits:
- **Connection requests:** ~100/week
- **InMails:** 99/month (Sales Navigator Core)

Warnings appear in the blitz checklist when you're approaching limits.

### Mermaid Dashboard

Run `node tools/outreach/update-dashboard.js` (or it runs automatically after every metric sync) to generate `docs/analysis/icp-conversion.md` — a full conversion analysis with:
- Overall funnel chart
- Conversion by role/title
- Conversion by company size
- Conversion by country
- Conversion by company type (with Kill/Keep/Scale verdicts)
- Template comparison
- Cross-tab analysis

View it in any markdown renderer that supports mermaid (GitHub, VS Code, etc.).

### Free-Form Updates (flush-updates.js)

Write natural language updates in `outreach/inbox/updates.md`:

```markdown
- John from Acme replied, wants a call Thursday
- Sarah Lee = dead, not interested
- NEW: https://linkedin.com/in/jane-doe — found via conference
```

If `ANTHROPIC_API_KEY` is set in `.env`, Haiku parses these with high accuracy. Without it, the regex fallback handles common patterns:
- "Name replied" → status: replied
- "Name = dead" / "not interested" → status: dead
- "call booked/done" → status: call_booked/call_done
- LinkedIn URLs → new lead

For best results, set up the API key:
```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env
```

## Folder Layout

```
outreach/
├── leads.csv            ← the truth
├── README.md            ← this file
├── inbox/               ← daily checklists + manual inputs
│   ├── YYYY-MM-DD.md    ← today's blitz (generated)
│   ├── updates.md       ← free-form updates (you write)
│   ├── accepts.txt      ← connection accept names (you paste)
│   └── manual.txt       ← LinkedIn URLs to add (you paste)
└── archive/             ← processed files after flushing
```
```

- [ ] **Step 2: Commit**

```bash
git add create-battle-plan-outreach/template/outreach/README.md
git commit -m "feat(outreach): add Claude-facing README with interactive onboarding guide"
```

---

## Task 11: NPX CLI Installer

**Files:**
- Create: `create-battle-plan-outreach/bin/cli.js`
- Create: `create-battle-plan-outreach/package.json`
- Create: `create-battle-plan-outreach/.npmignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "create-battle-plan-outreach",
  "version": "1.0.0",
  "description": "Add outreach tracking to your Battle Plan project — CSV-powered pipeline with daily blitz, metrics sync, and mermaid dashboards",
  "bin": {
    "create-battle-plan-outreach": "./bin/cli.js"
  },
  "files": [
    "bin/",
    "template/"
  ],
  "keywords": [
    "claude", "claude-code", "llm", "outreach", "linkedin",
    "battle-plan", "crm", "pipeline", "leads", "csv"
  ],
  "author": "Paul von Kunhardt",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/paulkunhardt/battle-plan"
  },
  "engines": {
    "node": ">=16"
  }
}
```

- [ ] **Step 2: Create .npmignore**

```
.DS_Store
*.log
node_modules/
```

- [ ] **Step 3: Create bin/cli.js**

Pattern matches the existing `create-battle-plan/bin/cli.js` — same color scheme, banner style, folder picker. Flow:

1. Banner: "BATTLE PLAN — OUTREACH ADD-ON"
2. Check for `.battle-plan-initialized` in current directory. If missing:
   ```
   This directory doesn't look like a Battle Plan project.
   Run `npx create-battle-plan` first to set up your project,
   then come back and run this to add outreach tracking.
   ```
   Exit with code 1.
3. Check if `outreach/leads.csv` already exists. If so, warn and exit.
4. Ask: `[1/2] Do you already have a leads CSV or contact list? (y/n)`
   - If yes: "Great! Drop it at outreach/leads.csv after setup. Claude will help you map the columns on your next session."
   - If no: "No problem. You can add leads later — Claude will walk you through it."
5. Ask: `[2/2] Want to set up a message template now? (paste it, or press enter to skip)`
   - If they paste something: save it as template A in `templates.json`
   - If skip: keep the placeholder templates
6. Copy template files into current directory (outreach/ and tools/outreach/)
7. Make all .js files in tools/outreach/ executable
8. Add outreach metrics to existing `metrics.yml` (append if file exists)
9. Create `docs/analysis/` directory
10. Print summary:
    ```
    Ready.

    Added:
      + outreach/          (leads.csv, inbox, archive)
      + tools/outreach/    (11 scripts)

    Next: open Claude Code and run /good-morning
    Claude will walk you through importing your first leads
    and explain the daily outreach workflow.
    ```

The CLI should reuse the same helpers from `create-battle-plan/bin/cli.js` (colors, ask function, copyDir, shortPath) — copy them inline since this is a separate package.

- [ ] **Step 4: Commit**

```bash
git add create-battle-plan-outreach/
git commit -m "feat(outreach): add npx create-battle-plan-outreach CLI installer"
```

---

## Task 12: Update Main README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Outreach Add-on section**

After the "Commands" section and before "How it works", add:

```markdown
## Outreach Add-on

Track your LinkedIn outreach pipeline with a CSV-powered system that integrates directly with Battle Plan's cascade protocol. Leads go in, metrics come out automatically.

### Install

```bash
# In your existing Battle Plan project:
npx create-battle-plan-outreach
```

### What you get

- **`outreach/leads.csv`** — Single source of truth for every lead. 23 columns tracking the full pipeline from `new` → `dm_sent` → `replied` → `call_booked` → `call_done` → `verbal` → `paying`
- **Daily blitz generator** — `node tools/outreach/daily-targets.js` creates a checklist of who to message today, sorted by priority, with template assignment and rate limit tracking
- **Three flush paths** — Tick checkboxes, write free-form updates, or drop LinkedIn URLs. Every path syncs metrics automatically
- **Mermaid conversion dashboard** — Auto-generated funnel charts, role/size/country breakdowns, template A/B testing, and Kill/Keep/Scale verdicts per segment
- **Template performance tracking** — See which outreach messages get the best accept, reply, and call rates

### Prerequisites

- An existing Battle Plan project (`npx create-battle-plan` first)
- A list of leads in any format (CSV, spreadsheet, or just names) — Claude helps you import them
- Optional: `ANTHROPIC_API_KEY` in `.env` for AI-powered free-form update parsing

### Daily workflow

```
Morning:  node tools/outreach/daily-targets.js  → generates today's blitz checklist
Day:      Send messages, tick checkboxes
Evening:  node tools/outreach/flush-targets.js   → syncs everything back to CSV + metrics
```

Claude handles the cascade from there — metrics.yml, battle plan, domain docs all update automatically.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Outreach Add-on section to README"
```

---

## Task 13: Update Main CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Outreach System section to CLAUDE.md**

Add after the "The `/wrap-up` Protocol" section:

```markdown
---

## Outreach System (Add-on)

**Trigger:** If `outreach/leads.csv` exists in the project, the outreach system is active.

### Overview

The outreach system tracks a LinkedIn (or any channel) outreach pipeline through `outreach/leads.csv`. This CSV is the **single source of truth** for all outreach metrics — `metrics.yml` is derived from it, never edited directly for outreach numbers.

### First-Time Setup

If `outreach/leads.csv` exists but `.outreach-initialized` does NOT exist, read `outreach/README.md` and follow the Interactive Setup instructions to onboard the user.

### Daily Workflow Integration

The outreach system plugs into the cascade protocol:

1. User runs `node tools/outreach/daily-targets.js` → generates blitz checklist
2. User sends messages, ticks checkboxes
3. User runs `node tools/outreach/flush-targets.js` → updates leads.csv
4. `flush-targets.js` calls `sync-metrics.js` → derives metrics.yml from CSV
5. `sync-metrics.js` calls `update-dashboard.js` → regenerates mermaid dashboard
6. The cascade protocol takes over: metrics.yml → battle-plan.md → domain docs

### Scripts Reference

| Script | Purpose |
|--------|---------|
| `tools/outreach/daily-targets.js [N]` | Generate daily blitz checklist |
| `tools/outreach/flush-targets.js` | Process checked items from blitz |
| `tools/outreach/flush-updates.js` | Parse free-form natural language updates |
| `tools/outreach/flush-accepts.js` | Batch-process connection accepts |
| `tools/outreach/flush-inbox.js` | Add leads from manual URL list |
| `tools/outreach/sync-metrics.js` | Derive metrics.yml from leads.csv |
| `tools/outreach/update-dashboard.js` | Regenerate mermaid conversion dashboard |
| `tools/outreach/stats.js` | Print pipeline summary |
| `tools/outreach/lookup.js "Name"` | Fuzzy-search leads |

### Metrics Derivation

These metrics in `metrics.yml` are **derived** from leads.csv (never hand-edit):

- `outreach_sent` = leads with status past `new` or `contacted_at` set
- `responses` = `replied_at` set or status past `replied`
- `invitations_accepted` = leads tagged `accepted`
- `discovery_calls` = `call_at` in the past or status `call_done`
- `calls_booked` = status `call_booked` (snapshot)
- `verbal_commitments` = status `verbal`, `loi`, or `paying`

### Template System

Message templates live in `tools/outreach/templates.json`. The daily blitz assigns templates based on the `country_template_map` field (or round-robin if no mapping). Template performance (sent/accepted/replied/calls) is tracked automatically and displayed in the blitz checklist.

### Mermaid Dashboard

`docs/analysis/icp-conversion.md` is auto-generated — never hand-edit. It contains:
- Overall funnel chart (contacted → accepted → replied → call → verbal)
- Conversion breakdown by role, company size, country, company type
- Template A/B comparison
- Kill/Keep/Scale verdicts per segment

View in any mermaid-capable renderer (GitHub, VS Code preview, etc.).

### Adapting the System

- **Different metrics:** Edit the derivation rules in `tools/outreach/sync-metrics.js`
- **Different time horizon:** The system tracks weekly breakdowns — adjust `daily-targets.js` count parameter
- **Different channels:** The `channel` column supports any value (connection, inmail, email, etc.)
- **Different statuses:** Add to `VALID_STATUS` in `tools/outreach/lib/leads.js` and update derivation rules
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Outreach System section to CLAUDE.md"
```

---

## Task 14: Update Template CLAUDE.md (in create-battle-plan)

**Files:**
- Modify: `create-battle-plan/template/CLAUDE.md`

- [ ] **Step 1: Add the same Outreach System section**

Add the identical section from Task 13 to `create-battle-plan/template/CLAUDE.md` — this ensures new Battle Plan projects created via `npx create-battle-plan` will have the outreach documentation ready if the user later installs the add-on.

- [ ] **Step 2: Commit**

```bash
git add create-battle-plan/template/CLAUDE.md
git commit -m "docs: add Outreach System section to template CLAUDE.md"
```

---

## Task 15: End-to-End Verification

- [ ] **Step 1: Verify directory structure**

```bash
find create-battle-plan-outreach -type f | sort
```

Expected output should match the file structure from the plan.

- [ ] **Step 2: Verify all require() paths resolve**

```bash
cd create-battle-plan-outreach/template
node -e "require('./tools/outreach/lib/csv')"
node -e "require('./tools/outreach/lib/leads')"
```

Both should exit without error (leads.js will just report no CSV file exists, which is fine).

- [ ] **Step 3: Verify sync-metrics.js loads**

```bash
node -e "const { deriveMetrics } = require('./tools/outreach/sync-metrics'); console.log(typeof deriveMetrics)"
```

Expected: `function`

- [ ] **Step 4: Verify CLI runs**

```bash
node create-battle-plan-outreach/bin/cli.js --help 2>&1 || true
```

Should print banner or usage info (or fail gracefully with "not a Battle Plan project").

- [ ] **Step 5: Test in a temp directory**

```bash
cd /tmp
mkdir test-bp && cd test-bp
touch .battle-plan-initialized
echo "last_updated: 2026-04-15" > metrics.yml
node /Users/paulvonkunhardt/Projects/cascading-context/create-battle-plan-outreach/bin/cli.js
```

Verify it creates:
- `outreach/leads.csv` (headers only)
- `outreach/inbox/updates.md.template`
- `outreach/archive/.gitkeep`
- `tools/outreach/` (11 .js files + templates.json + lib/)
- Metrics appended to `metrics.yml`

- [ ] **Step 6: Clean up and commit**

```bash
rm -rf /tmp/test-bp
cd /Users/paulvonkunhardt/Projects/cascading-context
```

- [ ] **Step 7: Final commit — version bump and cleanup**

```bash
git add -A
git status
# Review for any missed files
git commit -m "feat: complete outreach add-on — npx create-battle-plan-outreach"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Core library (csv.js, leads.js, empty CSV) | 4 files |
| 2 | Generic templates.json | 1 file |
| 3 | daily-targets.js (generified) | 1 file |
| 4 | flush-targets.js | 1 file |
| 5 | flush-updates.js (with regex fallback) | 1 file |
| 6 | Utility scripts (accepts, inbox, lookup) | 3 files |
| 7 | sync-metrics.js | 1 file |
| 8 | stats.js | 1 file |
| 9 | update-dashboard.js (generified) | 1 file |
| 10 | Outreach README (interactive onboarding) | 1 file |
| 11 | NPX CLI installer | 3 files |
| 12 | Update main README | 1 file (modify) |
| 13 | Update main CLAUDE.md | 1 file (modify) |
| 14 | Update template CLAUDE.md | 1 file (modify) |
| 15 | End-to-end verification | 0 files (testing) |

Total: ~20 new files, 3 modified files, 15 tasks.
