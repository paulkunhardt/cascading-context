```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║    ___  ____ ___ ___ _    ____   ___  _    ____ _  _             ║
║    |__] |__|  |   |  |    |___   |__] |    |__| |\ |             ║
║    |__] |  |  |   |  |___ |___   |    |___ |  | | \|             ║
║                                                                  ║
║           Your project's memory layer for Claude Code            ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

Turn Claude Code into your project manager. Built for founders validating a business idea — track every call transcript, outreach message, research finding, hypothesis, and metric in one structured system that Claude picks up fresh every morning. You brief it, it briefs you back.

```bash
npx create-battle-plan                  # scaffold your project
npx create-battle-plan-outreach         # add the outreach pipeline (optional)
```

## Why?

This naturally evolved during a 3-week validation sprint for a startup idea. Timeboxed, clear focussed tasks, new content every day. If you can record and transcribe every relevant meeting, web research, outreach replies, new hypotheses to log, metrics, etc. and then dump all of that into Claude Code, in theory it could turn into YOUR project manager, not the other way around. Without a system to manage all of this context, however, it will inevitably lead to context bloat, stale facts and lots of duplicates.

I wanted a setup where:

1. The LLM could pick up where it left off, with just the right context, every morning, so that I can brief ME and give ME tasks.
2. New information would flow into the right docs automatically, in a fixed order, so nothing got dropped.
3. Stale numbers would get caught before they made it into a pitch deck.
4. Old context could be compressed without losing anything, once docs got too long for the LLM to read efficiently.

I use this every day and so far it's been a lot of fun.

## Who it's for

**Primarily:** Founders, entrepreneurs, and solo operators validating a business idea. You're running a validation sprint — talking to potential customers, sending outreach, booking discovery calls, tracking hypotheses, iterating on your pitch. You accumulate a huge amount of context every day: call transcripts, LinkedIn conversations, research notes, outreach replies, competitor intel, metrics. Battle Plan keeps all of it structured so Claude can be your co-pilot across sessions.

**Also great for** anyone running a focused project with lots of incoming information:

- You live inside Claude Code, Cursor, etc. and especially if you run LLMs via the CLI
- Your work is project-based with a clear time horizon (a 3-week sprint, a 6-month research project, a quarter-long deep dive)
- You process a lot of input every day: meeting transcripts, web research, replies, notes, papers
- You have specific targets you're trying to hit — calls booked, customers signed, experiments run, papers read
- You've already hit the wall where your LLM session gets too long, starts forgetting things, or starts hallucinating older context

## Quick start

```bash
npx create-battle-plan
```

That's it. The installer asks about your project and scaffolds everything. When it's done, open the folder in Claude Code and run `/good-morning` to start your first session.

> **Alternative:** If you prefer to clone manually:
> ```bash
> git clone https://github.com/paulkunhardt/battle-plan.git my-project
> cd my-project && claude
> ```
> The onboarding wizard runs automatically on first prompt.

## Outreach Add-on

A LinkedIn outreach pipeline built for people running Sales Navigator. Track every connection request, InMail, follow-up, and reply in a single CSV — with built-in rate limit tracking to keep you under LinkedIn's weekly connection (100/week) and monthly InMail (99/month) caps so you don't get shadow-banned.

### Install

```bash
# In your existing Battle Plan project:
npx create-battle-plan-outreach
```

### What you get

- **`outreach/leads.csv`** — Single source of truth for every lead. 23 columns tracking the full pipeline from `new` → `dm_sent` → `replied` → `call_booked` → `call_done` → `verbal` → `paying`
- **Daily blitz generator** — `node tools/outreach/daily-targets.js` creates a checklist of who to message today, sorted by priority, with template assignment and LinkedIn rate limit warnings
- **Rate limit safety** — Tracks connection requests per week and InMails per month against LinkedIn's limits. Warns you when you're approaching the cap so you don't get throttled or shadow-banned
- **Three flush paths** — Tick checkboxes, write free-form updates, or drop LinkedIn URLs. Every path syncs metrics automatically
- **Mermaid conversion dashboard** — Auto-generated funnel charts, role/size/country breakdowns, template A/B testing, and Kill/Keep/Scale verdicts per segment
- **Template performance tracking** — See which outreach messages get the best accept, reply, and call rates

### Prerequisites

- An existing Battle Plan project (`npx create-battle-plan` first)
- A LinkedIn Sales Navigator account (the system is designed around Sales Nav's connection request + InMail workflow)
- A list of leads in any format (CSV, spreadsheet, Sales Nav export, or just names) — Claude helps you import them
- Optional: `ANTHROPIC_API_KEY` in `.env` for AI-powered free-form update parsing

### Daily workflow

```
Morning:  node tools/outreach/daily-targets.js  → generates today's blitz checklist
Day:      Send messages, tick checkboxes
Evening:  node tools/outreach/flush-targets.js   → syncs everything back to CSV + metrics
```

Claude handles the cascade from there — metrics.yml, battle plan, domain docs all update automatically.

## Commands

Battle Plan ships with slash commands you can run inside Claude Code. Type them at the prompt.

### `/good-morning` — Start your day

Run this at the beginning of each work session. Claude will:

1. Read your metrics, battle plan, and recent git history
2. Show you where you are in your sprint — key metrics, gaps to target, unfinished items
3. Surface anything that's been stuck for 2+ days
4. Ask what happened since the last session
5. Cascade any updates into the right docs

Think of it as a daily standup with your AI co-pilot.

### `/wrap-up` — End your day

Run this at the end of each work session. Claude will:

1. Scan today's battle plan tasks — what got done, what didn't
2. Present the status for your review
3. Ask for any last updates (small things count — a reply, a thought, a link)
4. Run the full cascade to sync everything
5. Report: metrics changed (before/after), docs updated, tomorrow's priorities
6. Offer to commit with an `eod YYYY-MM-DD: [summary]` message

This is how you close out clean every day without forgetting to log something.

### `/distill <doc-path> [keep:N]` — Compress a long doc

When a doc grows too long for the LLM to read efficiently, `/distill` compresses older content into a thorough summary while archiving the verbatim raw content in `docs/archive/`. Nothing is lost.

How it works depends on the doc's `Compression:` mode (set in frontmatter):

- **chronological** docs (logs, journals): keeps the N most recent dated sections verbatim, summarises the rest
- **amended** docs (hypothesis trackers, target lists): collapses old `[UPDATE]` blocks into the body text, archives the raw blocks
- **none** docs (static references): refuses to run — edit these directly

## How it works

The "battle plan" is the central operating doc. When new information comes in — a call, a reply, a research finding, a metric change — the LLM updates a chain of files in a fixed order. Top of the chain: the battle plan that says "where am I right now". Bottom of the chain: source docs that hold the raw evidence.

The LLM never has to remember anything between sessions. It just reads the files. The cascade rules tell it which files to update and in what order, so nothing gets dropped, and the deterministic scripts catch the things the LLM gets wrong.

Three pieces:

1. **CLAUDE.md** is the system prompt. It tells the LLM the cascade rules, the timestamping rules, and how to handle new information. Claude Code reads it automatically. For other tools you point them at it.

2. **tools/** is a small set of shell scripts. They check that dates are current, that numbers in `metrics.yml` match the numbers cited in the docs, and that nothing is stale. The LLM follows the cascade about 90% of the time. The scripts catch the other 10%.

3. **.githooks/pre-commit** runs the verification before every commit. By default it warns. You can switch it to block by setting `CASCADE_STRICT=1`.

The loop looks like this:

```
          new info ──→ metrics.yml
                            │
                     battle-plan.md
                       /    |    \
                 market  validation  strategy ...
                            │
                      verify-cascade.sh ✓
```

New info flows into `metrics.yml` first (if a number changed), then into the battle plan (TL;DR, metrics table, daily log), then into the source docs that own the new info. At the end, `verify-cascade.sh` checks that everything is consistent.

You don't think about any of this. You just tell the LLM what happened. The cascade does the rest.

## Compression modes

Some docs grow forever. A daily log accumulates entries. A conversation journal accumulates sessions. An LLM with finite context can't keep reading a 2,000 line file just to find the latest week.

Every doc declares a `Compression:` mode in its frontmatter. The mode tells `/distill` how to operate, and (more importantly) it tells the LLM how to add new info to that doc so older content can always be told apart from newer content.

Three modes:

- **chronological** for append-only logs (battle plan, conversation journals). New entries go in dated sections like `## Session N (2026-04-07): title`. `/distill` keeps the most recent N sections verbatim and summarises the rest into the archive.
- **amended** for living reference docs (hypothesis trackers, target lists, competitive intel). New info goes in inline `> **[UPDATE 2026-04-07 · Source: ...]**` blocks above the claim it revises. `/distill` collapses old amendment blocks into the body text and archives the raw blocks.
- **none** for static thesis or reference docs. `/distill` refuses to run on these. Just edit them and let git track the history.

Full rules are in `CLAUDE.md` under "Compression Modes & Timestamping Rules".

## What's in the box

| Path | Purpose |
|---|---|
| `CLAUDE.md` | System prompt with cascade rules, compression modes, onboarding wizard |
| `metrics.yml` | The numeric source of truth. All key metrics live here. |
| `docs/` | Your project docs, organised by domain |
| `docs/README.md` | Vault rules for how docs get written |
| `.claude/commands/good-morning.md` | `/good-morning` — daily standup command |
| `.claude/commands/wrap-up.md` | `/wrap-up` — end-of-day wrap-up command |
| `.claude/commands/distill.md` | `/distill` — compress long docs command |
| `.claude/settings.json` | Hook that auto-triggers onboarding on first run |
| `tools/init-project.sh` | Scaffolds your project on first run (called by the wizard) |
| `tools/touch-date.sh` | Sets `Last Updated` to today on any file |
| `tools/check-metrics.sh` | Verifies numbers in docs match `metrics.yml` |
| `tools/sync-metrics.sh` | Propagates `metrics.yml` values into all doc references |
| `tools/verify-cascade.sh` | Full check: dates, metrics, staleness, consistency |
| `tools/setup-hooks.sh` | Installs the git pre-commit hook |
| `.githooks/pre-commit` | Runs verify-cascade on every commit |

## Adapting to your CLI tool

Claude Code reads `CLAUDE.md` and `.claude/commands/` automatically. For other tools:

- **Cursor:** copy `CLAUDE.md` content into `.cursorrules`
- **Anything else:** load `CLAUDE.md` as your system prompt and replicate the slash commands as snippets

Note: The `/good-morning`, `/wrap-up`, and `/distill` commands are Claude Code slash commands (stored in `.claude/commands/`). If you're using a different tool, you'll need to adapt them to your tool's command system or simply paste the instructions when needed.

## Auto-sync for metrics

When `metrics.yml` changes, `tools/sync-metrics.sh` propagates the new values to every doc that references them. Numbers in docs use markdown links as source annotations:

```
[**42**](metrics.yml#outreach_sent)
```

This renders as a bold clickable **42**, clean for humans, machine-readable for scripts. When you run `sync-metrics.sh`, it finds all `[**N**](metrics.yml#field)` links and updates N to match the current value in `metrics.yml`.

Three ways to trigger sync:

1. **LLM calls it** as part of the cascade protocol, after updating `metrics.yml`
2. **Claude Code hook** auto-fires when `metrics.yml` is written. Add to `.claude/settings.local.json`:
   ```json
   {
     "hooks": {
       "PostToolUse": [{
         "matcher": "Write|Edit",
         "hooks": [{
           "type": "command",
           "command": "jq -r '.tool_input.file_path // .tool_response.filePath' | { read -r f; if [[ \"$f\" == *metrics.yml ]]; then tools/sync-metrics.sh; fi; } 2>/dev/null || true",
           "timeout": 10
         }]
       }]
     }
   }
   ```
3. **Manual.** Just run `tools/sync-metrics.sh` after editing `metrics.yml`.

## Configuration

Copy `.cascaderc.example` to `.cascaderc`:

```bash
# Set to 1 to block commits with verification failures (default: warn only)
CASCADE_STRICT=0
```

## Demo content

The repo ships with a fictional 3-week B2B SaaS validation sprint as demo content. Read through it to see what a fully populated cascade looks like, then run the onboarding wizard to replace it with your own project. The original demo gets preserved in `examples/startup-validation/`.

## License

MIT. Use it, fork it, change it, no attribution needed.
